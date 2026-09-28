// SPDX-License-Identifier: MIT
/**
 * Brain-page type groups (pure — no React, no IO, unit-tested).
 *
 * A brain page's `type` reaches the app in two shapes: GBrain's index reports
 * the singular frontmatter type (`person`) while the page list may carry the
 * plural path segment (`people`) — exactly the mismatch `lib/graph/filters.ts`
 * already folds for the Garden. The brain index therefore REUSES that folding
 * (`groupForType`) rather than declaring a second mapping that would drift from
 * it, and adds only what is specific to a page LIST:
 *
 *   - the groups actually PRESENT in the list, in a stable order, so the chip
 *     row never renders an empty facet;
 *   - the filter semantics: an `"all"` selection shows everything, including
 *     pages whose type is not one of the five groups (notes, sources, …).
 */

import { FILTER_GROUPS, FILTER_GROUP_LABELS, groupForNode, groupForType, type FilterGroup } from "@/lib/graph/filters";

export type BrainGroup = FilterGroup;

export const BRAIN_GROUP_LABELS: Record<BrainGroup, string> = FILTER_GROUP_LABELS;

export interface BrainPageLike {
  slug: string;
  title: string;
  type: string;
}

/** The group a page belongs to, or null for a type the five chips do not cover. */
export function groupForPage(page: BrainPageLike): BrainGroup | null {
  return groupForNode(page) ?? groupForType(page.type);
}

/** Groups present in this list, in the canonical chip order. */
export function groupsInPages(pages: readonly BrainPageLike[]): BrainGroup[] {
  const present = new Set<BrainGroup>();
  for (const p of pages) {
    const g = groupForPage(p);
    if (g) present.add(g);
  }
  return FILTER_GROUPS.filter((g) => present.has(g));
}

/**
 * Apply the active groups + a title/slug query.
 *
 * `"all"` means no type narrowing — every page shows, including the ungrouped
 * ones. Selecting specific groups is an include-set over grouped pages; a page
 * with NO group is visible only under `"all"`, matching the garden's rule that
 * narrowing to "People" must not leave stray notes on screen.
 */
export function filterByGroups<T extends BrainPageLike>(
  pages: readonly T[],
  active: readonly BrainGroup[] | "all",
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  return pages.filter((p) => {
    if (active !== "all") {
      const g = groupForPage(p);
      if (!g || !active.includes(g)) return false;
    }
    if (!needle) return true;
    return (
      p.title.toLowerCase().includes(needle) || p.slug.toLowerCase().includes(needle)
    );
  });
}
