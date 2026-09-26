import { getAuthUser } from "@/lib/auth/server";
import { db, schema } from "@/lib/db";
import { getUserWorkspaces } from "@/lib/workspace";
import { eq, and } from "drizzle-orm";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const workspaces = await getUserWorkspaces(user.id);
  if (!workspaces.length) return Response.json({ error: "No workspace" }, { status: 404 });
  const workspace = workspaces[0];

  const body = await request.json() as {
    name?: string;
    description?: string;
    color?: string;
  };

  const [updated] = await db
    .update(schema.bookmarkCollections)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.color !== undefined && { color: body.color }),
    })
    .where(
      and(
        eq(schema.bookmarkCollections.id, id),
        eq(schema.bookmarkCollections.workspaceId, workspace.id)
      )
    )
    .returning();

  if (!updated) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const workspaces = await getUserWorkspaces(user.id);
  if (!workspaces.length) return Response.json({ error: "No workspace" }, { status: 404 });
  const workspace = workspaces[0];

  // Remove junction entries first
  await db
    .delete(schema.captureSourceCollections)
    .where(eq(schema.captureSourceCollections.collectionId, id));

  // Delete collection
  await db
    .delete(schema.bookmarkCollections)
    .where(
      and(
        eq(schema.bookmarkCollections.id, id),
        eq(schema.bookmarkCollections.workspaceId, workspace.id)
      )
    );

  return new Response(null, { status: 204 });
}
