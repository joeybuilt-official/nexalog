// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";

import { enrichProjectRows, type ProjectEnrichmentRow } from "@/lib/sync/project-enrichment";

/**
 * Unit tests for the sync-time project enrichment that adds `parentId`,
 * `itemCount` and `subProjectCount` to mirrored project rows.
 *
 * These fields live in `project_items` and are not columns on `projects`, so the
 * generic delta-sync loop cannot fetch them. The route calls this helper with
 * the same batched helpers the web list uses; here those helpers are faked so
 * the rule under test — "merge each row with its enrichment" — is isolated from
 * SQL.
 */

function fakeDeps(maps: {
  parents?: Map<string, string>;
  itemCounts?: Map<string, number>;
  subProjectCounts?: Map<string, number>;
}) {
  return {
    getParentIdsFor: async () => maps.parents ?? new Map(),
    summariseCounts: async () => ({
      itemCounts: maps.itemCounts ?? new Map(),
      subProjectCounts: maps.subProjectCounts ?? new Map(),
    }),
  };
}

describe("enrichProjectRows", () => {
  it("returns an empty array unchanged", async () => {
    const out = await enrichProjectRows([], fakeDeps({}));
    expect(out).toEqual([]);
  });

  it("adds parentId, itemCount and subProjectCount to each row", async () => {
    const rows: ProjectEnrichmentRow[] = [
      { id: "a", name: "Alpha" },
      { id: "b", name: "Beta" },
    ];

    const out = await enrichProjectRows(rows, fakeDeps({
      parents: new Map([["a", "root"]]),
      itemCounts: new Map([["a", 3]]),
      subProjectCounts: new Map([["a", 2], ["b", 0]]),
    }));

    expect(out).toEqual([
      { id: "a", name: "Alpha", parentId: "root", itemCount: 3, subProjectCount: 2 },
      { id: "b", name: "Beta", parentId: null, itemCount: 0, subProjectCount: 0 },
    ]);
  });

  it("does not mutate the original rows", async () => {
    const rows: ProjectEnrichmentRow[] = [{ id: "a", name: "Alpha" }];
    await enrichProjectRows(rows, fakeDeps({ parents: new Map([["a", "root"]]) }));
    expect(rows[0]).not.toHaveProperty("parentId");
  });

  it("passes the correct ids to the helper functions", async () => {
    const seen = { ids: [] as string[][] };
    const rows: ProjectEnrichmentRow[] = [{ id: "x" }, { id: "y" }];

    await enrichProjectRows(rows, {
      getParentIdsFor: async (ids) => {
        seen.ids.push(ids);
        return new Map();
      },
      summariseCounts: async (ids) => {
        seen.ids.push(ids);
        return { itemCounts: new Map(), subProjectCounts: new Map() };
      },
    });

    expect(seen.ids).toEqual([["x", "y"], ["x", "y"]]);
  });
});
