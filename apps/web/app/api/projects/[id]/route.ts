// SPDX-License-Identifier: MIT
/**
 * /api/projects/[id] — one project.
 *
 * `GET`    detail: identity, lifecycle, living doc, grouped units (each with the
 *          title its kind resolves to), sub-projects, parent.
 * `PATCH`  name / description / living doc / lifecycleState. Lifecycle goes
 *          through the domain's transition table, so an illegal move is a 409
 *          with the state it is actually in — never a silent write.
 * `DELETE` soft delete (see `softDeleteProject`: it detaches the parent edge,
 *          promotes sub-projects to roots, and touches NO member row).
 *
 * Every handler resolves the caller's workspaces first and scopes the query to
 * them; another workspace's project id is a 404, not a 403.
 */

import { getAuthUser } from "@/lib/auth/server";
import { surfaceUnavailableIfMissingRelation } from "@/lib/db/surface-unavailable";
import { getUserWorkspaces } from "@/lib/workspace";
import { getProject, softDeleteProject, updateProject } from "@/lib/projects/store";
import { isLifecycleState } from "@/lib/projects/domain";
import { z } from "zod";

export const dynamic = "force-dynamic";

const patchBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(4000).nullable().optional(),
    livingDoc: z.string().max(200_000).optional(),
    lifecycleState: z.string().optional(),
  })
  .strict();

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    if (!id) return Response.json({ error: "missing_id" }, { status: 400 });

    const workspaces = await getUserWorkspaces(user.id);
    const project = await getProject(
      workspaces.map((ws) => ws.id),
      id,
    );
    if (!project) return Response.json({ error: "not_found" }, { status: 404 });

    return Response.json({ project });
  } catch (err) {
    const unavailable = surfaceUnavailableIfMissingRelation(err, "GET /api/projects/[id]");
    if (unavailable) return unavailable;
    throw err;
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    if (!id) return Response.json({ error: "missing_id" }, { status: 400 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }

    const parsed = patchBody.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "invalid_body", details: parsed.error.issues.map((i) => i.path.join(".")) },
        { status: 400 },
      );
    }

    const { lifecycleState, ...rest } = parsed.data;
    if (lifecycleState !== undefined && !isLifecycleState(lifecycleState)) {
      return Response.json({ error: "invalid_lifecycle_state" }, { status: 400 });
    }

    const workspaces = await getUserWorkspaces(user.id);

    let updated;
    try {
      updated = await updateProject(
        workspaces.map((ws) => ws.id),
        id,
        {
          ...rest,
          ...(lifecycleState !== undefined ? { lifecycleState } : {}),
        },
      );
    } catch (e) {
      // The domain throws a stable message for an illegal move
      // ("Illegal lifecycle transition: archived -> draft"). Report 409 with the
      // text so the UI can say what happened; nothing was written.
      if (e instanceof Error && e.message.startsWith("Illegal lifecycle transition")) {
        return Response.json({ error: "invalid_transition", message: e.message }, { status: 409 });
      }
      throw e;
    }

    if (!updated) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ project: updated });
  } catch (err) {
    const unavailable = surfaceUnavailableIfMissingRelation(err, "PATCH /api/projects/[id]");
    if (unavailable) return unavailable;
    throw err;
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    if (!id) return Response.json({ error: "missing_id" }, { status: 400 });

    const workspaces = await getUserWorkspaces(user.id);
    const deleted = await softDeleteProject(
      workspaces.map((ws) => ws.id),
      id,
    );
    if (!deleted) return Response.json({ error: "not_found" }, { status: 404 });

    return Response.json({ ok: true, id, deleted: true });
  } catch (err) {
    const unavailable = surfaceUnavailableIfMissingRelation(err, "DELETE /api/projects/[id]");
    if (unavailable) return unavailable;
    throw err;
  }
}
