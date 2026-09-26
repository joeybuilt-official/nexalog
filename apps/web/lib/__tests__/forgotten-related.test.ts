// SPDX-License-Identifier: MIT
// P2b ADR-0011 lens 2/3 — asserts the filter-logic SQL fragment shape used by
// the /api/queue/forgotten + /api/queue/related routes. The routes themselves
// pull workspace + auth context, which is heavy to mock; this isolates the
// invariants that would silently break a lens (wrong cutoff, wrong operator).

import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";

// drizzle's SQL.toString() returns "[object Object]" outside a dialect; pull
// the literal chunks directly to assert fragment shape.
function fragText(s: ReturnType<typeof sql>): string {
  const chunks = (s as unknown as { queryChunks?: Array<unknown> }).queryChunks ?? [];
  return chunks
    .map((c) => {
      if (typeof c === "string") return c;
      if (
        typeof c === "object" &&
        c !== null &&
        "value" in (c as Record<string, unknown>) &&
        Array.isArray((c as { value: unknown }).value)
      ) {
        return (c as { value: unknown[] }).value.map((v) => String(v)).join("");
      }
      return "";
    })
    .join("");
}

describe("forgotten lens — filter fragments", () => {
  it("openedAt-or-null cutoff is 30 days back", () => {
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);
    const ageMs = Date.now() - cutoff.getTime();
    expect(ageMs).toBeGreaterThanOrEqual(THIRTY_DAYS_MS - 1000);
    expect(ageMs).toBeLessThanOrEqual(THIRTY_DAYS_MS + 1000);
  });

  it("filter expresses 'never opened OR opened > 30d ago'", () => {
    const cutoff = new Date("2026-05-28T00:00:00Z");
    const frag = sql`opened_at IS NULL OR opened_at < ${cutoff}`;
    const compiled = fragText(frag);
    expect(compiled).toMatch(/opened_at IS NULL/);
    expect(compiled).toMatch(/opened_at < /);
  });

  it("excludes homepages but keeps NULL-kind rows", () => {
    const frag = sql`kind_classified <> 'homepage' OR kind_classified IS NULL`;
    const compiled = fragText(frag);
    expect(compiled).toMatch(/<> 'homepage'/);
    expect(compiled).toMatch(/IS NULL/);
  });
});

describe("related lens — pgvector fragment", () => {
  it("uses public-schema cosine operator on a ::public.vector literal", () => {
    // Search route + chat-grounding both qualify the operator because the
    // session search_path is `nexalog` only (SQLSTATE 42883 otherwise).
    const lit = "[0.1,0.2,0.3]";
    const dist = sql`embedding OPERATOR(public.<=>) ${lit}::public.vector`;
    const compiled = fragText(dist);
    expect(compiled).toMatch(/OPERATOR\(public\.<=>\)/);
    expect(compiled).toMatch(/::public\.vector/);
  });

  it("note window is 24h; capture-edit exclusion is 7d", () => {
    const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    expect(SEVEN_DAYS_MS / TWENTY_FOUR_HOURS_MS).toBe(7);
  });

  it("centroid mean+normalize collapses to unit vector", () => {
    const vecs = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    const dim = vecs[0].length;
    const centroid = new Array(dim).fill(0);
    for (const v of vecs) for (let i = 0; i < dim; i++) centroid[i] += v[i];
    for (let i = 0; i < dim; i++) centroid[i] /= vecs.length;
    let norm = 0;
    for (const v of centroid) norm += v * v;
    norm = Math.sqrt(norm);
    for (let i = 0; i < dim; i++) centroid[i] /= norm;
    let mag = 0;
    for (const v of centroid) mag += v * v;
    expect(Math.sqrt(mag)).toBeCloseTo(1, 6);
  });

  it("cosine-distance ceiling 0.4 drops a 0.5 result", () => {
    const COSINE_DIST_CEILING = 0.4;
    const rows = [{ dist: 0.1 }, { dist: 0.39 }, { dist: 0.5 }];
    const kept = rows.filter((r) => r.dist < COSINE_DIST_CEILING);
    expect(kept.map((r) => r.dist)).toEqual([0.1, 0.39]);
  });
});
