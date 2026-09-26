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

  // Remove junction entries first
  await db
    .delete(schema.captureSourceTags)
    .where(eq(schema.captureSourceTags.tagId, id));

  // Delete tag
  await db
    .delete(schema.bookmarkTags)
    .where(
      and(
        eq(schema.bookmarkTags.id, id),
        eq(schema.bookmarkTags.workspaceId, workspace.id)
      )
    );

  return new Response(null, { status: 204 });
}
