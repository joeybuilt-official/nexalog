import { getAuthUser } from "@/lib/auth/server";
import { db, schema } from "@/lib/db";
import { getUserWorkspaces } from "@/lib/workspace";
import { eq, asc, count } from "drizzle-orm";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const workspaces = await getUserWorkspaces(user.id);
  if (!workspaces.length) return Response.json({ tags: [] });
  const workspace = workspaces[0];

  const tags = await db
    .select()
    .from(schema.bookmarkTags)
    .where(eq(schema.bookmarkTags.workspaceId, workspace.id))
    .orderBy(asc(schema.bookmarkTags.name));

  // Count bookmarks per tag
  const counts = await db
    .select({
      tagId: schema.captureSourceTags.tagId,
      count: count(),
    })
    .from(schema.captureSourceTags)
    .groupBy(schema.captureSourceTags.tagId);

  const countMap: Record<string, number> = {};
  for (const row of counts) {
    countMap[row.tagId] = Number(row.count);
  }

  const result = tags.map((t) => ({ ...t, bookmarkCount: countMap[t.id] ?? 0 }));

  return Response.json({ tags: result });
}

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const workspaces = await getUserWorkspaces(user.id);
  if (!workspaces.length) return Response.json({ error: "No workspace" }, { status: 404 });
  const workspace = workspaces[0];

  const body = await request.json() as { name: string; color?: string };

  if (!body.name?.trim()) {
    return Response.json({ error: "name is required" }, { status: 400 });
  }

  const [tag] = await db
    .insert(schema.bookmarkTags)
    .values({
      workspaceId: workspace.id,
      name: body.name.trim(),
      color: body.color ?? "#6366f1",
    })
    .returning();

  return Response.json(tag, { status: 201 });
}
