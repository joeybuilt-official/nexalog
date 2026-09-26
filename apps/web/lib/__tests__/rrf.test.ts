// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { fuseRrf, RRF_K } from "@/lib/search/rrf";

describe("fuseRrf (M2)", () => {
  it("returns empty for empty input", () => {
    expect(fuseRrf([])).toEqual([]);
    expect(fuseRrf([{ ids: [] }, { ids: [] }])).toEqual([]);
  });

  it("ranks a top hit on one list above a mid hit on the same list", () => {
    const out = fuseRrf([{ ids: ["a", "b", "c"] }]);
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c"]);
    // 1/(k+1) > 1/(k+2) > 1/(k+3)
    expect(out[0].score).toBeGreaterThan(out[1].score);
    expect(out[1].score).toBeGreaterThan(out[2].score);
  });

  it("a note that ranks middling in BOTH lists beats one that ranks top in only one — the M2 win", () => {
    // Mirrors the chat-grounding case: "ask your notes" question with a
    // mid-FTS hit that is also a mid-semantic hit; vs. a top-FTS hit that
    // does not appear in the semantic list at all.
    //
    //   FTS list:       [top-fts-only, both-mid, ...]    rank both-mid = 2
    //   Semantic list:  [top-sem-only, both-mid, ...]    rank both-mid = 2
    //
    // both-mid: 1/(60+2) + 1/(60+2)  ≈ 0.0323
    // top-fts-only: 1/(60+1)         ≈ 0.0164
    const fused = fuseRrf([
      { ids: ["top-fts-only", "both-mid", "filler-fts"] },
      { ids: ["top-sem-only", "both-mid", "filler-sem"] },
    ]);
    const ids = fused.map((r) => r.id);
    expect(ids[0]).toBe("both-mid");
    const both = fused.find((r) => r.id === "both-mid")!;
    const topFts = fused.find((r) => r.id === "top-fts-only")!;
    expect(both.score).toBeGreaterThan(topFts.score);
  });

  it("ids absent from a list contribute zero (no NaN, no negative scores)", () => {
    const fused = fuseRrf([
      { ids: ["only-in-a"] },
      { ids: ["only-in-b"] },
    ]);
    // Both reachable, both score 1/(k+1).
    expect(fused.length).toBe(2);
    for (const r of fused) expect(r.score).toBeGreaterThan(0);
    expect(fused[0].score).toBeCloseTo(fused[1].score, 12);
  });

  it("respects per-list weight to down-rank a noisier signal", () => {
    // Same id, same rank on two lists, but list B is half-weighted.
    const a = fuseRrf([
      { ids: ["x"], weight: 1 },
      { ids: ["x"], weight: 1 },
    ]);
    const b = fuseRrf([
      { ids: ["x"], weight: 1 },
      { ids: ["x"], weight: 0.5 },
    ]);
    expect(a[0].score).toBeGreaterThan(b[0].score);
  });

  it("k=60 by default and is exposed for callers that want to override", () => {
    expect(RRF_K).toBe(60);
    const lowK = fuseRrf([{ ids: ["a"] }], 1)[0].score; // 1/(1+1) = 0.5
    const defK = fuseRrf([{ ids: ["a"] }])[0].score;    // 1/(60+1) ≈ 0.0164
    expect(lowK).toBeGreaterThan(defK);
  });
});
