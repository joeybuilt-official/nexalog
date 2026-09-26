// SPDX-License-Identifier: MIT
/**
 * Karakeep tag dedup — drains the 14k+ junk tags ("8-9 hour cooking time"
 * etc.) by clustering near-duplicates on character-trigram cosine and
 * collapsing to canonical tags.
 *
 * Usage:
 *   pnpm tsx scripts/tag-dedup.ts             # apply
 *   pnpm tsx scripts/tag-dedup.ts --dry       # report only, no writes
 *   pnpm tsx scripts/tag-dedup.ts --workspace=<uuid>   # one workspace
 *
 * Idempotent: if a row in capture_source_tags already points at the
 * canonical, no-op. Orphan tags (no remaining assignments) are deleted at
 * the end.
 */

import { db, schema } from "../lib/db";
import { eq, sql } from "drizzle-orm";
import { clusterTags, type TagInput, type TagCluster } from "../lib/tags/dedup";

interface RunOpts {
  dry: boolean;
  workspaceId: string | null;
}

function parseArgs(): RunOpts {
  const argv = process.argv.slice(2);
  const dry = argv.includes("--dry") || argv.includes("--dry-run");
  const wsArg = argv.find((a) => a.startsWith("--workspace="));
  const workspaceId = wsArg ? wsArg.split("=", 2)[1] : null;
  return { dry, workspaceId };
}

async function loadTagsByWorkspace(workspaceId: string): Promise<TagInput[]> {
  // bookmark_tags joined with assignment counts via a single SQL.
  const rows = await db.execute<{
    id: string;
    name: string;
    cnt: string;
  }>(sql`
    SELECT t.id::text AS id,
           t.name AS name,
           COUNT(cst.id)::text AS cnt
    FROM nexalog.bookmark_tags t
    LEFT JOIN nexalog.capture_source_tags cst ON cst.tag_id = t.id
    WHERE t.workspace_id = ${workspaceId}::uuid
    GROUP BY t.id, t.name
  `);
  return (rows as unknown as Array<{ id: string; name: string; cnt: string }>).map((r) => ({
    id: r.id,
    name: r.name,
    assignmentCount: Number(r.cnt) || 0,
  }));
}

async function listWorkspaces(): Promise<string[]> {
  const rows = await db.execute<{ workspace_id: string }>(sql`
    SELECT DISTINCT workspace_id::text AS workspace_id
    FROM nexalog.bookmark_tags
  `);
  return (rows as unknown as Array<{ workspace_id: string }>).map((r) => r.workspace_id);
}

interface MergeStats {
  workspaceId: string;
  inputTags: number;
  clusters: number;
  canonicalTags: number;
  mergedTags: number;
  reassignedAssignments: number;
  deletedOrphans: number;
  sample: Array<{ canonical: string; merged: string[] }>;
}

async function processWorkspace(
  workspaceId: string,
  dry: boolean,
): Promise<MergeStats> {
  const tags = await loadTagsByWorkspace(workspaceId);
  const clusters = clusterTags(tags);

  // Filter to clusters that actually merge (size > 1).
  const merging = clusters.filter((c) => c.members.length > 1);
  const stats: MergeStats = {
    workspaceId,
    inputTags: tags.length,
    clusters: clusters.length,
    canonicalTags: clusters.length,
    mergedTags: merging.reduce((acc, c) => acc + c.members.length - 1, 0),
    reassignedAssignments: 0,
    deletedOrphans: 0,
    sample: merging.slice(0, 8).map((c) => ({
      canonical: c.canonicalName,
      merged: c.members
        .filter((m) => m.id !== c.canonicalId)
        .map((m) => m.name)
        .slice(0, 6),
    })),
  };

  if (dry) {
    return stats;
  }

  // Apply within a transaction per cluster to bound the blast radius.
  for (const cluster of merging) {
    const merged = await applyCluster(cluster);
    stats.reassignedAssignments += merged;
  }

  // Delete orphan tags (no assignments left) for this workspace.
  if (merging.length > 0) {
    const result = await db.execute<{ count: string }>(sql`
      WITH orphans AS (
        SELECT t.id
        FROM nexalog.bookmark_tags t
        LEFT JOIN nexalog.capture_source_tags cst ON cst.tag_id = t.id
        WHERE t.workspace_id = ${workspaceId}::uuid
        GROUP BY t.id
        HAVING COUNT(cst.id) = 0
      ), del AS (
        DELETE FROM nexalog.bookmark_tags
        WHERE id IN (SELECT id FROM orphans)
        RETURNING 1
      )
      SELECT COUNT(*)::text AS count FROM del
    `);
    const arr = result as unknown as Array<{ count: string }>;
    stats.deletedOrphans = Number(arr[0]?.count ?? 0);
  }

  return stats;
}

async function applyCluster(cluster: TagCluster): Promise<number> {
  const canonical = cluster.canonicalId;
  const otherIds = cluster.members
    .filter((m) => m.id !== canonical)
    .map((m) => m.id);
  if (!otherIds.length) return 0;

  // Re-point capture_source_tags rows. We can't blindly UPDATE because
  // the (capture_source_id, canonical) pair might already exist — would
  // violate any uniqueness in future. Use a two-step:
  //   1. Insert canonical row for every (capture_source_id) currently
  //      pointing at any non-canonical member, ON CONFLICT DO NOTHING.
  //   2. Delete the non-canonical assignments.
  const ids = otherIds.map((s) => `'${s}'`).join(",");
  const inserted = await db.execute<{ count: string }>(sql.raw(`
    WITH ins AS (
      INSERT INTO nexalog.capture_source_tags (capture_source_id, tag_id)
      SELECT DISTINCT cst.capture_source_id, '${canonical}'::uuid
      FROM nexalog.capture_source_tags cst
      WHERE cst.tag_id IN (${ids})
        AND NOT EXISTS (
          SELECT 1 FROM nexalog.capture_source_tags x
          WHERE x.capture_source_id = cst.capture_source_id
            AND x.tag_id = '${canonical}'::uuid
        )
      RETURNING 1
    )
    SELECT COUNT(*)::text AS count FROM ins
  `));
  const insArr = inserted as unknown as Array<{ count: string }>;
  const insCount = Number(insArr[0]?.count ?? 0);

  await db.execute(sql.raw(`
    DELETE FROM nexalog.capture_source_tags
    WHERE tag_id IN (${ids})
  `));

  return insCount + otherIds.length;
}

async function main(): Promise<void> {
  const opts = parseArgs();
  const targets = opts.workspaceId ? [opts.workspaceId] : await listWorkspaces();
  if (!targets.length) {
    console.log("No workspaces with bookmark_tags found.");
    return;
  }

  const allStats: MergeStats[] = [];
  for (const ws of targets) {
    const stats = await processWorkspace(ws, opts.dry);
    allStats.push(stats);
    console.log(
      `[${ws}] tags=${stats.inputTags} clusters=${stats.clusters} ` +
      `merged=${stats.mergedTags} reassigned=${stats.reassignedAssignments} ` +
      `orphans_deleted=${stats.deletedOrphans} dry=${opts.dry}`,
    );
    if (stats.sample.length) {
      console.log("  Sample mappings:");
      for (const s of stats.sample) {
        console.log(`    "${s.canonical}" ⟵ ${s.merged.map((m) => `"${m}"`).join(", ")}`);
      }
    }
  }

  // Roll-up.
  const totals = allStats.reduce(
    (a, s) => ({
      tags: a.tags + s.inputTags,
      canonical: a.canonical + s.canonicalTags,
      merged: a.merged + s.mergedTags,
      reassigned: a.reassigned + s.reassignedAssignments,
      orphansDeleted: a.orphansDeleted + s.deletedOrphans,
    }),
    { tags: 0, canonical: 0, merged: 0, reassigned: 0, orphansDeleted: 0 },
  );
  console.log(
    `\nTotals: ${totals.tags} → ${totals.canonical} canonical ` +
    `(merged ${totals.merged}, reassigned ${totals.reassigned}, ` +
    `orphans deleted ${totals.orphansDeleted}), dry=${opts.dry}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
