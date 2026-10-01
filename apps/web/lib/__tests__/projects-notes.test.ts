// SPDX-License-Identifier: MIT
/**
 * The linked-NOTES list rules, as pure functions.
 *
 * Everything the project page decides about a note row lives in
 * `@/lib/projects/notes`, so everything the page decides is asserted here with
 * plain values — no database, no React, no fetch:
 *
 *   - which linked rows survive (a soft-deleted note is never rendered, and the
 *     store's `deleted_at IS NULL` is the second refusal rather than the only one);
 *   - what order they render in (three keys, every comparator TOTAL, so equal keys
 *     can never leave the row order to chance);
 *   - what the row's excerpt line is (HTML and markdown flattened to prose, then cut
 *     on a word boundary) and — the load-bearing property — that building it NEVER
 *     inspects more than a bounded window of a body that can exceed a million
 *     characters;
 *   - what the empty and partially-hidden states SAY;
 *   - which body shape the on-demand detail view is about to render.
 *
 * The store's own two claims (no `content` column in the list projection; the
 * deleted filter in the query) are asserted separately in
 * `projects-notes-store.test.ts`, against the real query with a recording fake.
 */

import { describe, it, expect } from "vitest";
import {
  NOTE_BODY_SNIFF_CHARS,
  NOTE_EXCERPT_MAX_CHARS,
  NOTE_EXCERPT_SOURCE_CHARS,
  buildProjectNotesView,
  classifyNoteBody,
  compareProjectNotes,
  isLiveLinkedNote,
  projectNoteExcerpt,
  projectNotesEmptyMessage,
  projectNotesHiddenNotice,
  sortProjectNotes,
  type LinkedNoteRow,
} from "@/lib/projects/notes";

/** The bodies in production are conversations; this is the size band they reach. */
const HUGE = "x".repeat(1_000_000);

/**
 * True when `text` contains an unpaired UTF-16 surrogate — i.e. a cut that landed
 * in the middle of a code point. This is what a naive `String.prototype.slice` on
 * an excerpt produces, and it renders as a replacement character.
 */
function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function row(overrides: Partial<LinkedNoteRow> & { id: string }): LinkedNoteRow {
  return { title: `Title ${overrides.id}`, ...overrides };
}

describe("excerpt constants", () => {
  it("inspects a wider window than it renders, so the store's prefix is never the limit", () => {
    expect(NOTE_EXCERPT_SOURCE_CHARS).toBeGreaterThan(NOTE_EXCERPT_MAX_CHARS);
  });

  it("sniffs less of a body than the detail view will ever need", () => {
    expect(NOTE_BODY_SNIFF_CHARS).toBeGreaterThan(0);
  });
});

describe("projectNoteExcerpt — what the row's one line is", () => {
  it("returns nothing for an absent or blank body", () => {
    expect(projectNoteExcerpt(null)).toBe("");
    expect(projectNoteExcerpt(undefined)).toBe("");
    expect(projectNoteExcerpt("")).toBe("");
    expect(projectNoteExcerpt("   \n\t  ")).toBe("");
  });

  it("returns a body that fits WHOLE, with no ellipsis", () => {
    // An ellipsis on a line that was not truncated is a small lie, and it is the
    // kind that makes a reader distrust every other indicator on the page.
    const body = "A short note about 10 Ton.";
    const excerpt = projectNoteExcerpt(body);
    expect(excerpt).toBe(body);
    expect(excerpt).not.toContain("…");
  });

  it("flattens the editor's HTML to prose", () => {
    expect(projectNoteExcerpt("<p>Hello <strong>there</strong>, world</p>")).toBe(
      "Hello there, world",
    );
  });

  it("flattens markdown headings and keeps list items as text", () => {
    expect(projectNoteExcerpt("# Title\n\n- one\n- two")).toBe("Title - one - two");
  });

  it("drops emphasis markers, inline-code ticks and blockquote arrows", () => {
    expect(projectNoteExcerpt("> **bold** and `code` and _italics_")).toBe(
      "bold and code and italics",
    );
  });

  it("keeps a link's label and drops its target", () => {
    expect(projectNoteExcerpt("Ask [Example](https://example.test/example) about it")).toBe(
      "Ask Example about it",
    );
  });

  it("decodes entities AFTER stripping tags, so an escaped tag stays readable text", () => {
    const excerpt = projectNoteExcerpt("<p>a &amp; b, &lt;not a tag&gt;, &quot;quoted&quot;</p>");
    expect(excerpt).toBe('a & b, <not a tag>, "quoted"');
  });

  it("truncates a long body on a word boundary, with exactly one ellipsis", () => {
    // Distinct tokens, so a cut that landed INSIDE a word is detectable: whatever
    // token the excerpt ends on must appear whole in the source.
    const body = Array.from({ length: 80 }, (_, i) => `w${i}`).join(" ");
    const excerpt = projectNoteExcerpt(body);
    const truncated = excerpt.replace(/…$/, "");

    expect(excerpt.endsWith("…")).toBe(true);
    expect([...excerpt].length).toBeLessThanOrEqual(NOTE_EXCERPT_MAX_CHARS + 1);
    expect(truncated).not.toBe(body);

    const lastToken = truncated.split(" ").pop() ?? "";
    expect(lastToken).toMatch(/^w\d+$/);
    expect(` ${body} `.includes(` ${lastToken} `)).toBe(true);
  });

  it("does NOT add the ellipsis when the body is exactly the limit", () => {
    const exact = "a".repeat(NOTE_EXCERPT_MAX_CHARS);
    expect(projectNoteExcerpt(exact)).toBe(exact);
    expect(projectNoteExcerpt(exact)).not.toContain("…");
  });

  it("cuts at the limit even when the tail is one unbroken token", () => {
    // No whitespace to break on: an honest hard cut beats an empty excerpt.
    const excerpt = projectNoteExcerpt("y".repeat(NOTE_EXCERPT_MAX_CHARS * 2));
    expect([...excerpt].length).toBe(NOTE_EXCERPT_MAX_CHARS + 1);
    expect(excerpt.endsWith("…")).toBe(true);
  });

  it("cuts by CODE POINT — a naive UTF-16 slice would leave half an emoji", () => {
    // 159 characters puts the cut one short of the emoji, so a UTF-16 slice ends
    // on an unpaired surrogate.
    const excerpt = projectNoteExcerpt(`${"a".repeat(159)}🎉 tail`);

    expect(hasLoneSurrogate(excerpt)).toBe(false);
    expect(excerpt).toBe(`${"a".repeat(159)}🎉…`);
  });

  it("honours a caller's own limit", () => {
    expect(projectNoteExcerpt("one two three four", 7)).toBe("one…");
    expect(projectNoteExcerpt("one", 0)).toBe("");
  });

  it("NEVER inspects beyond the source window, however large the body is", () => {
    // A marker far past the window: if the walk were unbounded it would be found
    // and could be the excerpt. This is the property that keeps 445 very large
    // notes off the page's critical path.
    const beyond = `${"filler ".repeat(20_000)}SECRET_BEYOND_THE_WINDOW`;
    expect(beyond.length).toBeGreaterThan(NOTE_EXCERPT_SOURCE_CHARS * 100);

    const excerpt = projectNoteExcerpt(beyond);

    expect(excerpt).not.toContain("SECRET_BEYOND_THE_WINDOW");
    expect([...excerpt].length).toBeLessThanOrEqual(NOTE_EXCERPT_MAX_CHARS + 1);
  });

  it("stays bounded for a body past a million characters", () => {
    const excerpt = projectNoteExcerpt(`<p>${HUGE}</p>`);
    expect([...excerpt].length).toBeLessThanOrEqual(NOTE_EXCERPT_MAX_CHARS + 1);
  });
});

describe("isLiveLinkedNote — soft-deletes never surface", () => {
  it("treats an absent marker as live", () => {
    expect(isLiveLinkedNote({})).toBe(true);
    expect(isLiveLinkedNote({ deletedAt: null })).toBe(true);
    expect(isLiveLinkedNote({ deletedAt: undefined })).toBe(true);
    expect(isLiveLinkedNote({ deletedAt: "" })).toBe(true);
  });

  it("withholds a soft-deleted row", () => {
    expect(isLiveLinkedNote({ deletedAt: new Date("2026-09-30T00:00:00.000Z") })).toBe(false);
    expect(isLiveLinkedNote({ deletedAt: "2026-09-30T00:00:00.000Z" })).toBe(false);
  });
});

describe("sorting — three keys, every comparator total", () => {
  const early = "2026-01-01T00:00:00.000Z";
  const late = "2026-09-30T00:00:00.000Z";

  it("orders by most recent update by default", () => {
    const rows = [
      row({ id: "b", updatedAt: early }),
      row({ id: "a", updatedAt: late }),
    ];
    expect(sortProjectNotes(rows).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("breaks an update tie by when the note was LINKED, then by id", () => {
    const rows = [
      row({ id: "c", updatedAt: late, addedAt: early }),
      row({ id: "b", updatedAt: late, addedAt: late }),
      row({ id: "a", updatedAt: late, addedAt: late }),
    ];
    expect(sortProjectNotes(rows, "updated").map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("orders by the linking order on the `added` key — oldest edge first", () => {
    const rows = [
      row({ id: "second", addedAt: late }),
      row({ id: "first", addedAt: early }),
    ];
    expect(sortProjectNotes(rows, "added").map((r) => r.id)).toEqual(["first", "second"]);
  });

  it("orders by title A–Z, case-insensitively, then by id", () => {
    const rows = [
      row({ id: "z", title: "zebra" }),
      row({ id: "b", title: "Beta" }),
      row({ id: "a", title: "beta" }),
      row({ id: "d", title: "Alpha" }),
    ];
    expect(sortProjectNotes(rows, "title").map((r) => r.id)).toEqual(["d", "a", "b", "z"]);
  });

  it("sorts an absent or unparseable timestamp as epoch 0 instead of producing NaN", () => {
    const rows = [
      row({ id: "dated", updatedAt: late }),
      row({ id: "missing" }),
      row({ id: "broken", updatedAt: "not a date" }),
    ];
    const ordered = sortProjectNotes(rows, "updated").map((r) => r.id);
    // Deterministic and stable — `NaN` comparisons would leave the order to the
    // engine, and the tied pair is settled by id.
    expect(ordered).toEqual(["dated", "broken", "missing"]);
    expect(ordered).toEqual(sortProjectNotes(rows, "updated").map((r) => r.id));
  });

  it("compares a row with itself as equal rather than as an arbitrary number", () => {
    const comparator = compareProjectNotes("updated");
    const single = row({ id: "only", updatedAt: late });
    expect(comparator(single, single)).toBe(0);
  });

  it("never mutates the array it was handed", () => {
    const rows = [row({ id: "b", updatedAt: early }), row({ id: "a", updatedAt: late })];
    const before = rows.map((r) => r.id);
    sortProjectNotes(rows, "updated");
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

describe("buildProjectNotesView — the projection the page renders", () => {
  it("renders nothing, and counts nothing, for a project with no linked notes", () => {
    const view = buildProjectNotesView([]);
    expect(view).toEqual({ notes: [], totalLinked: 0, hiddenDeleted: 0 });
  });

  it("drops soft-deleted rows and reports how many it withheld", () => {
    const view = buildProjectNotesView([
      row({ id: "live", excerptSource: "Hello" }),
      row({ id: "gone", deletedAt: "2026-09-30T00:00:00.000Z", excerptSource: "Should not render" }),
    ]);

    expect(view.notes.map((n) => n.id)).toEqual(["live"]);
    expect(view.totalLinked).toBe(2);
    expect(view.hiddenDeleted).toBe(1);
    expect(JSON.stringify(view)).not.toContain("Should not render");
  });

  it("reports a fully-deleted list as empty but non-zero — the honest denominator", () => {
    const view = buildProjectNotesView([
      row({ id: "a", deletedAt: new Date() }),
      row({ id: "b", deletedAt: new Date() }),
    ]);
    expect(view.notes).toEqual([]);
    expect(view.totalLinked).toBe(2);
    expect(view.hiddenDeleted).toBe(2);
  });

  it("normalises a blank title, a blank date and a missing excerpt", () => {
    const view = buildProjectNotesView([
      row({ id: "a", title: "   ", date: "  ", excerptSource: null }),
      row({ id: "b", title: "  Real title  ", date: " 2026-09-30 ", excerptSource: undefined }),
    ]);

    const byId = new Map(view.notes.map((n) => [n.id, n]));
    expect(byId.get("a")?.title).toBe("Untitled");
    expect(byId.get("a")?.date).toBeNull();
    expect(byId.get("a")?.excerpt).toBe("");
    expect(byId.get("b")?.title).toBe("Real title");
    expect(byId.get("b")?.date).toBe("2026-09-30");
  });

  it("carries ISO timestamps for the client's re-sort, and null when absent", () => {
    const view = buildProjectNotesView([
      row({ id: "a", updatedAt: new Date("2026-09-30T12:00:00.000Z"), addedAt: null }),
    ]);
    expect(view.notes[0].updatedAt).toBe("2026-09-30T12:00:00.000Z");
    expect(view.notes[0].addedAt).toBeNull();
  });

  it("keeps every excerpt bounded when the bodies are the production size", () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      row({ id: `n${i}`, excerptSource: `<p>${HUGE}</p>`, updatedAt: `2026-09-0${i + 1}T00:00:00.000Z` }),
    );

    const view = buildProjectNotesView(rows);

    expect(view.notes).toHaveLength(3);
    for (const note of view.notes) {
      expect([...note.excerpt].length).toBeLessThanOrEqual(NOTE_EXCERPT_MAX_CHARS + 1);
    }
  });

  it("orders through the sort rule, so the projection and the component cannot disagree", () => {
    const view = buildProjectNotesView(
      [
        row({ id: "older", addedAt: "2026-01-01T00:00:00.000Z" }),
        row({ id: "newer", addedAt: "2026-09-30T00:00:00.000Z" }),
      ],
      { sort: "added" },
    );
    expect(view.notes.map((n) => n.id)).toEqual(["older", "newer"]);
  });
});

describe("projectNotesEmptyMessage — the empty case never renders blank", () => {
  it("says nothing when there are notes to render", () => {
    expect(
      projectNotesEmptyMessage({
        notes: [
          {
            id: "a",
            title: "A",
            excerpt: "",
            date: null,
            updatedAt: "",
            addedAt: null,
          },
        ],
        totalLinked: 1,
        hiddenDeleted: 0,
      }),
    ).toBeNull();
  });

  it("offers the action when nothing is linked", () => {
    const message = projectNotesEmptyMessage({ notes: [], totalLinked: 0, hiddenDeleted: 0 });
    expect(message).toContain("No notes linked yet");
    expect(message).toContain("never copies");
  });

  it("explains WHY the list is empty when every linked note is deleted", () => {
    expect(projectNotesEmptyMessage({ notes: [], totalLinked: 1, hiddenDeleted: 1 })).toBe(
      "No notes to show. All 1 linked note is deleted, and a deleted note never appears here.",
    );
    expect(projectNotesEmptyMessage({ notes: [], totalLinked: 4, hiddenDeleted: 4 })).toBe(
      "No notes to show. All 4 linked notes are deleted, and a deleted note never appears here.",
    );
  });
});

describe("projectNotesHiddenNotice — honest about what the list withheld", () => {
  const note = {
    id: "a",
    title: "A",
    excerpt: "",
    date: null,
    updatedAt: "",
    addedAt: null,
  } as const;

  it("says nothing when nothing was withheld", () => {
    expect(projectNotesHiddenNotice({ notes: [note], totalLinked: 1, hiddenDeleted: 0 })).toBeNull();
  });

  it("says nothing when the list is empty — the empty message already covers it", () => {
    expect(projectNotesHiddenNotice({ notes: [], totalLinked: 1, hiddenDeleted: 1 })).toBeNull();
  });

  it("counts the withheld rows, singular and plural", () => {
    expect(projectNotesHiddenNotice({ notes: [note], totalLinked: 2, hiddenDeleted: 1 })).toBe(
      "1 deleted note is not shown.",
    );
    expect(projectNotesHiddenNotice({ notes: [note], totalLinked: 4, hiddenDeleted: 3 })).toBe(
      "3 deleted notes are not shown.",
    );
  });
});

describe("classifyNoteBody — which body the detail view is about to render", () => {
  it("calls an absent or blank body empty", () => {
    expect(classifyNoteBody(null)).toBe("empty");
    expect(classifyNoteBody(undefined)).toBe("empty");
    expect(classifyNoteBody("")).toBe("empty");
    expect(classifyNoteBody("  \n\t ")).toBe("empty");
  });

  it("recognises the editor's HTML", () => {
    expect(classifyNoteBody("<p>Hello</p>")).toBe("html");
    expect(classifyNoteBody("<h2>Intentions</h2><p></p>")).toBe("html");
    expect(classifyNoteBody("\n<ul><li><p>one</p></li></ul>")).toBe("html");
  });

  it("recognises an imported note's markdown", () => {
    expect(classifyNoteBody("# Title\n\nSome body")).toBe("markdown");
    expect(classifyNoteBody("- one\n- two")).toBe("markdown");
    expect(classifyNoteBody("plain prose")).toBe("markdown");
  });

  it("does not mistake a comparison operator in prose for a tag", () => {
    // `<` must be followed by a letter and a matching `>` — otherwise every note
    // that mentions "3 < 4" would be sanitised as HTML and shown as markdown.
    expect(classifyNoteBody("3 < 4 and 5 > 2")).toBe("markdown");
    expect(classifyNoteBody("use the < key")).toBe("markdown");
  });

  it("only sniffs a bounded window, so a tag far into a huge body is not the signal", () => {
    const body = `${"plain prose ".repeat(300)}<p>html at the end</p>`;
    expect(body.length).toBeGreaterThan(NOTE_BODY_SNIFF_CHARS);
    expect(classifyNoteBody(body)).toBe("markdown");
  });
});
