// SPDX-License-Identifier: MIT
/**
 * POST /api/captures/[id]/archive  → soft-archive (sets smart_archived_at)
 * DELETE /api/captures/[id]/archive → undo soft-archive (clears smart_archived_at)
 *
 * Soft-archive is the user's "I'm done with this" signal AND the
 * accept-handler for `bookmark.stale_batch` Inbox cards. Per VISION
 * scenario C the action is reversible — never delete the row.
 */
export const dynamic = "force-dynamic";

import { getAuthUser } from "@/lib/auth/server";
import { db, schema } from "@/lib/db";
import { getUserWorkspaces } from "@/lib/workspace";
import { and, eq, inArray } from "drizzle-orm";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!id) return Response.json({ error: "missing_id" }, { status: 400 });

  const workspaces = await getUserWorkspaces(user.id);
  if (!workspaces.length) return Response.json({ error: "no_workspace" }, { status: 404 });
  const workspaceIds = workspaces.map((w) => w.id);

  const updated = await db
    .update(schema.captureSources)
    .set({ smartArchivedAt: new Date() })
    .where(
      and(
        eq(schema.captureSources.id, id),
        inArray(schema.captureSources.workspaceId, workspaceIds)
      )
    )
    .returning({ id: schema.captureSources.id });

  if (!updated.length) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!id) return Response.json({ error: "missing_id" }, { status: 400 });

  const workspaces = await getUserWorkspaces(user.id);
  if (!workspaces.length) return Response.json({ error: "no_workspace" }, { status: 404 });
  const workspaceIds = workspaces.map((w) => w.id);

  const updated = await db
    .update(schema.captureSources)
    .set({ smartArchivedAt: null })
    .where(
      and(
        eq(schema.captureSources.id, id),
        inArray(schema.captureSources.workspaceId, workspaceIds)
      )
    )
    .returning({ id: schema.captureSources.id });

  if (!updated.length) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ ok: true });
}
