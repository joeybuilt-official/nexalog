// SPDX-License-Identifier: MIT
/**
 * Karakeep tag dedup — clustering + canonical-tag selection.
 *
 * Why not call Plexo for embeddings? The brief permits a local fallback
 * "if Plexo embed isn't exposed". Plexo has `/api/v1/embeddings/:ws/...`
 * for re-embedding *memories*, but no public `embed-text` endpoint, and
 * we're operating on tag *names* (1-8 tokens) where character-trigram
 * cosine is well-known to be very competitive with neural embeddings.
 *
 * Pipeline:
 *   1. Normalize tag names (lowercase, strip punctuation, collapse spaces).
 *   2. Build char-trigram TF vectors with tag-name boundary markers.
 *   3. Single-link hierarchical agglomerative clustering at cosine ≥ 0.85.
 *   4. In each cluster, canonical = the shortest name; ties broken by the
 *      most-assigned tag (so we don't promote a rare typo).
 *
 * The script (`scripts/tag-dedup.ts`) wraps this with DB I/O.
 */

export interface TagInput {
  id: string;
  name: string;
  assignmentCount: number; // # rows in capture_source_tags pointing here
}

export interface TagCluster {
  canonicalId: string;
  canonicalName: string;
  members: TagInput[];
}

export const COSINE_THRESHOLD = 0.85;

// ── Public API ───────────────────────────────────────────────────────────────

export function clusterTags(
  tags: TagInput[],
  threshold: number = COSINE_THRESHOLD,
): TagCluster[] {
  if (tags.length === 0) return [];

  // Normalize + vectorize once.
  const vectors: VecCarrier[] = tags.map((t) => ({
    tag: t,
    norm: normalize(t.name),
    vec: trigramVector(normalize(t.name)),
  }));
  // Pre-compute L2 norms for cosine.
  for (const v of vectors) v.length = vectorLength(v.vec);

  // Bucket by an inverted index over trigrams so we don't do n² compares
  // on 14k+ tags.
  const tagsByTrigram = new Map<string, number[]>();
  vectors.forEach((v, idx) => {
    for (const tg of v.vec.keys()) {
      let bucket = tagsByTrigram.get(tg);
      if (!bucket) {
        bucket = [];
        tagsByTrigram.set(tg, bucket);
      }
      bucket.push(idx);
    }
  });

  // Union-find over cluster ids.
  const parent = new Array(vectors.length).fill(0).map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  // Single-link agglomerative: for each anchor tag, look up the union of
  // tags sharing ≥1 trigram (skipping mega-buckets that are pure noise),
  // then test cosine. Per-anchor `seen` Set keeps memory bounded — never
  // larger than the anchor's candidate set. The earlier global pair-Set
  // blew through V8's max Set size on 14k+ tags.
  const VERY_COMMON_TRIGRAM = 4000;
  for (let ai = 0; ai < vectors.length; ai++) {
    const seen = new Set<number>();
    seen.add(ai);
    for (const tg of vectors[ai].vec.keys()) {
      const bucket = tagsByTrigram.get(tg);
      if (!bucket || bucket.length > VERY_COMMON_TRIGRAM) continue;
      for (const bi of bucket) {
        if (seen.has(bi)) continue;
        seen.add(bi);
        if (find(ai) === find(bi)) continue;
        const sim = cosine(
          vectors[ai].vec,
          vectors[bi].vec,
          vectors[ai].length,
          vectors[bi].length,
        );
        if (sim >= threshold) union(ai, bi);
      }
    }
  }

  // Materialize clusters.
  const groups = new Map<number, number[]>();
  for (let i = 0; i < vectors.length; i++) {
    const root = find(i);
    let g = groups.get(root);
    if (!g) {
      g = [];
      groups.set(root, g);
    }
    g.push(i);
  }

  const out: TagCluster[] = [];
  for (const memberIdxs of groups.values()) {
    const members = memberIdxs.map((i) => vectors[i].tag);
    const canonical = pickCanonical(members);
    out.push({
      canonicalId: canonical.id,
      canonicalName: canonical.name,
      members,
    });
  }
  return out;
}

export function pickCanonical(members: TagInput[]): TagInput {
  // Sort: shortest name first, then most assignments.
  const sorted = [...members].sort((a, b) => {
    const an = normalize(a.name);
    const bn = normalize(b.name);
    if (an.length !== bn.length) return an.length - bn.length;
    if (a.assignmentCount !== b.assignmentCount) {
      return b.assignmentCount - a.assignmentCount;
    }
    return an < bn ? -1 : an > bn ? 1 : 0;
  });
  return sorted[0];
}

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Char-trigram vector ──────────────────────────────────────────────────────

interface VecCarrier {
  tag: TagInput;
  norm: string;
  vec: Map<string, number>;
  length?: number;
}

export function trigramVector(s: string): Map<string, number> {
  const padded = `  ${s}  `;
  const v = new Map<string, number>();
  for (let i = 0; i < padded.length - 2; i++) {
    const tri = padded.slice(i, i + 3);
    v.set(tri, (v.get(tri) ?? 0) + 1);
  }
  return v;
}

function vectorLength(v: Map<string, number>): number {
  let sum = 0;
  for (const x of v.values()) sum += x * x;
  return Math.sqrt(sum);
}

export function cosine(
  a: Map<string, number>,
  b: Map<string, number>,
  lenA?: number,
  lenB?: number,
): number {
  // Iterate the smaller map for performance.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [k, v] of small) {
    const o = large.get(k);
    if (o) dot += v * o;
  }
  const la = lenA ?? vectorLength(a);
  const lb = lenB ?? vectorLength(b);
  if (la === 0 || lb === 0) return 0;
  return dot / (la * lb);
}

