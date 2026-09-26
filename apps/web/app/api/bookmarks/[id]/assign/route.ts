import { getAuthUser } from "@/lib/auth/server";
import { db, schema } from "@/lib/db";
import { getUserWorkspaces } from "@/lib/workspace";
import { eq, and } from "drizzle-orm";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const workspaces = await getUserWorkspaces(user.id);
  if (!workspaces.length) return Response.json({ error: "No workspace" }, { status: 404 });
  const workspace = workspaces[0];

  // Verify bookmark belongs to workspace
  const [bookmark] = await db
    .select({ id: schema.captureSources.id })
    .from(schema.captureSources)
    .where(
      and(
        eq(schema.captureSources.id, id),
        eq(schema.captureSources.workspaceId, workspace.id)
      )
    );
  if (!bookmark) return Response.json({ error: "Not found" }, { status: 404 });

  const body = await request.json() as { collectionId?: string; tagId?: string };

  if (body.collectionId) {
    await db
      .insert(schema.captureSourceCollections)
      .values({ captureSourceId: id, collectionId: body.collectionId })
      .onConflictDoNothing();
  }

  if (body.tagId) {
    await db
      .insert(schema.captureSourceTags)
      .values({ captureSourceId: id, tagId: body.tagId })
      .onConflictDoNothing();
  }

  return Response.json({ ok: true });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const workspaces = await getUserWorkspaces(user.id);
  if (!workspaces.length) return Response.json({ error: "No workspace" }, { status: 404 });
  const workspace = workspaces[0];

  const [bookmark] = await db
    .select({ id: schema.captureSources.id })
    .from(schema.captureSources)
    .where(
      and(
        eq(schema.captureSources.id, id),
        eq(schema.captureSources.workspaceId, workspace.id)
      )
    );
  if (!bookmark) return Response.json({ error: "Not found" }, { status: 404 });

  const body = await request.json() as { collectionId?: string; tagId?: string };

  if (body.collectionId) {
    await db
      .delete(schema.captureSourceCollections)
      .where(
        and(
          eq(schema.captureSourceCollections.captureSourceId, id),
          eq(schema.captureSourceCollections.collectionId, body.collectionId)
        )
      );
  }

  if (body.tagId) {
    await db
      .delete(schema.captureSourceTags)
      .where(
        and(
          eq(schema.captureSourceTags.captureSourceId, id),
          eq(schema.captureSourceTags.tagId, body.tagId)
        )
      );
  }

  return Response.json({ ok: true });
}
