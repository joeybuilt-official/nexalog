import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { slugify } from "./slug";
import type {
  ExportBundle,
  ExportCapture,
  ExportJournalEntry,
  ExportNote,
  ExportNoteLink,
  ExportWorkspace,
} from "./types";
import { CAPTURE_EXPORT_COLUMNS } from "./captures-csv";

export async function loadExportBundle(userId: string): Promise<ExportBundle> {
  const wsRows = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.userId, userId));

  const workspaces: ExportWorkspace[] = wsRows.map((w) => ({
    id: w.id,
    slug: w.slug || slugify(w.name),
    name: w.name,
  }));

  const noteRows = await db
    .select()
    .from(schema.notes)
    .where(eq(schema.notes.userId, userId));

  const noteIds = noteRows.map((n) => n.id);

  const tagJoinRows = noteIds.length
    ? await db
        .select({ noteId: schema.noteTags.noteId, name: schema.bookmarkTags.name })
        .from(schema.noteTags)
        .innerJoin(schema.bookmarkTags, eq(schema.noteTags.tagId, schema.bookmarkTags.id))
        .where(inArray(schema.noteTags.noteId, noteIds))
    : [];

  const tagsByNote = new Map<string, string[]>();
  for (const row of tagJoinRows) {
    const list = tagsByNote.get(row.noteId) ?? [];
    list.push(row.name);
    tagsByNote.set(row.noteId, list);
  }

  const notes: ExportNote[] = noteRows.map((n) => ({
    id: n.id,
    workspaceId: n.workspaceId,
    title: n.title,
    content: n.content,
    kind: n.kind,
    lifecycleState: n.lifecycleState,
    tags: tagsByNote.get(n.id) ?? [],
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  }));

  const captureRows = await db
    .select()
    .from(schema.captureSources)
    .where(eq(schema.captureSources.userId, userId));

  const captures: ExportCapture[] = captureRows.map((row) => {
    const out: ExportCapture = {};
    for (const col of CAPTURE_EXPORT_COLUMNS) {
      out[col] = (row as unknown as Record<string, unknown>)[col];
    }
    return out;
  });

  const noteLinks: ExportNoteLink[] = noteIds.length
    ? (
        await db
          .select()
          .from(schema.noteLinks)
          .where(inArray(schema.noteLinks.sourceNoteId, noteIds))
      ).map((l) => ({
        sourceNoteId: l.sourceNoteId,
        targetNoteId: l.targetNoteId,
        kind: l.kind,
        strength: l.strength,
        createdAt: l.createdAt,
      }))
    : [];

  const journalRows = await db
    .select()
    .from(schema.journalEntries)
    .where(eq(schema.journalEntries.userId, userId));

  const journal: ExportJournalEntry[] = journalRows.map((j) => ({
    id: j.id,
    workspaceId: j.workspaceId,
    entryDate: typeof j.entryDate === "string" ? j.entryDate : String(j.entryDate),
    body: j.body,
    mood: j.mood,
    energy: j.energy,
    weather: (j.weatherJson as Record<string, unknown> | null) ?? null,
    voiceSourceId: j.voiceSourceId,
  }));

  return {
    userId,
    exportedAt: new Date(),
    workspaces,
    notes,
    captures,
    noteLinks,
    journal,
  };
}
