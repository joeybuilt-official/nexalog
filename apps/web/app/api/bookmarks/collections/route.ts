import { getAuthUser } from "@/lib/auth/server";
import { db, schema } from "@/lib/db";
import { getUserWorkspaces } from "@/lib/workspace";
import { eq, and, count, asc } from "drizzle-orm";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const workspaces = await getUserWorkspaces(user.id);
  if (!workspaces.length) return Response.json({ collections: [] });
  const workspace = workspaces[0];

  const collections = await db
    .select()
    .from(schema.bookmarkCollections)
    .where(eq(schema.bookmarkCollections.workspaceId, workspace.id))
    .orderBy(asc(schema.bookmarkCollections.sortOrder), asc(schema.bookmarkCollections.name));

  // Count bookmarks per collection
  const counts = await db
    .select({
      collectionId: schema.captureSourceCollections.collectionId,
      count: count(),
    })
    .from(schema.captureSourceCollections)
    .groupBy(schema.captureSourceCollections.collectionId);

  const countMap: Record<string, number> = {};
  for (const row of counts) {
    countMap[row.collectionId] = Number(row.count);
  }

  const result = collections.map((c) => ({ ...c, bookmarkCount: countMap[c.id] ?? 0 }));

  return Response.json({ collections: result });
}

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const workspaces = await getUserWorkspaces(user.id);
  if (!workspaces.length) return Response.json({ error: "No workspace" }, { status: 404 });
  const workspace = workspaces[0];

  const body = await request.json() as {
    name: string;
    description?: string;
    color?: string;
    icon?: string;
  };

  if (!body.name?.trim()) {
    return Response.json({ error: "name is required" }, { status: 400 });
  }

  const [collection] = await db
    .insert(schema.bookmarkCollections)
    .values({
      workspaceId: workspace.id,
      userId: user.id,
      name: body.name.trim(),
      description: body.description ?? "",
      color: body.color ?? "#C07040",
      icon: body.icon ?? "folder",
    })
    .returning();

  return Response.json(collection, { status: 201 });
}
