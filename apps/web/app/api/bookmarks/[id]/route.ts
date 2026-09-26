import { getAuthUser } from "@/lib/auth/server";
import { db, schema } from "@/lib/db";
import { getUserWorkspaces } from "@/lib/workspace";
import { eq, and } from "drizzle-orm";

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

  // Remove junction entries
  await db
    .delete(schema.captureSourceCollections)
    .where(eq(schema.captureSourceCollections.captureSourceId, id));

  await db
    .delete(schema.captureSourceTags)
    .where(eq(schema.captureSourceTags.captureSourceId, id));

  // Delete capture source
  await db
    .delete(schema.captureSources)
    .where(
      and(
        eq(schema.captureSources.id, id),
        eq(schema.captureSources.workspaceId, workspace.id)
      )
    );

  return new Response(null, { status: 204 });
}
