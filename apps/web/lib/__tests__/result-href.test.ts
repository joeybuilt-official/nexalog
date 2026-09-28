// SPDX-License-Identifier: MIT
/**
 * The brain-hit 404 chain — the defect these tests pin.
 *
 * THE BUG (verified against main before this change): a brain page's search
 * hit carries its SLUG as `id` (`concepts/litellm-gateway`), and every result
 * renderer derived its route from `kind` alone:
 *
 *     kind === "note" ? `/app/notes/${id}` : `/app/bookmarks/${id}/reader`
 *
 * A slug is neither a note uuid nor a capture uuid, so every brain page the
 * pipeline could FIND 404'd on click — from the search modal, the search page,
 * all three ContentFinder lenses, and both card grammars. The app could see
 * the brain and never open it.
 *
 * THE FIX pins two invariants, which is what is asserted here:
 *
 *   1. `/api/search` POPULATES `href` — a brain hit's is `/app/brain/<slug>`
 *      (with each path segment encoded), a note's is its note route, a
 *      capture's is its reader route. The server knows the row's identity; the
 *      client must never have to guess it.
 *   2. `resolveResultHref` (the one resolver all four call sites now share)
 *      prefers that `href` and NEVER invents a route for a row that has none.
 *
 * This file lives under `lib/__tests__/` per the repo's convention
 * (`.claude/rules/testing.md`): route tests are not colocated with route.ts.
 */

import { describe, it, expect } from "vitest";

import { brainPageHref, resolveResultHref } from "@/lib/search/result-href";

describe("brainPageHref", () => {
  it("addresses a multi-segment slug as a path, exactly as the route expects", () => {
    expect(brainPageHref("concepts/litellm-gateway")).toBe("/app/brain/concepts/litellm-gateway");
    expect(brainPageHref("atoms/2026-09-28/some-atom")).toBe(
      "/app/brain/atoms/2026-09-28/some-atom",
    );
  });

  it("encodes each segment (a slug segment may carry characters a URL cannot)", () => {
    // The catch-all route decodes back to the slug, so encoding must be
    // per-segment: an encoded slash would collapse two segments into one.
    expect(brainPageHref("notes/a b")).toBe("/app/brain/notes/a%20b");
    expect(brainPageHref("notes/a%2Fb")).toBe("/app/brain/notes/a%252Fb");
  });
});

describe("resolveResultHref", () => {
  it("uses the server's href for a brain hit — the 404 this fixes", () => {
    // Exactly the shape /api/search returns for a GBrain hit: slug-keyed id,
    // kind "reference", and now an href.
    const brainHit = {
      id: "concepts/litellm-gateway",
      kind: "reference",
      href: "/app/brain/concepts/litellm-gateway",
    };
    expect(resolveResultHref(brainHit)).toBe("/app/brain/concepts/litellm-gateway");
    // The old behaviour would have produced /app/bookmarks/<slug>/reader,
    // which notFound()s. Guard it explicitly.
    expect(resolveResultHref(brainHit)).not.toContain("/app/bookmarks/");
  });

  it("falls back to the note route when the server did not annotate a note", () => {
    expect(resolveResultHref({ id: "abc-123", kind: "note" })).toBe("/app/notes/abc-123");
  });

  it("returns null for a row with no server href and no derivable route", () => {
    // The honest answer: opening the row's own URL beats linking to a page
    // that will not resolve.
    expect(resolveResultHref({ id: "concepts/foo", kind: "reference" })).toBeNull();
    expect(resolveResultHref({ id: "https://example.com", kind: "article" })).toBeNull();
  });

  it("treats an empty-string href as absent rather than navigating nowhere", () => {
    expect(resolveResultHref({ id: "x", kind: "reference", href: "" })).toBeNull();
  });

  it("prefers an explicit href over the kind-derived fallback", () => {
    const r = { id: "11111111-1111-4111-8111-111111111111", kind: "note", href: "/app/brain/notes/x" };
    expect(resolveResultHref(r)).toBe("/app/brain/notes/x");
  });
});
