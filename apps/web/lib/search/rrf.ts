// SPDX-License-Identifier: MIT
//
// Reciprocal Rank Fusion (Cormack et al., 2009): combine multiple ranked lists
// of ids into a single score per id by summing 1 / (k + rank). Higher score =
// more relevant. k = 60 is the original-paper default and what /api/search has
// always used.
//
// Designed to be tiny, dependency-free, and shared between the search route
// and the chat-grounding path (M2). Each ranker passes its own list of ids in
// rank order; ids missing from a ranker contribute 0 from that ranker.

export const RRF_K = 60;

export interface RankedList {
  // Identifier per item; whatever stable key the caller already uses (uuid,
  // composite kind:id, etc.). Order in this array IS the rank: index 0 = #1.
  ids: string[];
  // Optional weight (1 by default). Lets a caller down-weight a noisy ranker
  // without rewriting the math.
  weight?: number;
}

export interface RrfResult {
  id: string;
  score: number;
}

export function fuseRrf(lists: RankedList[], k = RRF_K): RrfResult[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    const w = list.weight ?? 1;
    list.ids.forEach((id, i) => {
      const rank = i + 1;
      const inc = w / (k + rank);
      scores.set(id, (scores.get(id) ?? 0) + inc);
    });
  }
  return Array.from(scores.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

// Convenience: build a ranked list from a (id → rank-score-desc) map. Used by
// the search route to convert ts_rank_cd / cosine-distance maps into the
// positional ranks RRF expects.
export function rankByDesc<T>(
  rows: T[],
  idOf: (r: T) => string,
  scoreOf: (r: T) => number
): string[] {
  return rows
    .slice()
    .sort((a, b) => scoreOf(b) - scoreOf(a))
    .map(idOf);
}

// Convenience: build a ranked list from a (id → distance-asc) map (e.g.
// pgvector cosine where smaller = nearer). The search route's `vecRank` is
// already in distance-ascending order from the SQL `ORDER BY dist`, so this
// is just a `slice + map` but documents the intent.
export function rankByAsc<T>(
  rows: T[],
  idOf: (r: T) => string,
  distOf: (r: T) => number
): string[] {
  return rows
    .slice()
    .sort((a, b) => distOf(a) - distOf(b))
    .map(idOf);
}
