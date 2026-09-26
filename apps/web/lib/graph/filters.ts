// SPDX-License-Identifier: MIT
/**
 * Knowledge-Garden graph filters (pure — no React, no IO, unit-tested).
 *
 * `/app/graph` draws the brain's link graph. Two controls act on the graph the
 * page ALREADY has loaded — no refetch — so the deterministic radial layout
 * stays put while the reader narrows (positions live in the component; only
 * the viewBox moves, see ./viewport.ts):
 *
 *   1. per-type chips — people / companies / concepts / projects / atoms, and
 *   2. a title search that filters nodes and centres the chosen one.
 *
 * A node's `type` reaches the UI in two shapes, because /api/graph reports the
 * slug's first path segment for seeds and the page's frontmatter type once it
 * has read the page: `people` (plural) and `person` (singular). Both fold into
 * one filter group here, so the UI never has to care which shape it received.
 *
 * Filter semantics (deliberate, and covered by tests): the five chips are an
 * include-set, all ON by default. A node that belongs to a group is visible
 * iff its group is ON. A node with NO group — notes, sources, media, unknown
 * directories — is visible only while every chip is ON: narrowing to "People"
 * must not leave stray notes on the canvas.
 */

export interface GraphNodeLike {
  slug: string;
  title: string;
  type: string;
}

export const FILTER_GROUPS = [
  "people",
  "companies",
  "concepts",
  "projects",
  "atoms",
] as const;

export type FilterGroup = (typeof FILTER_GROUPS)[number];

/** Chip labels, in the order the UI renders them. */
export const FILTER_GROUP_LABELS: Record<FilterGroup, string> = {
  people: "People",
  companies: "Companies",
  concepts: "Concepts",
  projects: "Projects",
  atoms: "Atoms",
};

const TYPE_TO_GROUP: Record<string, FilterGroup> = {
  person: "people",
  people: "people",
  company: "companies",
  companies: "companies",
  concept: "concepts",
  concepts: "concepts",
  project: "projects",
  projects: "projects",
  atom: "atoms",
  atoms: "atoms",
};

/** Normalize one type string (singular or plural) to a filter group. */
export function groupForType(type: string | null | undefined): FilterGroup | null {
  if (typeof type !== "string") return null;
  const key = type.trim().toLowerCase();
  return TYPE_TO_GROUP[key] ?? null;
}

/**
 * A node's group: the frontmatter type when we have it, else the slug's first
 * path segment (`people/example-person` → people). Null for anything the
 * five chips do not cover.
 */
export function groupForNode(node: GraphNodeLike): FilterGroup | null {
  return groupForType(node.type) ?? groupForType(node.slug.split("/")[0] ?? "");
}

/** How many nodes each chip covers (ungrouped nodes are not counted). */
export function countsByGroup(nodes: readonly GraphNodeLike[]): Record<FilterGroup, number> {
  const counts: Record<FilterGroup, number> = {
    people: 0,
    companies: 0,
    concepts: 0,
    projects: 0,
    atoms: 0,
  };
  for (const node of nodes) {
    const group = groupForNode(node);
    if (group) counts[group] += 1;
  }
  return counts;
}

/** Every chip on = no type narrowing; the state in which ungrouped nodes show. */
export function isUnfiltered(activeGroups: readonly FilterGroup[]): boolean {
  return FILTER_GROUPS.every((group) => activeGroups.includes(group));
}

/** Case-insensitive match on the title, falling back to the slug. */
export function matchesQuery(node: GraphNodeLike, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    node.title.toLowerCase().includes(needle) ||
    node.slug.toLowerCase().includes(needle)
  );
}

/**
 * The nodes a reader should see right now: active type groups + title query.
 * Order is preserved (the caller's layout order), so nothing jumps.
 */
export function filterNodes(
  nodes: readonly GraphNodeLike[],
  activeGroups: readonly FilterGroup[],
  query: string,
): GraphNodeLike[] {
  const narrowed = !isUnfiltered(activeGroups);
  return nodes.filter((node) => {
    const group = groupForNode(node);
    if (group) {
      if (!activeGroups.includes(group)) return false;
    } else if (narrowed) {
      return false;
    }
    return matchesQuery(node, query);
  });
}

/**
 * Up to `limit` search hits, best first: title-prefix beats title-substring
 * beats slug-substring, ties broken alphabetically so the suggestion list does
 * not reshuffle between keystrokes. Empty query → no suggestions.
 */
export function rankMatches(
  nodes: readonly GraphNodeLike[],
  query: string,
  limit = 8,
): GraphNodeLike[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const scored: Array<{ node: GraphNodeLike; rank: number }> = [];
  for (const node of nodes) {
    const title = node.title.toLowerCase();
    const slug = node.slug.toLowerCase();
    let rank: number;
    if (title.startsWith(needle)) rank = 0;
    else if (title.includes(needle)) rank = 1;
    else if (slug.includes(needle)) rank = 2;
    else continue;
    scored.push({ node, rank });
  }

  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.node.title.localeCompare(b.node.title) ||
      a.node.slug.localeCompare(b.node.slug),
  );
  return scored.slice(0, Math.max(0, limit)).map((entry) => entry.node);
}
