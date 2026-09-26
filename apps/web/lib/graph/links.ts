// SPDX-License-Identifier: MIT
/**
 * Link extraction + neighborhood slicing over the brain repo's markdown.
 *
 * Used by the LOCAL fallback of `GET /api/graph`: when GBrain is unreachable
 * or unconfigured, the route builds a graph straight from the brain repo — the
 * pages' `[[wiki links]]` are the edges. Pure and unit-tested; the route does
 * the IO.
 *
 * Extraction returns *candidates* (normalized, deduped). Resolving a candidate
 * against the set of pages that actually exist is the caller's job, which is
 * why prose-looking links simply fall away at resolution time instead of
 * needing a cleverer regex here.
 */

const WIKILINK_RE = /\[\[([^\]\n]{1,200})\]\]/g;
const FENCED_CODE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`\n]*`/g;

/**
 * Reduce one `[[…]]` body to a slug candidate, or null when it cannot be one.
 *
 * Handles `[[slug|label]]` (alias) and `[[slug#section]]` (anchor), strips a
 * trailing `.md`, lowercases, and turns spaces into hyphens (`[[Example
 * Person]]` → `example-person`) so a human-written link can still land
 * on the real page. Anything that is not a plausible path segment is dropped.
 */
export function normalizeWikilinkTarget(raw: string): string | null {
  const withoutAlias = raw.split("|")[0] ?? "";
  const withoutAnchor = withoutAlias.split("#")[0] ?? "";
  const value = withoutAnchor
    .trim()
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/\.md$/, "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\s+/g, "-");
  if (!value) return null;
  for (const segment of value.split("/")) {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(segment)) return null;
  }
  return value;
}

/**
 * Every distinct `[[wiki link]]` target in a markdown body. Fenced and inline
 * code are stripped first so documented examples do not become edges.
 */
export function extractWikilinkTargets(markdown: string): string[] {
  if (!markdown) return [];
  const body = markdown.replace(FENCED_CODE_RE, " ").replace(INLINE_CODE_RE, " ");
  const out = new Set<string>();
  for (const match of body.matchAll(WIKILINK_RE)) {
    const target = normalizeWikilinkTarget(match[1]);
    if (target) out.add(target);
  }
  return [...out];
}

export interface LinkLike {
  from: string;
  to: string;
}

/**
 * Depth-limited BFS over `links` from `root`, both directions (the brain's
 * links are directed, but a reader exploring a page means its neighbourhood
 * either way). Returns the slugs within `depth` hops, root included.
 *
 * When `root` is null or not a known page there is nothing to narrow by, so
 * every known slug comes back — the caller renders the whole graph instead of
 * an empty canvas.
 */
export function neighborhoodSlice(
  known: Iterable<string>,
  links: readonly LinkLike[],
  root: string | null,
  depth: number,
): Set<string> {
  const all = new Set(known);
  if (!root || !all.has(root)) return all;

  const maxDepth = Number.isFinite(depth) ? Math.max(0, Math.floor(depth)) : 1;

  const adjacency = new Map<string, Set<string>>();
  const connect = (a: string, b: string) => {
    let neighbours = adjacency.get(a);
    if (!neighbours) {
      neighbours = new Set<string>();
      adjacency.set(a, neighbours);
    }
    neighbours.add(b);
  };
  for (const link of links) {
    if (!all.has(link.from) || !all.has(link.to) || link.from === link.to) continue;
    connect(link.from, link.to);
    connect(link.to, link.from);
  }

  const seen = new Set<string>([root]);
  let frontier: string[] = [root];
  for (let hop = 0; hop < maxDepth && frontier.length > 0; hop += 1) {
    const next: string[] = [];
    for (const slug of frontier) {
      for (const neighbour of adjacency.get(slug) ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return seen;
}
