// SPDX-License-Identifier: MIT
/**
 * The on-demand note detail view, as rendered markup — and the guard that makes it
 * "this project's notes" rather than a second global note reader.
 *
 * What this pins, and why each is a real regression:
 *   - the note's BODY is rendered here (and only here): the editor's HTML through
 *     the prose sanitiser, an imported note's markdown as its own source, and an
 *     empty body as an explanation with a way to write it — never a blank page;
 *   - a `<script>`/`onerror` in stored content does NOT reach the markup. The body
 *     is the one place on this feature that injects HTML, so the sanitiser is
 *     load-bearing, and this is what proves it ran;
 *   - an unlinked or foreign note is `notFound()`, because the store's edge guard
 *     returned nothing — the page renders NOTHING in that case;
 *   - the reader is never stranded: the breadcrumb and the back link both lead to
 *     the project the note was listed in.
 *
 * `next/navigation` and `next/link` are stubbed because they need a Next request
 * runtime a static render has not got; `redirect`/`notFound` THROW the sentinels
 * they throw in production, so "the page stopped" is asserted rather than assumed.
 * The store and the auth/workspace lookups are fakes, so no database is involved.
 *
 * Written as a `.ts` spec with `createElement`: vitest collects `*.test.ts` only,
 * so a `.tsx` render spec would silently never run. Co-located with the surface it
 * renders (not under `lib/`) so it can import `app/` without crossing
 * `web-lib-no-ui`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { getAuthUser, getUserWorkspaces, getProjectNote, redirectMock, notFoundMock } = vi.hoisted(
  () => ({
    getAuthUser: vi.fn(),
    getUserWorkspaces: vi.fn(),
    getProjectNote: vi.fn(),
    redirectMock: vi.fn(),
    notFoundMock: vi.fn(),
  }),
);

vi.mock("@/lib/auth/server", () => ({ getAuthUser }));
vi.mock("@/lib/workspace", () => ({ getUserWorkspaces }));
vi.mock("@/lib/projects/store", () => ({ getProjectNote }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirectMock(url);
    throw new Error("NEXT_REDIRECT");
  },
  notFound: () => {
    notFoundMock();
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

import ProjectNotePage from "../[id]/notes/[noteId]/page";

const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const NOTE_ID = "33333333-3333-4333-8333-333333333333";

const DETAIL = {
  id: NOTE_ID,
  projectId: PROJECT_ID,
  projectName: "Full-On Pictures",
  title: "Angel Studios call",
  content: "<p>Shipped the brief.</p>",
  date: "2026-09-30",
  kind: "note",
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  updatedAt: new Date("2026-09-30T00:00:00.000Z"),
  addedAt: new Date("2026-09-02T00:00:00.000Z"),
};

/** Render the page the way Next does: the element it returns, for a resolved route. */
async function renderPage(): Promise<string> {
  const element = await ProjectNotePage({
    params: Promise.resolve({ id: PROJECT_ID, noteId: NOTE_ID }),
  });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  getAuthUser.mockReset().mockResolvedValue({ id: "user-1" });
  getUserWorkspaces.mockReset().mockResolvedValue([{ id: "ws-1" }]);
  getProjectNote.mockReset().mockResolvedValue(DETAIL);
  redirectMock.mockReset();
  notFoundMock.mockReset();
});

describe("ProjectNotePage — rendering one note's body on demand", () => {
  it("renders the note's HTML body through the sanitiser", async () => {
    const markup = await renderPage();

    expect(markup).toContain('data-note-body="html"');
    expect(markup).toContain("Shipped the brief.");
    // The heading/metadata the reader needs to know where they are.
    expect(markup).toContain("Angel Studios call");
    expect(markup).toContain("Full-On Pictures");
    expect(markup).toContain("2026-09-30");
  });

  it("strips scripts and event handlers out of stored content", async () => {
    getProjectNote.mockResolvedValue({
      ...DETAIL,
      content:
        '<p>ok</p><script>alert(1)</script><img src=x onerror="alert(2)"><a href="javascript:alert(3)">x</a>',
    });

    const markup = await renderPage();

    // This is the one surface in the feature that injects HTML, so the sanitiser is
    // load-bearing rather than decorative: assert each vector is gone, not that a
    // single string is absent.
    expect(markup).toContain("ok");
    expect(markup).not.toContain("<script");
    expect(markup).not.toContain("onerror");
    expect(markup).not.toContain("javascript:");
  });

  it("shows an imported markdown body as its source, labelled as such", async () => {
    getProjectNote.mockResolvedValue({ ...DETAIL, content: "# Heading\n\n- one\n- two" });

    const markup = await renderPage();

    expect(markup).toContain('data-note-body="markdown"');
    expect(markup).toContain("Stored as Markdown");
    // The source text is rendered as a React text node — escaped, not parsed.
    expect(markup).toContain("# Heading");
    expect(markup).not.toContain('data-note-body="html"');
  });

  it("explains an empty body and offers the editor, never a blank page", async () => {
    getProjectNote.mockResolvedValue({ ...DETAIL, content: "   " });

    const markup = await renderPage();

    expect(markup).toContain("no content yet");
    expect(markup).toContain(`href="/app/notes/${NOTE_ID}"`);
  });

  it("is a 404 for a note that is not linked to this project", async () => {
    getProjectNote.mockResolvedValue(null);

    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalledTimes(1);
    // The store is asked about THIS project and THIS note — never a bare note id.
    expect(getProjectNote).toHaveBeenCalledWith(["ws-1"], PROJECT_ID, NOTE_ID);
  });

  it("sends an anonymous reader to the login page", async () => {
    getAuthUser.mockResolvedValue(null);

    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/login");
    expect(getProjectNote).not.toHaveBeenCalled();
  });

  it("keeps the reader oriented — a breadcrumb and a back link to the project", async () => {
    const markup = await renderPage();

    expect(markup).toContain(`href="/app/projects/${PROJECT_ID}"`);
    expect(markup).toContain('data-back-to-project="true"');
    expect(markup).toContain("Back to Full-On Pictures");
  });
});
