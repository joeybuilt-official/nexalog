// SPDX-License-Identifier: MIT
// Wikilink extraction + persistence shared by every note-save path
// (POST /api/notes, PATCH /api/notes/[id], importer flows).
//
// The TipTap editor emits a custom <a data-wikilink href="/app/notes/<id>">
// node whose inner text is `[[label]]`. Importers / paste / raw markdown
// produce plain `[[label]]` text without the HTML wrapper. Both shapes are
// covered. HTML href is the authoritative target id (no DB lookup needed);
// raw `[[label]]` resolves by title match scoped to the user's workspaces.

import { db, schema } from "@/lib/db";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// HTML form: <a data-wikilink ... href="/app/notes/<id>" ...>[[label]]</a>
// Match the href independently of attribute order. Tolerate single or double
// quotes.
const HTML_HREF_RE =
  /<a\b[^>]*\bdata-wikilink\b[^>]*\bhref=["']\/app\/notes\/([0-9a-f-]{36})["'][^>]*>/gi;
// Also support data-wikilink with `data-id="<uuid>"` (in case href is omitted).
const HTML_DATA_ID_RE =
  /<a\b[^>]*\bdata-wikilink\b[^>]*\bdata-id=["']([0-9a-f-]{36})["'][^>]*>/gi;
// Raw markdown form: `[[label]]` outside of HTML tags. This regex is
// intentionally simple — we strip HTML first and then scan the residue.
const RAW_BRACKET_RE = /\[\[([^\[\]\n]{1,200})\]\]/g;
// Strip every <…> tag, leaving inner text.
const TAG_STRIP_RE = /<[^>]+>/g;

export type ExtractedWikilinks = {
  ids: string[]; // direct target ids (HTML form)
  labels: string[]; // raw `[[label]]` candidates (need resolve-by-title)
};

export function extractWikilinks(content: string | null | undefined): ExtractedWikilinks {
  const ids = new Set<string>();
  const labels = new Set<string>();
  if (!content) return { ids: [], labels: [] };

  for (const m of content.matchAll(HTML_HREF_RE)) {
    if (UUID_RE.test(m[1])) ids.add(m[1].toLowerCase());
  }
  for (const m of content.matchAll(HTML_DATA_ID_RE)) {
    if (UUID_RE.test(m[1])) ids.add(m[1].toLowerCase());
  }

  // Scan raw `[[…]]` only in the text residue so the HTML inner-text "[[label]]"
  // does not double-count. The HTML form already supplied the id; if the residue
  // happens to also contain "[[label]]" we treat it as a name reference.
  const residue = content.replace(TAG_STRIP_RE, " ");
  for (const m of residue.matchAll(RAW_BRACKET_RE)) {
    const label = m[1].trim();
    if (!label) continue;
    // A raw `[[uuid]]` is also a direct id reference.
    if (UUID_RE.test(label) && label.length === 36) {
      ids.add(label.toLowerCase());
      continue;
    }
    labels.add(label);
  }
  return { ids: Array.from(ids), labels: Array.from(labels) };
}

// Persist wikilinks for a single (just-saved) note. Idempotent — duplicate
// (source,target) pairs are absorbed by the unique index from migration 0014.
// Resolves raw `[[label]]` references against the user's workspaces by exact
// (case-insensitive) title match. Unresolved labels are dropped silently —
// they may resolve later as the user creates the target note (rerun
// extraction on the next save).
export async function persistWikilinks(opts: {
  sourceNoteId: string;
  workspaceIds: string[];
  content: string | null | undefined;
}): Promise<{ inserted: number; resolved: number; skipped: number }> {
  const { sourceNoteId, workspaceIds, content } = opts;
  if (!workspaceIds.length) return { inserted: 0, resolved: 0, skipped: 0 };

  const { ids, labels } = extractWikilinks(content);
  if (!ids.length && !labels.length) return { inserted: 0, resolved: 0, skipped: 0 };

  const resolvedIds = new Set<string>();

  // Verify direct ids actually belong to a note the user owns + are not the
  // self-link source. Drop everything else.
  if (ids.length) {
    const rows = await db
      .select({ id: schema.notes.id })
      .from(schema.notes)
      .where(
        and(
          inArray(schema.notes.id, ids),
          inArray(schema.notes.workspaceId, workspaceIds),
          isNull(schema.notes.deletedAt),
          ne(schema.notes.id, sourceNoteId)
        )
      );
    for (const r of rows) resolvedIds.add(r.id);
  }

  let resolvedByLabel = 0;
  if (labels.length) {
    // Case-insensitive exact-title match (lowercased on both sides).
    const lowered = labels.map((l) => l.toLowerCase());
    const candidates = await db
      .select({ id: schema.notes.id, title: schema.notes.title })
      .from(schema.notes)
      .where(
        and(
          inArray(schema.notes.workspaceId, workspaceIds),
          isNull(schema.notes.deletedAt),
          ne(schema.notes.id, sourceNoteId)
        )
      );
    const byTitle = new Map<string, string>();
    for (const c of candidates) {
      if (!c.title) continue;
      const k = c.title.toLowerCase();
      if (!byTitle.has(k)) byTitle.set(k, c.id);
    }
    for (const l of lowered) {
      const hit = byTitle.get(l);
      if (hit) {
        if (!resolvedIds.has(hit)) {
          resolvedIds.add(hit);
          resolvedByLabel += 1;
        }
      }
    }
  }

  let inserted = 0;
  for (const targetNoteId of resolvedIds) {
    await db
      .insert(schema.noteLinks)
      .values({ sourceNoteId, targetNoteId, kind: "wikilink", strength: 0.8 })
      .onConflictDoNothing();
    inserted += 1;
  }
  const skipped =
    ids.length + labels.length - resolvedIds.size - resolvedByLabel;
  return { inserted, resolved: resolvedIds.size, skipped: Math.max(0, skipped) };
}
