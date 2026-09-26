import { getAuthUser } from "@/lib/auth/server";
import { db, schema } from "@/lib/db";
import { getUserWorkspaces } from "@/lib/workspace";
import { ilike, and, inArray, or, isNull, sql } from "drizzle-orm";

export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "8", 10), 20);

  const workspaces = await getUserWorkspaces(user.id);
  if (!workspaces.length) return Response.json({ notes: [] });
  const workspaceIds = workspaces.map((ws) => ws.id);

  // Exclude bookmark-twin notes (every saved URL mints a notes row) so the
  // @-mention picker + note search only surface real authored notes. (RC1/P6a.)
  const excludeBookmarkTwins = sql`NOT EXISTS (SELECT 1 FROM ${schema.captureSources} cs WHERE cs.note_id = ${schema.notes.id} AND cs.kind = 'url')`;

  const where = q
    ? and(
        inArray(schema.notes.workspaceId, workspaceIds),
        isNull(schema.notes.deletedAt),
        excludeBookmarkTwins,
        or(
          ilike(schema.notes.title, `%${q}%`),
          ilike(schema.notes.content, `%${q}%`)
        )
      )
    : and(
        inArray(schema.notes.workspaceId, workspaceIds),
        isNull(schema.notes.deletedAt),
        excludeBookmarkTwins
      );

  const notes = await db
    .select({
      id: schema.notes.id,
      title: schema.notes.title,
      updatedAt: schema.notes.updatedAt,
    })
    .from(schema.notes)
    .where(where)
    .limit(limit);

  return Response.json({
    notes: notes.map((n) => ({ ...n, updatedAt: n.updatedAt.toISOString() })),
  });
}
