// SPDX-License-Identifier: MIT
import type { getParentIdsFor, summariseCounts } from "@/lib/projects/store";

type Counts = Awaited<ReturnType<typeof summariseCounts>>;
type ParentMap = Awaited<ReturnType<typeof getParentIdsFor>>;

/**
 * The shape of a `projects` row returned by Drizzle. The enrichment function is
 * deliberately loose (it only needs `id`) so it works with raw rows, projected
 * summaries, and test fixtures without importing the full schema type.
 */
export type ProjectEnrichmentRow = { id: string } & Record<string, unknown>;

/**
 * Adds `parentId`, `itemCount` and `subProjectCount` to a set of project rows.
 *
 * WHY THIS EXISTS
 * ---------------
 * `GET /api/sync` ships project rows to the native client, but the mobile browse
 * surface needs nesting (which lives in `project_items`, not the `projects`
 * table) and two counts. Computing them on the client would require syncing the
 * whole `project_items` table, which has no `userId`/`updatedAt`/`deletedAt`
 * columns and therefore does not fit the generic delta-sync loop.
 *
 * The smallest fix is to enrich the project rows at sync time, using the same
 * batched helpers the web list uses. Keeping the enrichment in a pure function
 * lets it be unit-tested with fake helpers, instead of mocking Drizzle in a route
 * test.
 */
export async function enrichProjectRows(
  rows: ProjectEnrichmentRow[],
  deps: {
    getParentIdsFor: (projectIds: string[]) => Promise<ParentMap>;
    summariseCounts: (projectIds: string[]) => Promise<Counts>;
  },
): Promise<ProjectEnrichmentRow[]> {
  if (rows.length === 0) return rows;

  const projectIds = rows.map((row) => row.id);
  const [parents, counts] = await Promise.all([
    deps.getParentIdsFor(projectIds),
    deps.summariseCounts(projectIds),
  ]);

  return rows.map((row) => ({
    ...row,
    parentId: parents.get(row.id) ?? null,
    itemCount: counts.itemCounts.get(row.id) ?? 0,
    subProjectCount: counts.subProjectCounts.get(row.id) ?? 0,
  }));
}
