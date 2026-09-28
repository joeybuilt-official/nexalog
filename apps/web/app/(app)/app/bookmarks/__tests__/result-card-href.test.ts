// SPDX-License-Identifier: MIT
/**
 * Render proof for the result card — the last link in the 404 chain.
 *
 * The route the server puts on a row is only half the fix: the CARD has to
 * honour it. Two renderers derive their own links, and each got a brain hit
 * wrong in its own way:
 *
 *   ResultGrid's `NoteRow`   hardcoded `/app/notes/<id>`.
 *   `CaptureCard`'s Reader   hardcoded `/app/bookmarks/<id>/reader`.
 *
 * Both now read the server's `href`. And a third case, found while fixing
 * those: the bookmarks surface passes a `renderItem` that DECLINES the rows it
 * does not own — and a declined row used to render as an empty slot, so a
 * brain page of gbrain type `note` (which arrives with kind "note") vanished
 * from that surface entirely. `renderResult` now falls back to the default
 * card when an override declines.
 *
 * Rendered with `react-dom/server` (the repo's convention for render tests —
 * see `app/inbox/__tests__/inbox-proposal-surface.test.ts`), so the assertions
 * are over the markup a server render actually produces. `createElement`
 * rather than JSX because `apps/web/vitest.config.ts` includes `*.test.ts`
 * only, so a `.tsx` spec would not be collected.
 */

import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ResultGrid } from "@/components/content-finder/ResultGrid";
import type { SearchResult } from "@/components/content-finder/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/app/bookmarks",
  useSearchParams: () => new URLSearchParams(),
}));

function result(over: Partial<SearchResult> = {}): SearchResult {
  return {
    id: "concepts/litellm-gateway",
    kind: "reference",
    title: "LiteLLM Gateway",
    href: "/app/brain/concepts/litellm-gateway",
    url: null,
    themeLabel: null,
    themeRegion: null,
    themeId: null,
    openedAt: null,
    evergreen: null,
    paywalled: null,
    readMinutes: null,
    watchMinutes: null,
    summary: "Routes every model call.",
    ogImage: null,
    faviconUrl: null,
    urlHost: null,
    createdAt: "2026-09-23T05:47:55.889Z",
    score: 1,
    snippet: "Routes every model call.",
    ...over,
  };
}

function render(rows: SearchResult[], renderItem?: (r: SearchResult) => React.ReactNode): string {
  return renderToStaticMarkup(
    createElement(ResultGrid, { results: rows, renderItem }),
  );
}

describe("result cards honour the server's href", () => {
  it("links a brain hit to /app/brain/<slug> from the card grid", () => {
    const html = render([result()]);

    expect(html).toContain('href="/app/brain/concepts/litellm-gateway"');
    // The bug: a slug id sent to a uuid route.
    expect(html).not.toContain("/app/bookmarks/concepts/litellm-gateway");
  });

  it("links a brain page of gbrain type `note` to /app/brain — not /app/notes/<slug>", () => {
    // The fs scan reports this kind for a brain page, and NoteRow used to
    // hardcode the note route from the (slug) id.
    const html = render([
      result({
        id: "notes/gbrain-issue-writer-trap",
        kind: "note",
        title: "gbrain writer trap",
        href: "/app/brain/notes/gbrain-issue-writer-trap",
      }),
    ]);

    expect(html).toContain('href="/app/brain/notes/gbrain-issue-writer-trap"');
    expect(html).not.toContain('href="/app/notes/notes/gbrain-issue-writer-trap"');
  });

  it("still links a real note to its own note route", () => {
    const noteId = "22222222-2222-4222-8222-222222222222";
    const html = render([
      result({ id: noteId, kind: "note", title: "A note", href: `/app/notes/${noteId}` }),
    ]);

    expect(html).toContain(`href="/app/notes/${noteId}"`);
  });

  it("falls back to the DEFAULT card when a host override declines a row", () => {
    // The bookmarks surface declines every non-bookmark row. Declining must
    // mean "use the default card" — a declined row used to render empty.
    const html = render([result()], () => null);

    expect(html).toContain("LiteLLM Gateway");
    expect(html).toContain('href="/app/brain/concepts/litellm-gateway"');
  });

  it("uses the host's card when the override accepts a row", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const html = render(
      [result({ id, kind: "article", href: `/app/bookmarks/${id}/reader` })],
      (r) => createElement("div", { "data-custom-card": r.id }, "custom"),
    );

    expect(html).toContain("data-custom-card");
    expect(html).toContain("custom");
  });

  it("renders an unaddressable row as text rather than a dead link", () => {
    const html = render([
      result({ id: "no-route", kind: "other", href: null, title: "Orphan" }),
    ]);

    expect(html).toContain("Orphan");
    expect(html).not.toContain('href="/app/notes/no-route"');
    // A slug-shaped id must never be minted into a capture reader route.
    expect(html).not.toContain('href="/app/bookmarks/no-route/reader"');
  });

  it("gives a real capture its reader route when the server sent no href", () => {
    const id = "44444444-4444-4444-8444-444444444444";
    const html = render([result({ id, kind: "article", href: null, title: "A capture" })]);

    expect(html).toContain(`href="/app/bookmarks/${id}/reader"`);
  });
});
