// SPDX-License-Identifier: MIT
/**
 * Seed selection for the whole-brain graph view (`GET /api/graph` with no
 * `?slug=`).
 *
 * The route draws a bounded neighborhood, so it needs a starting set. That set
 * used to be a hardcoded list of slugs, one of which (`people/example-person`)
 * was the repo's placeholder convention rather than a page that exists in any
 * real brain — `traverse_graph` on a missing slug answers `[]`, so the seed
 * silently contributed nothing and the garden lost a whole region without
 * saying so. Any hardcoded seed has the same failure mode the day a page is
 * renamed.
 *
 * So the seeds are DERIVED from the brain instead: one page per typed
 * directory, read live. The pure part lives here (unit-tested, no IO); the
 * route does the `list_pages` calls and hands the rows in.
 *
 * `selectGraphSeeds` is deliberately total: an empty or unreadable input
 * yields `[]`, and the caller falls back — a graph with no seeds must degrade
 * down the existing ladder, never draw an empty canvas as if it were the
 * brain.
 */

/**
 * The typed directories the garden models as graph roots, in preference order.
 *
 * `atoms` is excluded on purpose: it is date-sharded leaf material, so a seed
 * there anchors the view to one day's fragments instead of the brain's
 * structure. `notes` is excluded for the same reason — it has no structure to
 * anchor a neighborhood to.
 */
export const GRAPH_SEED_TYPES = ["projects", "companies", "people", "concepts"] as const;

export type GraphSeedType = (typeof GRAPH_SEED_TYPES)[number];

/** One candidate row, shaped like the `list_pages` summary the route reads. */
export interface GraphSeedCandidate {
  slug: string;
  title: string;
  type: string;
  updatedAt: string | null;
}

/** Default cap on derived seeds — mirrors the route's bounded neighborhood. */
export const MAX_GRAPH_SEEDS = 6;

/**
 * Pick a bounded, diverse seed set from live page rows.
 *
 * `byType` is keyed by the FILTER GROUP (`projects`, `companies`, …) and each
 * bucket is expected newest-first (what `list_pages` returns by default), so
 * the first entry is the most recently touched page of that type — a
 * reasonable "show me my live work" anchor.
 *
 * Round-robins across the types rather than draining one bucket first, so a
 * brain with a hundred projects still puts its people and companies on the
 * canvas. Slugs are de-duplicated: a page can be listed under more than one
 * bucket when a pack declares subtypes, and a repeated seed would just re-walk
 * the same neighborhood.
 */
export function selectGraphSeeds(
  byType: Partial<Record<GraphSeedType, readonly GraphSeedCandidate[]>>,
  limit: number = MAX_GRAPH_SEEDS,
): string[] {
  const buckets = GRAPH_SEED_TYPES.map((type) => (byType[type] ?? []).map((row) => row.slug)).filter(
    (slugs) => slugs.length > 0,
  );
  if (buckets.length === 0 || limit <= 0) return [];

  const picked: string[] = [];
  const seen = new Set<string>();
  // Round-robin: one from each type per pass, so every represented type gets a
  // seed before any type gets a second one.
  for (let i = 0; picked.length < limit; i += 1) {
    let addedThisPass = false;
    for (const bucket of buckets) {
      const slug = bucket[i];
      if (slug === undefined) continue;
      addedThisPass = true;
      if (seen.has(slug)) continue;
      seen.add(slug);
      picked.push(slug);
      if (picked.length >= limit) break;
    }
    // Every bucket is exhausted — nothing left to walk.
    if (!addedThisPass) break;
  }
  return picked;
}
