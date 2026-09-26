import { getAuthUser } from "@/lib/auth/server";
import { logEvent } from "@/lib/logger";
import { db, schema } from "@/lib/db";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { getUserWorkspaces } from "@/lib/workspace";
import { persistWikilinks } from "@/lib/notes/wikilinks";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  logEvent("route.start", { route: "/api/notes/[id]", method: "PATCH" });

  const workspaces = await getUserWorkspaces(user.id);
  if (!workspaces.length) {
    return Response.json({ error: "No workspace found" }, { status: 404 });
  }
  const workspaceIds = workspaces.map((ws) => ws.id);

  const body = await request.json();
  const { title, content, trash, restore } = body as {
    title?: string;
    content?: string;
    trash?: boolean;
    restore?: boolean;
  };

  const setFields: Record<string, unknown> = { updatedAt: new Date() };
  if (title !== undefined) setFields.title = title;
  if (content !== undefined) setFields.content = content;
  if (trash) setFields.deletedAt = new Date();
  if (restore) setFields.deletedAt = null;

  const [updated] = await db
    .update(schema.notes)
    .set(setFields)
    .where(
      and(
        eq(schema.notes.id, id),
        inArray(schema.notes.workspaceId, workspaceIds)
      )
    )
    .returning();

  if (!updated) return Response.json({ error: "Not found" }, { status: 404 });

  const sclLabel = updated.title || title;
  // scl-mutate removed with Plexo (v2)


  // Re-derive wikilinks from the latest content. Best-effort; failures must
  // not poison the save response. The unique index on (source,target) absorbs
  // repeats so this stays idempotent across autosaves.
  if (content !== undefined) {
    persistWikilinks({
      sourceNoteId: updated.id,
      workspaceIds,
      content,
    }).catch(() => null);
  }

  return Response.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  logEvent("route.start", { route: "/api/notes/[id]", method: "DELETE" });

  const workspaces = await getUserWorkspaces(user.id);
  if (!workspaces.length) return Response.json({ error: "No workspace" }, { status: 404 });
  const workspaceIds = workspaces.map((ws) => ws.id);

  // Soft-delete: set deletedAt timestamp (hard purge runs via cron after 30 days)
  const [softDeleted] = await db
    .update(schema.notes)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.notes.id, id),
        inArray(schema.notes.workspaceId, workspaceIds),
        isNull(schema.notes.deletedAt)
      )
    )
    .returning({ id: schema.notes.id });

  if (!softDeleted) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json({ ok: true, id: softDeleted.id });
}
