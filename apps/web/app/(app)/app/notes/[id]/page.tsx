import { getAuthUser } from "@/lib/auth/server";
import { redirect, notFound } from "next/navigation";
import { db, schema } from "@/lib/db";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { getUserWorkspaces } from "@/lib/workspace";
import { NoteEditor } from "./note-editor";

export default async function NotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const workspaces = await getUserWorkspaces(user.id);
  if (!workspaces.length) redirect("/app/dashboard");

  const workspaceIds = workspaces.map((ws) => ws.id);

  const [note] = await db
    .select()
    .from(schema.notes)
    .where(and(eq(schema.notes.id, id), inArray(schema.notes.workspaceId, workspaceIds), isNull(schema.notes.deletedAt)))
    .limit(1);

  if (!note) notFound();

  // Fetch backlinks: notes that link to this note via note_links
  const links = await db
    .select({ sourceNoteId: schema.noteLinks.sourceNoteId })
    .from(schema.noteLinks)
    .where(eq(schema.noteLinks.targetNoteId, id));

  const sourceIds = links.map((l) => l.sourceNoteId);

  const backlinks =
    sourceIds.length > 0
      ? await db
          .select({ id: schema.notes.id, title: schema.notes.title, updatedAt: schema.notes.updatedAt })
          .from(schema.notes)
          .where(and(inArray(schema.notes.id, sourceIds), inArray(schema.notes.workspaceId, workspaceIds), isNull(schema.notes.deletedAt)))
      : [];

  // Fetch voice capture for this note (if any)
  const [voiceCapture] = await db
    .select({ audioUrl: schema.captureSources.audioUrl })
    .from(schema.captureSources)
    .where(
      and(
        eq(schema.captureSources.noteId, id),
        eq(schema.captureSources.kind, "voice")
      )
    )
    .limit(1);

  // audio playback moved to repo attachments (Phase 3); R2 presign dropped
  const audioSrc: string | null = null;

  return (
    <NoteEditor
      note={note}
      backlinks={backlinks.map((b) => ({ ...b, updatedAt: b.updatedAt.toISOString() }))}
      audioSrc={audioSrc}
    />
  );
}
