import { getAuthUser } from "@/lib/auth/server";
import { db, schema } from "@/lib/db";
import { surfaceUnavailableIfMissingRelation } from "@/lib/db/surface-unavailable";
import { getUserWorkspaces } from "@/lib/workspace";
import { persistWikilinks } from "@/lib/notes/wikilinks";

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    return await createNote(request, user.id);
  } catch (err) {
    const unavailable = surfaceUnavailableIfMissingRelation(err, "POST /api/notes");
    if (unavailable) return unavailable;
    throw err;
  }
}

async function createNote(request: Request, userId: string) {
  const body = await request.json();
  const { workspaceId, title = "", content = "", kind = "note", lifecycleState = "active" } = body as {
    workspaceId?: string;
    title?: string;
    content?: string;
    kind?: string;
    lifecycleState?: string;
  };

  const workspaces = await getUserWorkspaces(userId);
  if (!workspaces.length) {
    return Response.json({ error: "No workspace found" }, { status: 404 });
  }
  const workspaceIds = workspaces.map((ws) => ws.id);

  let targetWorkspaceId = workspaceId;
  if (!targetWorkspaceId) {
    targetWorkspaceId = workspaces[0].id;
  } else if (!workspaceIds.includes(targetWorkspaceId)) {
    return Response.json({ error: "Workspace not found" }, { status: 404 });
  }

  const [note] = await db
    .insert(schema.notes)
    .values({
      workspaceId: targetWorkspaceId,
      userId,
      title,
      content,
      kind,
      lifecycleState,
    })
    .returning();

  // scl-mutate removed with Plexo (v2)


  // Persist any `[[wikilinks]]` referenced in the freshly-saved content.
  // Idempotent + best-effort: a DB hiccup on link upsert must not poison the
  // note-create response.
  persistWikilinks({
    sourceNoteId: note.id,
    workspaceIds,
    content,
  }).catch(() => null);

  return Response.json(note, { status: 201 });
}
