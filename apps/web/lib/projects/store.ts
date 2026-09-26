// SPDX-License-Identifier: MIT
// NEXALOG-PROJECTS — I/O layer for the project domain. Ownership-guarded
// grouping-by-reference + grouped-unit hydration + context digest. Keeps
// routes thin and the security guard in one place (no IDOR).

import { db, schema } from "@/lib/db";
import { and, eq, inArray } from "drizzle-orm";
import type { ItemKind, ProjectContextDigest } from "@/lib/projects/domain";

export type UnitRef = { kind: ItemKind; id: string };
export type GroupedUnit = { kind: ItemKind; id: string; title: string };

/**
 * Batched ownership check. Given candidate refs, return only those whose
 * underlying unit belongs to one of the user's workspaces. One query per kind
 * (no N+1). Anything not returned is rejected by the caller.
 */
export async function filterOwnedRefs(
  workspaceIds: string[],
  refs: UnitRef[],
): Promise<UnitRef[]> {
  if (workspaceIds.length === 0 || refs.length === 0) return [];

  const byKind: Record<ItemKind, string[]> = { note: [], bookmark: [], journal: [] };
  for (const r of refs) byKind[r.kind].push(r.id);

  const owned: UnitRef[] = [];

  if (byKind.note.length) {
    const rows = await db
      .select({ id: schema.notes.id })
      .from(schema.notes)
      .where(and(inArray(schema.notes.id, byKind.note), inArray(schema.notes.workspaceId, workspaceIds)));
    for (const row of rows) owned.push({ kind: "note", id: row.id });
  }
  if (byKind.bookmark.length) {
    const rows = await db
      .select({ id: schema.captureSources.id })
      .from(schema.captureSources)
      .where(
        and(
          inArray(schema.captureSources.id, byKind.bookmark),
          inArray(schema.captureSources.workspaceId, workspaceIds),
        ),
      );
    for (const row of rows) owned.push({ kind: "bookmark", id: row.id });
  }
  if (byKind.journal.length) {
    const rows = await db
      .select({ id: schema.journalEntries.id })
      .from(schema.journalEntries)
      .where(
        and(
          inArray(schema.journalEntries.id, byKind.journal),
          inArray(schema.journalEntries.workspaceId, workspaceIds),
        ),
      );
    for (const row of rows) owned.push({ kind: "journal", id: row.id });
  }

  return owned;
}

/** Hydrate grouped refs into display units (title per kind) for a project. */
export async function hydrateGroupedUnits(projectId: string): Promise<GroupedUnit[]> {
  const items = await db
    .select({ itemKind: schema.projectItems.itemKind, itemId: schema.projectItems.itemId })
    .from(schema.projectItems)
    .where(eq(schema.projectItems.projectId, projectId));

  const ids: Record<ItemKind, string[]> = { note: [], bookmark: [], journal: [] };
  for (const it of items) {
    const k = it.itemKind as ItemKind;
    if (ids[k]) ids[k].push(it.itemId);
  }

  const titleById = new Map<string, GroupedUnit>();

  if (ids.note.length) {
    const rows = await db
      .select({ id: schema.notes.id, title: schema.notes.title })
      .from(schema.notes)
      .where(inArray(schema.notes.id, ids.note));
    for (const r of rows) titleById.set(`note:${r.id}`, { kind: "note", id: r.id, title: r.title || "Untitled" });
  }
  if (ids.bookmark.length) {
    const rows = await db
      .select({ id: schema.captureSources.id, ogTitle: schema.captureSources.ogTitle, url: schema.captureSources.url })
      .from(schema.captureSources)
      .where(inArray(schema.captureSources.id, ids.bookmark));
    for (const r of rows)
      titleById.set(`bookmark:${r.id}`, { kind: "bookmark", id: r.id, title: r.ogTitle ?? r.url ?? "Untitled" });
  }
  if (ids.journal.length) {
    const rows = await db
      .select({ id: schema.journalEntries.id, entryDate: schema.journalEntries.entryDate })
      .from(schema.journalEntries)
      .where(inArray(schema.journalEntries.id, ids.journal));
    for (const r of rows)
      titleById.set(`journal:${r.id}`, { kind: "journal", id: r.id, title: `Journal ${r.entryDate}` });
  }

  // Preserve insertion order from project_items.
  return items
    .map((it) => titleById.get(`${it.itemKind}:${it.itemId}`))
    .filter((u): u is GroupedUnit => Boolean(u));
}

/** Build the context digest fed to a Plexo Work (living doc + grouped units). */
export function buildContextDigest(
  project: { id: string; name: string; livingDoc: string },
  groupedUnits: GroupedUnit[],
): ProjectContextDigest {
  const docDigest = project.livingDoc.replace(/<[^>]+>/g, " ").trim().slice(0, 2000);
  const unitList = groupedUnits.map((u) => `- (${u.kind}) ${u.title}`).join("\n");
  const summary = [
    `Project: ${project.name}`,
    docDigest ? `\nLiving document:\n${docDigest}` : "",
    groupedUnits.length ? `\nGrouped knowledge (${groupedUnits.length}):\n${unitList}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { projectId: project.id, name: project.name, summary, groupedUnits };
}
