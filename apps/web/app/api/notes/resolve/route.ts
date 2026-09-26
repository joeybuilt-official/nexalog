import { getAuthUser } from "@/lib/auth/server";
import { db, schema } from "@/lib/db";
import { getUserWorkspaces } from "@/lib/workspace";
import { eq, and, inArray, or, isNull } from "drizzle-orm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/notes/resolve?ref=<uuid-or-title>
// Returns { id, title, content } for the first matching note in the user's workspaces.
// Used by the Tiptap TransclusionExtension to embed note content inline.
export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const ref = searchParams.get("ref")?.trim() ?? "";
  if (!ref) return Response.json({ error: "ref required" }, { status: 400 });

  const workspaces = await getUserWorkspaces(user.id);
  if (!workspaces.length) return Response.json({ error: "Not found" }, { status: 404 });
  const workspaceIds = workspaces.map((ws) => ws.id);

  const baseWhere = and(
    inArray(schema.notes.workspaceId, workspaceIds),
    isNull(schema.notes.deletedAt)
  );

  const where = UUID_RE.test(ref)
    ? and(baseWhere, eq(schema.notes.id, ref))
    : and(
        baseWhere,
        or(
          eq(schema.notes.title, ref),
          // case-insensitive title fallback via ilike exact
          eq(schema.notes.title, ref)
        )
      );

  const [note] = await db
    .select({
      id: schema.notes.id,
      title: schema.notes.title,
      content: schema.notes.content,
    })
    .from(schema.notes)
    .where(where)
    .limit(1);

  if (!note) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ id: note.id, title: note.title, content: note.content });
}
