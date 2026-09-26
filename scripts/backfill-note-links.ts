// SPDX-License-Identifier: MIT
// One-off: re-parse every existing note's content for `[[wikilinks]]` and
// upsert resulting (source,target) rows into nexalog.note_links. Idempotent
// (unique index on (source_note_id, target_note_id) absorbs repeats).
//
// Usage:  pnpm tsx scripts/backfill-note-links.ts
//
// Read-only against `notes`; INSERTs against `note_links` only. Safe to run
// repeatedly. Run AFTER deploy of C3 to populate historical links.

import { db, schema } from "@/lib/db";
import { isNull, eq } from "drizzle-orm";
import { persistWikilinks } from "@/lib/notes/wikilinks";
import { getUserWorkspaces } from "@/lib/workspace";

async function main() {
  const rows = await db
    .select({
      id: schema.notes.id,
      userId: schema.notes.userId,
      content: schema.notes.content,
    })
    .from(schema.notes)
    .where(isNull(schema.notes.deletedAt));

  console.log(`scanning ${rows.length} notes…`);
  // Cache workspace lookups per user.
  const wsCache = new Map<string, string[]>();
  let totalInserted = 0;
  let totalResolved = 0;
  let scanned = 0;
  for (const r of rows) {
    scanned += 1;
    let workspaceIds = wsCache.get(r.userId);
    if (!workspaceIds) {
      const wss = await getUserWorkspaces(r.userId);
      workspaceIds = wss.map((w) => w.id);
      wsCache.set(r.userId, workspaceIds);
    }
    if (!workspaceIds.length) continue;
    const { inserted, resolved } = await persistWikilinks({
      sourceNoteId: r.id,
      workspaceIds,
      content: r.content,
    });
    totalInserted += inserted;
    totalResolved += resolved;
    if (scanned % 250 === 0) {
      console.log(
        `  …${scanned}/${rows.length} scanned · ${totalInserted} link rows inserted`
      );
    }
  }
  console.log(
    `done. scanned=${scanned} resolved=${totalResolved} inserted=${totalInserted}`
  );
  // Silence unused-var lints in this script.
  void eq;
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
