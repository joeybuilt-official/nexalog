// SPDX-License-Identifier: MIT
// NEXALOG-PROJECTS — pure browse layer for the projects list: search, filter,
// sort, and the tree projection the page renders. No React, no I/O, no DB, so
// the rules are unit-testable with plain values and the client component holds
// no business logic (clean-architecture: a conditional that encodes a rule does
// not live in a UI component).
//
// The tree is ADR-0001 Amendment A1.7's, and the invariant it must never break
// is the load-bearing part of this file: **a project that is itself a
// sub-project is never hidden because its parent was filtered out.** A1.4/A1.7
// put it as "a parent row is always rendered for any rendered child" — so when a
// sub-project matches the search or the filter and its parent does not, the
// parent is rendered as a CONTEXT ROW (dimmed, `contextOnly`) with the matching
// child indented under it. Nothing is ever promoted out of the tree or dropped.
//
// Two structural rules also live here rather than in the page, because they are
// the same "never drop a row" rule:
//
//   1. a project whose parent is not in the set is a root (its parent was
//      deleted or belongs to another workspace), and
//   2. a project whose parent is ITSELF a child — which the two-level nesting
//      policy forbids, so this is malformed data — is promoted to a root rather
//      than rendered at a second indent level. That also makes a bad-data cycle
//      (a.parentId = b, b.parentId = a) render both rows instead of neither.

import { LIFECYCLE_STATES, type LifecycleState } from "@/lib/projects/domain";

// ---- value types ----------------------------------------------------------

/**
 * The fields browsing needs, declared here so this module depends on the store
 * rather than the other way round (`ProjectSummary` satisfies it structurally —
 * no mapper and no import from the I/O layer). Timestamps accept a `Date` or a
 * string because the value arrives either straight from the server read or as a
 * serialized prop.
 */
export interface BrowsableProject {
  id: string;
  name: string;
  description: string | null;
  lifecycleState: LifecycleState;
  livingDocUpdatedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  parentId: string | null;
  itemCount: number;
  subProjectCount: number;
}

/** `all` plus every lifecycle value — derived, never a hand-written list. */
export const LIFECYCLE_FILTERS = ["all", ...LIFECYCLE_STATES] as const;
export type LifecycleFilter = (typeof LIFECYCLE_FILTERS)[number];

export const PROJECT_SORTS = [
  "name",
  "recently-updated",
  "recently-created",
  "most-members",
  "most-sub-projects",
] as const;
export type ProjectSort = (typeof PROJECT_SORTS)[number];

export const PROJECT_SORT_LABELS: Record<ProjectSort, string> = {
  name: "Name (A–Z)",
  "recently-updated": "Recently updated",
  "recently-created": "Recently created",
  "most-members": "Most members",
  "most-sub-projects": "Most sub-projects",
};

export interface BrowseState {
  query: string;
  lifecycle: LifecycleFilter;
  /** Narrow to projects that have at least one sub-project. */
  hasSubProjectsOnly: boolean;
  sort: ProjectSort;
}

/** The list's default order — the store's own `updated_at desc`, so nothing moves on first paint. */
export const DEFAULT_BROWSE_STATE: BrowseState = {
  query: "",
  lifecycle: "all",
  hasSubProjectsOnly: false,
  sort: "recently-updated",
};

/** One root row plus the sub-projects rendered under it. */
export interface BrowseGroup {
  parent: BrowsableProject;
  /**
   * The parent does not match and is rendered only because one of its children
   * does. A1.7: a parent row is always rendered for any rendered child.
   */
  contextOnly: boolean;
  /** The matching sub-projects rendered under this root, in sort order. */
  children: BrowsableProject[];
}
// ---- search ---------------------------------------------------------------

/** Whitespace-separated, lowercased, empties dropped. */
function tokenize(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Instant text match over `name` AND `description`, case-insensitive. Every
 * token must appear in one of the two, so "angel release" matches the project
 * whose name carries both words in either order and does not match one that only
 * carries "angel". An empty/whitespace query matches everything.
 */
export function matchesQuery(
  project: Pick<BrowsableProject, "name" | "description">,
  query: string,
): boolean {
  const tokens = tokenize(query);
  if (tokens.length === 0) return true;
  const haystack = `${project.name}\n${project.description ?? ""}`.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

export function matchesLifecycle(
  project: Pick<BrowsableProject, "lifecycleState">,
  filter: LifecycleFilter,
): boolean {
  return filter === "all" || project.lifecycleState === filter;
}

export function matchesHasSubProjects(
  project: Pick<BrowsableProject, "subProjectCount">,
  only: boolean,
): boolean {
  return !only || project.subProjectCount > 0;
}

/** Search + lifecycle. The A1.7-safe scope narrowing the ROOT ROW must satisfy. */
export function matchesFilters(project: BrowsableProject, state: BrowseState): boolean {
  return matchesQuery(project, state.query) && matchesLifecycle(project, state.lifecycle);
}

/**
 * Every predicate, including the has-sub-projects toggle. This is the full
 * "does this row match what the reader asked for" question, and it is what the
 * sub-project rows are filtered by.
 */
export function matchesAllFilters(project: BrowsableProject, state: BrowseState): boolean {
  return matchesFilters(project, state) && matchesHasSubProjects(project, state.hasSubProjectsOnly);
}

// ---- sort -----------------------------------------------------------------

/**
 * Epoch millis, or `0` for an absent/unparseable timestamp — which is older than
 * every real row, so unknown dates sink to the end of a newest-first sort instead
 * of poisoning the comparator with `NaN`.
 */
function time(value: Date | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const millis = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(millis) ? millis : 0;
}

/** Name, case-insensitive, then id — so equal keys never leave output to chance. */
function tieBreak(a: BrowsableProject, b: BrowsableProject): number {
  const byName = a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  return byName !== 0 ? byName : a.id.localeCompare(b.id);
}

/** A comparator for one sort key. Total and deterministic: no key comparison ends in 0. */
export function compareProjects(sort: ProjectSort): (a: BrowsableProject, b: BrowsableProject) => number {
  return (a, b) => {
    let delta: number;
    switch (sort) {
      case "name":
        delta = a.name.localeCompare(b.name, "en", { sensitivity: "base" });
        break;
      case "recently-updated":
        delta = time(b.updatedAt) - time(a.updatedAt);
        break;
      case "recently-created":
        delta = time(b.createdAt) - time(a.createdAt);
        break;
      case "most-members":
        delta = b.itemCount - a.itemCount;
        break;
      case "most-sub-projects":
        delta = b.subProjectCount - a.subProjectCount;
        break;
    }
    return delta !== 0 ? delta : tieBreak(a, b);
  };
}

/** Sort a flat list with one of the list's keys (the component's use; also the tests'). */
export function sortProjects<T extends BrowsableProject>(projects: T[], sort: ProjectSort): T[] {
  return [...projects].sort(compareProjects(sort));
}

// ---- tree -----------------------------------------------------------------

/**
 * Split the flat list into root rows and their children, honouring the two
 * structural rules in the file header (unresolvable parent -> root; parent that
 * is itself a child -> promoted to root). Input order is preserved; ordering is
 * the caller's job.
 */
export function buildProjectTree(projects: BrowsableProject[]): {
  roots: BrowsableProject[];
  childrenOf: Map<string, BrowsableProject[]>;
} {
  const byId = new Map(projects.map((p) => [p.id, p]));

  const parentOf = (project: BrowsableProject): string | null =>
    project.parentId && project.parentId !== project.id && byId.has(project.parentId)
      ? project.parentId
      : null;

  const isRoot = (project: BrowsableProject): boolean => {
    const parentId = parentOf(project);
    if (!parentId) return true;
    // The parent must itself be a root — anything else would be a second indent
    // level at best and a cycle at worst, and either way it would hide a row.
    return parentOf(byId.get(parentId)!) !== null;
  };

  const roots: BrowsableProject[] = [];
  const childrenOf = new Map<string, BrowsableProject[]>();

  for (const project of projects) {
    if (isRoot(project)) {
      roots.push(project);
      continue;
    }
    const parentId = parentOf(project)!;
    const siblings = childrenOf.get(parentId);
    if (siblings) siblings.push(project);
    else childrenOf.set(parentId, [project]);
  }

  return { roots, childrenOf };
}

/**
 * The list the page renders. Roots (and context roots) come out in sort order,
 * each carrying only the sub-projects that match — with the A1.7 guarantee that a
 * matching child is always rendered, and its parent rendered for it.
 *
 * **Where the has-sub-projects toggle applies, and why it is not symmetrical.**
 * A sub-project is childless by construction (the two-level policy forbids a
 * third level), so its `subProjectCount` is always 0 and applying that toggle to
 * sub-project rows would filter out every one of them — including the rows the
 * toggle is named after. So the toggle narrows ROOT rows only:
 *
 *   - a ROOT row is kept iff it passes every filter, or one of its sub-projects
 *     is kept (A1.7 — the parent then renders as a context row);
 *   - a SUB-PROJECT row is kept iff it passes search + lifecycle. The toggle
 *     never removes one, and the reader who asked for "projects with
 *     sub-projects" therefore gets the children too.
 *
 * Net effect: the toggle never hides a sub-project, and it changes nothing
 * visually on its own — with "All states" and an empty search it keeps every root
 * that has one, which is precisely the set it selects for.
 *
 * A group is ordered by its REPRESENTATIVE row: the parent when the parent is
 * kept on its own merits, else its first matching child. So "search for X, sort
 * by recently updated" orders results by the thing the reader searched for
 * rather than by the context row that happens to carry it.
 */
export function browseProjects(projects: BrowsableProject[], state: BrowseState): BrowseGroup[] {
  const { roots, childrenOf } = buildProjectTree(projects);
  const compare = compareProjects(state.sort);

  const groups: BrowseGroup[] = [];
  for (const parent of roots) {
    const parentMatches = matchesAllFilters(parent, state);
    const children = (childrenOf.get(parent.id) ?? [])
      .filter((child) => matchesFilters(child, state))
      .sort(compare);
    if (!parentMatches && children.length === 0) continue;
    groups.push({ parent, contextOnly: !parentMatches, children });
  }

  const representative = (group: BrowseGroup): BrowsableProject =>
    group.contextOnly && group.children.length > 0 ? group.children[0] : group.parent;

  return groups.sort((a, b) => compare(representative(a), representative(b)));
}

/** Rows rendered — the parent of every group plus its children (context rows included). */
export function countRenderedRows(groups: BrowseGroup[]): number {
  return groups.reduce((total, group) => total + 1 + group.children.length, 0);
}

/**
 * How many rendered rows match what the reader asked for, in their own right —
 * context rows are excluded, because counting a parent the reader did not ask for
 * as a hit would overstate the result set.
 */
export function countMatches(projects: BrowsableProject[], state: BrowseState): number {
  const { roots, childrenOf } = buildProjectTree(projects);
  let matches = 0;
  for (const root of roots) {
    if (matchesAllFilters(root, state)) matches += 1;
    for (const child of childrenOf.get(root.id) ?? []) {
      if (matchesFilters(child, state)) matches += 1;
    }
  }
  return matches;
}
