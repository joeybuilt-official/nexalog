// SPDX-License-Identifier: MIT
/**
 * The PAGE degradation ladder (lib/pages/degrade.ts) — the pure answer-shaping
 * all three page surfaces share, tested with no IO at all.
 *
 * Why it is its own module and its own test: the garden's ladder
 * (`lib/graph/degrade.ts`) exists because "a GBrain outage must never render a
 * blank screen" is a DECISION, not an IO concern. The pages surfaces make the
 * same decision and must make it identically — an outage on the /app/brain
 * index has to degrade to the brain repo (or to a stated empty state), never
 * to a 500 and never to a silent empty list that reads like "you have no
 * pages".
 *
 * The invariant asserted throughout: a non-gbrain answer is ALWAYS
 * `degraded: true` AND carries a `note` explaining itself, and `ok` is true
 * for every rung (the request succeeded — it simply answered from less).
 */

import { describe, it, expect } from "vitest";

import {
  resolvePagePayload,
  resolvePagesPayload,
  type BrainPage,
  type BrainPageSummary,
  type GbrainPageOutcome,
  type GbrainPagesOutcome,
  type LocalPageOutcome,
} from "@/lib/pages/degrade";

const GBRAIN_PAGES: BrainPageSummary[] = [
  { slug: "concepts/a", title: "A", type: "concept", updatedAt: "2026-09-01T00:00:00.000Z" },
];

const LOCAL_PAGES: BrainPageSummary[] = [
  { slug: "concepts/local-a", title: "Local A", type: "concept", updatedAt: null },
  { slug: "people/local-b", title: "Local B", type: "person", updatedAt: null },
];

function index(gbrain: GbrainPagesOutcome, pages: BrainPageSummary[] = LOCAL_PAGES, limit = 50, offset = 0) {
  return resolvePagesPayload({ gbrain, local: { pages }, limit, offset });
}

describe("resolvePagesPayload — the index ladder", () => {
  it("prefers GBrain and reports the index as not degraded", () => {
    const payload = index({ status: "ok", pages: GBRAIN_PAGES, truncated: false }, []);

    expect(payload.source).toBe("gbrain");
    expect(payload.degraded).toBe(false);
    expect(payload.pages).toEqual(GBRAIN_PAGES);
    expect(payload.note).toBeUndefined();
  });

  it("does NOT fall back to disk on a later GBrain page that came back empty", () => {
    // Past offset 0 an empty list means "the caller walked off the end", not
    // "GBrain has nothing" — rebuilding from disk here would report rows from
    // a different source at a position they do not occupy.
    const payload = index({ status: "exhausted" }, LOCAL_PAGES, 50, 100);

    expect(payload.source).toBe("gbrain");
    expect(payload.pages).toEqual([]);
    expect(payload.nextOffset).toBeNull();
    expect(payload.degraded).toBe(false);
  });

  it("degrades to the brain repo when GBrain is unreachable, naming the reason", () => {
    const payload = index({ status: "unreachable" });

    expect(payload.ok).toBe(true);
    expect(payload.source).toBe("local");
    expect(payload.degraded).toBe(true);
    expect(payload.pages).toHaveLength(2);
    expect(payload.note).toMatch(/unreachable/);
    // The note states the fallback's real limits.
    expect(payload.note).toMatch(/need GBrain/);
  });

  it("degrades with a stated reason when GBrain is unconfigured", () => {
    const payload = index({ status: "unconfigured" });

    expect(payload.source).toBe("local");
    expect(payload.note).toMatch(/not configured/);
  });

  it("reports `none` with a reason when nothing is readable at all", () => {
    const payload = index({ status: "unreachable" }, []);

    expect(payload.ok).toBe(true);
    expect(payload.source).toBe("none");
    expect(payload.degraded).toBe(true);
    expect(payload.pages).toEqual([]);
    expect(payload.note).toMatch(/unreachable/);
  });

  it("reports `none` — never an exception — when GBrain is absent entirely", () => {
    const payload = index({ status: "unconfigured" }, []);

    expect(payload.source).toBe("none");
    expect(payload.note).toMatch(/not configured/);
  });

  it("flags a full GBrain page as truncated with a usable next offset", () => {
    const payload = index({ status: "ok", pages: GBRAIN_PAGES, truncated: false }, [], 1, 0);

    expect(payload.truncated).toBe(true);
    expect(payload.nextOffset).toBe(1);
  });

  it("slices the local list to the requested limit and reports the rest", () => {
    const payload = index({ status: "unreachable" }, LOCAL_PAGES, 1, 0);

    expect(payload.pages).toHaveLength(1);
    expect(payload.truncated).toBe(true);
    expect(payload.nextOffset).toBe(1);
  });

  it("every non-gbrain rung is degraded AND explains itself", () => {
    for (const status of ["unreachable", "unconfigured", "empty"] as const) {
      const payload = index({ status }, []);
      expect(payload.source).toBe("none");
      expect(payload.degraded).toBe(true);
      expect(payload.note, `status=${status} must carry a note`).toBeTruthy();
    }
  });
});

const PAGE: BrainPage = { slug: "concepts/a", title: "A", type: "concept", body: "# A\n\ntext" };

function page(gbrain: GbrainPageOutcome, local: LocalPageOutcome | null = null) {
  return resolvePagePayload({ gbrain, local });
}

describe("resolvePagePayload — the reader ladder", () => {
  it("returns GBrain's page with its typed links and no degradation", () => {
    const links = [{ slug: "companies/b", title: null, linkType: "mentions", context: null }];
    const payload = page({
      status: "ok",
      page: PAGE,
      links,
      backlinks: [],
    });

    expect(payload).not.toBeNull();
    expect(payload!.source).toBe("gbrain");
    expect(payload!.degraded).toBe(false);
    expect(payload!.page.body).toBe(PAGE.body);
    expect(payload!.links).toEqual(links);
    expect(payload!.note).toBeUndefined();
  });

  it("falls back to the brain repo read when GBrain is unreachable", () => {
    const payload = page({ status: "unreachable" }, {
      page: PAGE,
      links: [],
      backlinks: [],
    });

    expect(payload!.source).toBe("local");
    expect(payload!.degraded).toBe(true);
    expect(payload!.page.body).toBe(PAGE.body);
    expect(payload!.note).toMatch(/unreachable/);
  });

  it("returns null — the honest 404 — when neither source has the page", () => {
    expect(page({ status: "missing" })).toBeNull();
    expect(page({ status: "missing" }, null)).toBeNull();
    expect(page({ status: "unreachable" }, null)).toBeNull();
  });

  it("treats a GBrain miss as authoritative and does NOT read the disk", () => {
    // `missing` means the tool answered `page_not_found` — a real answer. The
    // route must not then produce a page GBrain says does not exist.
    expect(page({ status: "missing" })).toBeNull();
  });
});
