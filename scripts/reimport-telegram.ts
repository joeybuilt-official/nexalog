// SPDX-License-Identifier: MIT
/**
 * Reimport Telegram saved-messages from an HTML export and backfill
 * `bookmarked_at` on existing capture_sources rows whose original import
 * never persisted a `source_payload` (the 616 stuck-date rows where
 * `import_source = 'telegram'` and `bookmarked_at IS NULL`).
 *
 * Strategy (non-destructive):
 *   1. Walk every `messages*.html` in the given directory.
 *   2. For each URL → bookmarkedAt mapping:
 *      a. Try to UPDATE existing capture_sources rows matching:
 *           workspace_id = <user>'s workspace
 *           import_source = 'telegram'
 *           url = <normalized URL>
 *           bookmarked_at IS NULL                       -- idempotent
 *         Set bookmarked_at = <date>, source_payload = <html payload>.
 *      b. If no row was updated AND the URL is brand new, INSERT a fresh
 *         capture_source.
 *
 * Re-running on already-populated rows is a no-op (the
 * `bookmarked_at IS NULL` clause skips them).
 *
 * Usage:
 *   tsx scripts/reimport-telegram.ts <path/to/ChatExport_YYYY-MM-DD>
 *     [--user-id=<id>]   # default: looks up first telegram-import owner
 *     [--workspace=<id>] # default: workspace_id from first matching row
 *     [--dry-run]
 */

import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { parseTelegramHtmlMulti } from "../lib/importers/telegram-html";
import { normalizeUrl } from "../lib/url-normalize";

interface Args {
  dir: string;
  userId?: string;
  workspaceId?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const positional = argv.filter((a) => !a.startsWith("--"));
  if (!positional[0]) {
    console.error("Usage: reimport-telegram.ts <ChatExport_dir> [--user-id=…] [--workspace=…] [--dry-run]");
    process.exit(1);
  }
  const dir = positional[0];
  const userId = argv.find((a) => a.startsWith("--user-id="))?.split("=")[1];
  const workspaceId = argv.find((a) => a.startsWith("--workspace="))?.split("=")[1];
  const dryRun = argv.includes("--dry-run");
  return { dir, userId, workspaceId, dryRun };
}

async function pickWorkspaceFromTelegramRows(
  userId?: string,
  workspaceId?: string,
): Promise<{ workspaceId: string; userId: string }> {
  if (workspaceId && userId) return { workspaceId, userId };

  // Find the workspace with the most telegram-imported rows.
  const rows = await db.execute(sql`
    SELECT workspace_id, user_id, COUNT(*)::int AS n
    FROM nexalog.capture_sources
    WHERE import_source = 'telegram'
    GROUP BY workspace_id, user_id
    ORDER BY n DESC
    LIMIT 1
  `);
  const first = (rows as unknown as Array<{ workspace_id: string; user_id: string }>)[0];
  if (!first) {
    throw new Error("No existing rows with import_source='telegram' — pass --workspace and --user-id");
  }
  return {
    workspaceId: workspaceId ?? first.workspace_id,
    userId: userId ?? first.user_id,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Read every messages*.html in the export dir.
  const entries = readdirSync(args.dir).filter((f) => /^messages\d*\.html?$/i.test(f));
  if (!entries.length) {
    console.error(`No messages*.html files found in ${args.dir}`);
    process.exit(1);
  }
  entries.sort((a, b) => {
    const na = parseInt(a.match(/(\d+)/)?.[1] ?? "1", 10);
    const nb = parseInt(b.match(/(\d+)/)?.[1] ?? "1", 10);
    return na - nb;
  });
  console.log(`Found ${entries.length} HTML file(s): ${entries.join(", ")}`);

  const blobs = entries.map((f) => readFileSync(join(args.dir, f), "utf8"));
  const parsed = parseTelegramHtmlMulti(blobs);
  console.log(`Parsed ${parsed.messages.length} messages, ${parsed.bookmarks.length} unique URLs`);

  // Normalize URLs the same way the import path does.
  const byNormalized = new Map<string, (typeof parsed.bookmarks)[number]>();
  let withDate = 0;
  for (const b of parsed.bookmarks) {
    const norm = normalizeUrl(b.url);
    if (!norm) continue;
    const next = { ...b, url: norm };
    const prev = byNormalized.get(norm);
    if (!prev) {
      byNormalized.set(norm, next);
    } else {
      // Earliest date wins.
      const prevTs = prev.bookmarkedAt?.getTime() ?? Number.POSITIVE_INFINITY;
      const curTs = next.bookmarkedAt?.getTime() ?? Number.POSITIVE_INFINITY;
      if (curTs < prevTs) byNormalized.set(norm, next);
    }
  }
  for (const b of byNormalized.values()) if (b.bookmarkedAt) withDate++;
  console.log(`After URL normalize: ${byNormalized.size} unique URLs, ${withDate} with dates`);

  if (args.dryRun) {
    console.log("DRY RUN — no DB writes. Sample of first 5 URL→date pairs:");
    let i = 0;
    for (const b of byNormalized.values()) {
      console.log(`  ${b.url}  →  ${b.bookmarkedAt?.toISOString() ?? "NULL"}`);
      if (++i >= 5) break;
    }
    return;
  }

  const { workspaceId, userId } = await pickWorkspaceFromTelegramRows(
    args.userId,
    args.workspaceId,
  );
  console.log(`Targeting workspace=${workspaceId} user=${userId}`);

  let updated = 0;
  let inserted = 0;
  let skipped = 0;
  const importedAt = new Date();

  for (const b of byNormalized.values()) {
    if (!b.bookmarkedAt) {
      skipped++;
      continue;
    }
    // Idempotent UPDATE: only touch rows where bookmarked_at is still NULL.
    const result = await db
      .update(schema.captureSources)
      .set({
        bookmarkedAt: b.bookmarkedAt,
        sourcePayload: b.payload ?? null,
        importedAt,
        importSource: "telegram",
      })
      .where(
        and(
          eq(schema.captureSources.workspaceId, workspaceId),
          eq(schema.captureSources.url, b.url),
          eq(schema.captureSources.importSource, "telegram"),
          isNull(schema.captureSources.bookmarkedAt),
        ),
      )
      .returning({ id: schema.captureSources.id });

    if (result.length > 0) {
      updated += result.length;
      continue;
    }

    // Row may already be backfilled (idempotent re-run) OR brand new.
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
        importSource: "telegram",
        sourcePayload: b.payload ?? null,
      })
      .onConflictDoNothing();
    inserted++;
  }

  console.log(`\nDone.`);
  console.log(`  Rows backfilled (NULL → date): ${updated}`);
  console.log(`  Rows newly inserted:           ${inserted}`);
  console.log(`  Rows skipped:                  ${skipped}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Reimport failed:", err);
  process.exit(1);
});
