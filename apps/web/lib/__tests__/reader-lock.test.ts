// SPDX-License-Identifier: MIT
/**
 * `extractReader`'s lock must not permanently strand rows.
 *
 * Two defects this pins (both real, both visible in prod counts):
 *
 *   1. `reader_state = 'skipped'` was NOT admitted by the lock, so a row the
 *      reader had skipped (non-URL, homepage, social, video — or an imported
 *      row whose importer wrote `skipped` by default) could never be
 *      re-extracted, even after a later reclassification made it readable.
 *      ~309 search-visible rows were in that state.
 *   2. A row left in `extracting` by a process that died mid-fetch held the
 *      lock forever (20 rows in prod). The fetch is capped at 10 s, so an
 *      `extracting` row older than the staleness window is a dead worker's
 *      lock and must be reclaimable.
 *
 * The DB is faked at the module boundary; what is under test is which
 * `reader_state` values the WHERE clause admits, which is the whole fix.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { captured } = vi.hoisted(() => ({ captured: [] as unknown[] }));

/**
 * Capture the lock's WHERE clause. `extractReader` runs: SELECT row → UPDATE
 * lock → fetch. We reject at the fetch so the test observes the lock alone.
 */
vi.mock("@/lib/db", () => {
  const row = {
    id: "cap-1",
    url: "https://example.com/article",
    kind: "url",
    readerState: "skipped",
    readerFetchedAt: null,
    kindClassified: "article",
  };

  const whereCapture: unknown[] = [];
  const builder: Record<string, unknown> = {};
  const passthrough = () => builder;
  for (const m of ["from", "limit", "set", "returning", "orderBy", "groupBy"]) {
    builder[m] = vi.fn(passthrough);
  }
  builder.where = vi.fn((clause: unknown) => {
    whereCapture.push(clause);
    captured.push(clause);
    return builder;
  });
  builder.values = vi.fn(passthrough);
  builder.then = (onFulfilled?: (v: unknown) => unknown) =>
    Promise.resolve([row]).then(onFulfilled);

  return {
    db: {
      select: vi.fn(() => builder),
      update: vi.fn(() => builder),
      insert: vi.fn(() => builder),
    },
    schema: new Proxy({}, { get: (_t, prop) => ({ __table: String(prop) }) }),
  };
});

vi.mock("@/lib/enrichment/fetch-html", () => ({
  fetchHtml: vi.fn(async () => ({
    ok: false,
    status: 0,
    finalUrl: null,
    contentType: null,
    html: null,
    reason: "test-stub",
  })),
  urlHostname: () => "example.com",
}));
vi.mock("@/lib/enrichment/host-limiter", () => ({ awaitHost: vi.fn(async () => {}) }));

import { extractReader } from "@/lib/enrichment/reader";

beforeEach(() => {
  captured.length = 0;
});

describe("extractReader's lock admits recoverable rows", () => {
  it("reaches the fetch (i.e. it locked) instead of returning `already-locked`", async () => {
    const result = await extractReader("cap-1");

    // The stub fetch fails, so a `failed` outcome proves the lock was TAKEN.
    // Before the fix this returned `{ok:true, reason:"already-locked"}` for a
    // `skipped` row and never fetched at all.
    expect(result.reason).not.toBe("already-locked");
    expect(result.state).toBe("failed");
  });

  it("builds a lock clause that mentions every recoverable state", async () => {
    await extractReader("cap-1");

    // The lock UPDATE is the 2nd captured `where` (the SELECT is the 1st).
    expect(captured.length).toBeGreaterThanOrEqual(2);
    const rendered = JSON.stringify(captured[1], (_k, v) =>
      typeof v === "object" && v !== null && "name" in v && "table" in v
        ? { col: (v as { name: string }).name }
        : v,
    );
    for (const state of ["pending", "failed", "ready", "skipped"]) {
      expect(rendered, `lock must admit reader_state=${state}`).toContain(state);
    }
    // …and the stale-`extracting` reclaim path.
    expect(rendered).toContain("extracting");
  });
});
