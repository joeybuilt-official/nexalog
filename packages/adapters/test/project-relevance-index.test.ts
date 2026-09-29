// SPDX-License-Identifier: MIT
/**
 * GbrainProjectRelevanceIndex — the one translation this adapter does, pinned.
 *
 * WHY THE COSINE MAPPING IS THE THING UNDER TEST
 * ----------------------------------------------
 * gbrain's search response carries BOTH a fused rank `score` and a `cosine`. They
 * are not interchangeable and the difference is measurable on the live index: every
 * project page links to every other one, so RRF's backlink boost lifts them all on
 * every query — a sourdough recipe scored 0.81 against `projects/panoply`. The
 * reconciler's floor is a claim about SEMANTIC closeness, so this adapter's whole
 * job is to deliver the cosine and refuse to invent one. A test that asserted the
 * `score` passthrough would pass while the feature emitted a plan change for every
 * bookmark ever saved.
 *
 * WHAT ELSE IS PINNED
 * -------------------
 *   - the type filter is pushed DOWN to the search (`types: ['project']`), not
 *     applied after it. Applied after, a post-filter over 8 shared slots would
 *     return whichever project pages happened to survive alongside every note and
 *     atom in the brain;
 *   - a hit with no usable slug is dropped — one malformed row must not fail a
 *     whole reconcile pass;
 *   - an empty/whitespace query performs NO search at all (it would be a search
 *     whose results mean nothing, and it costs a round trip);
 *   - a transport failure PROPAGATES. "I could not ask the index" must never be
 *     reported as "nothing is relevant" — that is how a broken pass reads as a
 *     healthy one.
 */

import { describe, it, expect, vi } from "vitest";

import { GbrainProjectRelevanceIndex } from "../src/gbrain-proposals/project-relevance-index";

function client(hits: unknown[]) {
  const search = vi.fn(
    async (_query: string, _opts?: { limit?: number; types?: string[] }) => hits as never,
  );
  return { search };
}

describe("GbrainProjectRelevanceIndex", () => {
  it("maps hits to slug + cosine and asks the search for project pages only", async () => {
    const c = client([
      { slug: "projects/fylo", title: "fylo", type: "project", score: 0.93, cosine: 0.72 },
    ]);
    const index = new GbrainProjectRelevanceIndex({ client: c });

    const out = await index.findProjectCandidates({ text: "fylo CI failed", limit: 8 });

    expect(c.search).toHaveBeenCalledTimes(1);
    const [, opts] = c.search.mock.calls[0];
    // The filter goes DOWN to the index. See the header for why.
    expect(opts).toMatchObject({ types: ["project"], limit: 8 });
    expect(out).toEqual([{ slug: "projects/fylo", title: "fylo", cosine: 0.72 }]);
  });

  it("reports a missing cosine as null rather than 0 or the rank score", async () => {
    const c = client([
      { slug: "projects/fylo", title: "fylo", type: "project", score: 0.93, cosine: undefined },
      { slug: "projects/gbrain", title: "gbrain", type: "project", score: 0.91, cosine: null },
    ]);
    const index = new GbrainProjectRelevanceIndex({ client: c });

    const out = await index.findProjectCandidates({ text: "anything", limit: 8 });

    expect(out).toEqual([
      { slug: "projects/fylo", title: "fylo", cosine: null },
      { slug: "projects/gbrain", title: "gbrain", cosine: null },
    ]);
    // Explicit: the fused score must not leak into the cosine slot.
    expect(out[0].cosine).not.toBe(0.93);
  });

  it("drops a hit with no usable slug instead of emitting a broken candidate", async () => {
    const c = client([
      { slug: "", title: "nameless", type: "project", score: 0.9, cosine: 0.8 },
      { slug: "projects/fylo", title: "fylo", type: "project", score: 0.9, cosine: 0.7 },
    ]);
    const index = new GbrainProjectRelevanceIndex({ client: c });

    const out = await index.findProjectCandidates({ text: "x", limit: 8 });

    expect(out).toHaveLength(1);
    expect(out[0].slug).toBe("projects/fylo");
  });

  it("performs no search for an empty query", async () => {
    const c = client([{ slug: "projects/fylo", title: "fylo", type: "project", cosine: 0.9 }]);
    const index = new GbrainProjectRelevanceIndex({ client: c });

    expect(await index.findProjectCandidates({ text: "   ", limit: 8 })).toEqual([]);
    expect(c.search).not.toHaveBeenCalled();
  });

  it("propagates a search failure instead of returning no candidates", async () => {
    const failing = {
      search: vi.fn(async () => {
        throw new Error("GBrain MCP HTTP 503 (search)");
      }),
    };
    const index = new GbrainProjectRelevanceIndex({ client: failing as never });

    // "I could not ask" must never be answered as "nothing is relevant".
    await expect(index.findProjectCandidates({ text: "x", limit: 8 })).rejects.toThrow(/503/);
  });
});
