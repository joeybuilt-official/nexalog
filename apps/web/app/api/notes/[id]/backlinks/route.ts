import { getAuthUser } from "@/lib/auth/server";
import { db, schema } from "@/lib/db";
import { getUserWorkspaces } from "@/lib/workspace";
import { eq, and, inArray, isNull } from "drizzle-orm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const workspaces = await getUserWorkspaces(user.id);
  if (!workspaces.length) return Response.json({ backlinks: [] });
  const workspaceIds = workspaces.map((ws) => ws.id);

  // Notes that explicitly link to this note via note_links
  const links = await db
    .select({ sourceNoteId: schema.noteLinks.sourceNoteId, kind: schema.noteLinks.kind })
    .from(schema.noteLinks)
    .where(eq(schema.noteLinks.targetNoteId, id));

  const sourceIds = links.map((l) => l.sourceNoteId);
  if (!sourceIds.length) return Response.json({ backlinks: [] });

  const sourceNotes = await db
    .select({ id: schema.notes.id, title: schema.notes.title, updatedAt: schema.notes.updatedAt })
    .from(schema.notes)
    .where(and(
      inArray(schema.notes.id, sourceIds),
      inArray(schema.notes.workspaceId, workspaceIds),
      isNull(schema.notes.deletedAt)
    ));

  return Response.json({
    backlinks: sourceNotes.map((n) => ({ ...n, updatedAt: n.updatedAt.toISOString() })),
  });
}
