// SPDX-License-Identifier: MIT
/**
 * Reimport Karakeep bookmarks from a JSON export and backfill
 * `bookmarked_at` / `source_payload` on existing capture_sources rows.
 *
 * Strategy (non-destructive, idempotent):
 *   1. Read export file in shape `{ bookmarks: [...] }` (Karakeep REST v1).
 *   2. Parse via `parseKarakeepJson` to get { url, bookmarkedAt, title, payload }.
 *   3. Normalize URL via `normalizeUrl` (same as runtime import path).
 *   4. For each unique URL:
 *      a. UPDATE matching capture_sources row in target workspace where
 *         `bookmarked_at IS NULL` — set bookmarked_at, source_payload,
 *         import_source = 'karakeep'.
 *      b. If row exists with bookmarked_at already set → COALESCE: only fill
 *         missing fields (import_source, source_payload).
 *      c. If no row exists → INSERT a new capture_sources row.
 *
 * Re-run = no-op (COALESCE clauses skip already-populated columns).
 *
 * Usage:
 *   tsx scripts/reimport-karakeep.ts <path/to/export.json>
 *     [--user-id=<id>]
 *     [--workspace=<id>]
 *     [--dry-run]
 */

import { readFileSync } from "fs";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { parseKarakeepJson } from "../lib/importers";
import { normalizeUrl } from "../lib/url-normalize";

interface Args {
  file: string;
  userId?: string;
  workspaceId?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const positional = argv.filter((a) => !a.startsWith("--"));
  if (!positional[0]) {
    console.error(
      "Usage: reimport-karakeep.ts <export.json> [--user-id=…] [--workspace=…] [--dry-run]",
    );
    process.exit(1);
  }
  const file = positional[0];
  const userId = argv.find((a) => a.startsWith("--user-id="))?.split("=")[1];
  const workspaceId = argv.find((a) => a.startsWith("--workspace="))?.split("=")[1];
  const dryRun = argv.includes("--dry-run");
  return { file, userId, workspaceId, dryRun };
}

async function pickWorkspace(
  userId?: string,
  workspaceId?: string,
): Promise<{ workspaceId: string; userId: string }> {
  if (workspaceId && userId) return { workspaceId, userId };

  // Prefer an existing karakeep workspace; otherwise fall back to the
  // workspace with the most capture_sources overall.
  const k = await db.execute(sql`
    SELECT workspace_id, user_id, COUNT(*)::int AS n
    FROM nexalog.capture_sources
    WHERE import_source = 'karakeep'
    GROUP BY workspace_id, user_id
    ORDER BY n DESC
    LIMIT 1
  `);
  const kFirst = (k as unknown as Array<{ workspace_id: string; user_id: string }>)[0];
  if (kFirst) {
    return {
      workspaceId: workspaceId ?? kFirst.workspace_id,
      userId: userId ?? kFirst.user_id,
    };
  }

  const any = await db.execute(sql`
    SELECT workspace_id, user_id, COUNT(*)::int AS n
    FROM nexalog.capture_sources
    GROUP BY workspace_id, user_id
    ORDER BY n DESC
    LIMIT 1
  `);
  const first = (any as unknown as Array<{ workspace_id: string; user_id: string }>)[0];
  if (!first) {
    throw new Error(
      "No capture_sources rows exist — pass --workspace and --user-id explicitly",
    );
  }
  return {
    workspaceId: workspaceId ?? first.workspace_id,
    userId: userId ?? first.user_id,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const raw = readFileSync(args.file, "utf8");
  const parsed = parseKarakeepJson(raw);
  console.log(`Parsed ${parsed.length} Karakeep bookmarks from ${args.file}`);

  // Normalize + dedup by canonical URL. Earliest bookmarkedAt wins.
  const byNormalized = new Map<string, (typeof parsed)[number]>();
  let withDate = 0;
  for (const b of parsed) {
    const norm = normalizeUrl(b.url);
    if (!norm) continue;
    const next = { ...b, url: norm };
    const prev = byNormalized.get(norm);
    if (!prev) {
      byNormalized.set(norm, next);
    } else {
      const prevTs = prev.bookmarkedAt?.getTime() ?? Number.POSITIVE_INFINITY;
      const curTs = next.bookmarkedAt?.getTime() ?? Number.POSITIVE_INFINITY;
      if (curTs < prevTs) byNormalized.set(norm, next);
    }
  }
  for (const b of byNormalized.values()) if (b.bookmarkedAt) withDate++;
  console.log(
    `After URL normalize: ${byNormalized.size} unique URLs, ${withDate} with dates`,
  );

  if (args.dryRun) {
    console.log("DRY RUN — no DB writes. Sample of first 5 URL→date pairs:");
    let i = 0;
    for (const b of byNormalized.values()) {
      console.log(`  ${b.url}  →  ${b.bookmarkedAt?.toISOString() ?? "NULL"}`);
      if (++i >= 5) break;
    }
    return;
  }

  const { workspaceId, userId } = await pickWorkspace(args.userId, args.workspaceId);
  console.log(`Targeting workspace=${workspaceId} user=${userId}`);

  let backfilled = 0; // bookmarked_at NULL → date
  let metadataFilled = 0; // payload/source filled, date already set
  let inserted = 0;
  let skipped = 0;
  const importedAt = new Date();

  let i = 0;
  for (const b of byNormalized.values()) {
    if (++i % 200 === 0) {
      console.log(
        `  progress ${i}/${byNormalized.size}  backfilled=${backfilled} inserted=${inserted} metaFilled=${metadataFilled} skipped=${skipped}`,
      );
    }
    if (!b.bookmarkedAt) {
      skipped++;
      continue;
    }

    // (a) Backfill rows where bookmarked_at IS NULL — full overwrite of those
    // blank metadata fields.
    const filled = await db
      .update(schema.captureSources)
      .set({
        bookmarkedAt: b.bookmarkedAt,
        sourcePayload: b.payload ?? null,
        importedAt,
        importSource: "karakeep",
      })
      .where(
        and(
          eq(schema.captureSources.workspaceId, workspaceId),
          eq(schema.captureSources.url, b.url),
          isNull(schema.captureSources.bookmarkedAt),
        ),
      )
      .returning({ id: schema.captureSources.id });

    if (filled.length > 0) {
      backfilled += filled.length;
      continue;
    }

    // (b) Row already has bookmarked_at: COALESCE-fill any missing
    // import_source / source_payload only. Do not touch bookmarked_at.
    const coalesced = await db.execute(sql`
      UPDATE nexalog.capture_sources
      SET
        import_source = COALESCE(import_source, 'karakeep'),
        source_payload = COALESCE(source_payload, ${JSON.stringify(b.payload ?? null)}::jsonb)
      WHERE workspace_id = ${workspaceId}
        AND url = ${b.url}
        AND (import_source IS NULL OR source_payload IS NULL)
      RETURNING id
    `);
    const coalescedRows =
      (coalesced as unknown as { rowCount?: number }).rowCount ??
      (Array.isArray(coalesced) ? coalesced.length : 0);
    if (coalescedRows > 0) {
      metadataFilled += coalescedRows;
      continue;
    }

    // Existing row already fully populated?
    const existing = await db
      .select({ id: schema.captureSources.id })
      .from(schema.captureSources)
      .where(
        and(
          eq(schema.captureSources.workspaceId, workspaceId),
          eq(schema.captureSources.url, b.url),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      skipped++;
      continue;
    }

    // (c) Brand new URL.
    await db
      .insert(schema.captureSources)
      .values({
        workspaceId,
        userId,
        kind: "url",
        content: b.url,
        url: b.url,
        state: "raw",
        ogTitle: b.title ?? null,
        bookmarkedAt: b.bookmarkedAt,
        importedAt,
        importSource: "karakeep",
        sourcePayload: b.payload ?? null,
      })
      .onConflictDoNothing();
    inserted++;
  }

  console.log(`\nDone.`);
  console.log(`  Rows backfilled (NULL → date):  ${backfilled}`);
  console.log(`  Rows metadata-filled (date set): ${metadataFilled}`);
  console.log(`  Rows newly inserted:             ${inserted}`);
  console.log(`  Rows skipped (already complete): ${skipped}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Reimport failed:", err);
  process.exit(1);
});
