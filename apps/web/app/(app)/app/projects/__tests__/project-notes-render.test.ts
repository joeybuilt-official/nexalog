// SPDX-License-Identifier: MIT
/**
 * The project page's NOTES SECTION as rendered markup — the part of this feature
 * that is not pure logic and therefore cannot be reached by the module's tests.
 *
 * What this pins, and why each is a real regression:
 *   - an EMPTY project renders a designed, explanatory state, not a blank region
 *     ("No notes linked yet…"), and the all-deleted case says WHY it is empty
 *     instead of reusing the action copy;
 *   - a POPULATED project renders one row per note, each carrying the title, the
 *     excerpt and the note's date, each LINKING to the on-demand detail route —
 *     the list cannot show a body because the row has nothing to show a body with;
 *   - the excerpt is escaped as a TEXT node, never injected as markup, so a note
 *     whose first characters are `<img onerror=…>` cannot become live HTML on the
 *     project page (the excerpt is derived from user-authored content);
 *   - the sort control is derived from the module (every key, labelled) and does
 *     not appear when there is nothing to sort;
 *   - a list that is rendering rows while withholding deleted ones says so.
 *
 * Written as a `.ts` spec with `createElement`: vitest collects `*.test.ts` only,
 * so a `.tsx` render spec would silently never run (the gate would stay green over
 * an untested surface). Co-located with the surface it renders (not under `lib/`)
 * so it can import `app/` without crossing `web-lib-no-ui`.
 */

import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PROJECT_NOTE_SORTS,
  PROJECT_NOTE_SORT_LABELS,
  buildProjectNotesView,
  type ProjectNoteListItem,
} from "@/lib/projects/notes";
import { NotesSection } from "../[id]/notes-section";

// These are client components; `useRouter` is the one hook whose real
// implementation needs a Next.js request context that a static render has not got.
// Stubbing it is stubbing the FRAMEWORK, not the code under test.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

/**
 * Rows for the section, built through the REAL projection (`buildProjectNotesView`)
 * exactly as the page builds them. That matters: the component renders what it is
 * given and deliberately does NOT re-derive the title/date/excerpt rules, so a
 * hand-written fixture would let the test assert a contract the page never
 * produces — and would hide a rule that had quietly moved into the component.
 */
function projectedNotes(rows: Parameters<typeof buildProjectNotesView>[0]): ProjectNoteListItem[] {
  return buildProjectNotesView(rows).notes;
}

/** One already-projected item, for the cases the projection cannot produce. */
function item(overrides: Partial<ProjectNoteListItem> & { id: string }): ProjectNoteListItem {
  return {
    title: `Note ${overrides.id}`,
    excerpt: "",
    date: null,
    updatedAt: "2026-09-30T00:00:00.000Z",
    addedAt: null,
    ...overrides,
  };
}

function html(
  notes: ProjectNoteListItem[],
  counts: { totalLinked?: number; hiddenDeleted?: number } = {},
): string {
  return renderToStaticMarkup(
    createElement(NotesSection, {
      projectId: PROJECT_ID,
      notes,
      totalLinked: counts.totalLinked ?? notes.length,
      hiddenDeleted: counts.hiddenDeleted ?? 0,
    }),
  );
}

describe("NotesSection — the empty project", () => {
  it("renders an explanation and an action, never a blank region", () => {
    const markup = html([]);

    expect(markup).toContain("data-project-notes");
    expect(markup).toContain("No notes linked yet");
    expect(markup).toContain("never copies");
    expect(markup).not.toContain("data-project-note-row");
  });

  it("offers no sort control when there is nothing to sort", () => {
    expect(html([])).not.toContain("data-notes-sort");
    expect(html(projectedNotes([{ id: "only", title: "Only" }]))).not.toContain("data-notes-sort");
  });

  it("explains the all-deleted case instead of reusing the action copy", () => {
    const markup = html([], { totalLinked: 2, hiddenDeleted: 2 });

    expect(markup).toContain("2 linked notes are deleted");
    expect(markup).not.toContain("No notes linked yet");
    expect(markup).not.toContain("data-project-note-row");
  });
});

describe("NotesSection — the populated project", () => {
  const notes = projectedNotes([
    {
      id: "n1",
      title: "Angel Pictures chat",
      excerptSource: "<p>The influencer CRM brief, and where it landed.</p>",
      date: "2026-09-30",
      updatedAt: "2026-09-30T12:00:00.000Z",
      addedAt: "2026-09-20T00:00:00.000Z",
    },
    // Untitled, bodiless and undated — every absent field at once.
    { id: "n2", title: "   ", excerptSource: null, date: null, updatedAt: "2026-09-01T00:00:00.000Z" },
  ]);

  it("renders one row per note with its title, excerpt and date", () => {
    const markup = html(notes);

    expect(markup).toContain('data-project-note-row="n1"');
    expect(markup).toContain('data-project-note-row="n2"');
    expect(markup).toContain("Angel Pictures chat");
    expect(markup).toContain("The influencer CRM brief, and where it landed.");
    expect(markup).toContain("2026-09-30");
    // The projection's title rule reaches the DOM: a blank title reads "Untitled".
    expect(markup).toContain("Untitled");
    // A note with no date renders no date line rather than an empty one.
    const untitled = markup.split('data-project-note-row="n2"')[1];
    expect(untitled).not.toContain("2026-09-30");
  });

  it("links every row to that note's on-demand detail route", () => {
    const markup = html(notes);

    expect(markup).toContain(`href="/app/projects/${PROJECT_ID}/notes/n1"`);
    expect(markup).toContain(`href="/app/projects/${PROJECT_ID}/notes/n2"`);
  });

  it("renders the excerpt as ESCAPED TEXT — note content can never become markup here", () => {
    // Defence in depth: the projection already strips tags from an excerpt, so this
    // item is handed over directly. The component must not be one bypass away from
    // live HTML on the project page, which is exactly what an innerHTML would be.
    const markup = html([
      item({ id: "x", title: "Hostile", excerpt: '<img src=x onerror="alert(1)"> & more' }),
    ]);

    expect(markup).toContain("&lt;img src=x onerror=");
    expect(markup).not.toContain("<img src=x");
    // The detail view's body marker is not here either: the list shows no body.
    expect(markup).not.toContain("data-note-body");
  });

  it("offers every sort key the module declares, labelled", () => {
    const markup = html(notes);

    expect(markup).toContain("data-notes-sort");
    for (const sort of PROJECT_NOTE_SORTS) {
      expect(markup).toContain(`value="${sort}"`);
      expect(markup).toContain(PROJECT_NOTE_SORT_LABELS[sort]);
    }
  });

  it("says how many rows it withheld while still rendering the rest", () => {
    const markup = html(notes, { totalLinked: 3, hiddenDeleted: 1 });
    expect(markup).toContain("1 deleted note is not shown.");
  });

  it("says nothing about withheld rows when none were withheld", () => {
    expect(html(notes)).not.toContain("not shown");
  });
});
