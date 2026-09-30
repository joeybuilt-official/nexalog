// SPDX-License-Identifier: MIT
/**
 * /api/projects/[id] — one project.
 *
 * `GET`    detail: identity, lifecycle, living doc, grouped units (each with the
 *          title its kind resolves to), sub-projects, parent.
 * `PATCH`  name / description / living doc / lifecycleState / parentId. Lifecycle
 *          goes through the domain's transition table, so an illegal move is a
 *          409 with the state it is actually in — never a silent write.
 *          `parentId` is the RE-PARENT verb: a uuid moves the project under that
 *          parent, `null` promotes it to a root, and an ABSENT key leaves the
 *          parent exactly as it is (the three are distinct on purpose — "move it
 *          to the top level" and "do not touch its parent" are different
 *          requests). A move that would create a cycle, or make the tree three
 *          levels deep, is a 400 `invalid_nesting` with a machine-readable
 *          `code` and nothing is written.
 * `DELETE` soft delete (see `softDeleteProject`: it detaches the parent edge,
 *          promotes sub-projects to roots, and touches NO member row).
 *
 * Every handler resolves the caller's workspaces first and scopes the query to
 * them; another workspace's project id is a 404, not a 403.
 */

import { getAuthUser } from "@/lib/auth/server";
import { surfaceUnavailableIfMissingRelation } from "@/lib/db/surface-unavailable";
import { getUserWorkspaces } from "@/lib/workspace";
import { getProject, reparentProject, softDeleteProject, updateProject } from "@/lib/projects/store";
import { isLifecycleState, ProjectNestingError } from "@/lib/projects/domain";
import { z } from "zod";

export const dynamic = "force-dynamic";

const patchBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(4000).nullable().optional(),
    livingDoc: z.string().max(200_000).optional(),
    lifecycleState: z.string().optional(),
    // `.optional()` WITHOUT `.nullable()` collapsing into a default: absent means
    // "leave the parent alone", `null` means "promote to a root" — see the
    // handler.
    parentId: z.string().uuid().nullable().optional(),
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

    const { lifecycleState, parentId, ...rest } = parsed.data;
    if (lifecycleState !== undefined && !isLifecycleState(lifecycleState)) {
      return Response.json({ error: "invalid_lifecycle_state" }, { status: 400 });
    }

    const workspaces = await getUserWorkspaces(user.id);
    const workspaceIds = workspaces.map((ws) => ws.id);

    // Re-parenting is a SEPARATE write from the metadata patch, and it runs
    // first: it is the one with a refusal path (the nesting guard), and a
    // refusal must leave the row exactly as it was — including its name and
    // description. The two are not one transaction because they are one request;
    // they are two independent facts and the metadata half has no failure mode
    // beyond "not found".
    if (parentId !== undefined) {
      let outcome;
      try {
        outcome = await reparentProject(workspaceIds, id, parentId);
      } catch (e) {
        if (e instanceof ProjectNestingError) {
          return Response.json(
            { error: "invalid_nesting", code: e.code, message: e.message },
            { status: 400 },
          );
        }
        throw e;
      }

      // An explicit `parentId: null` on a root is a no-op the store reports as
      // success, so only its negative arms become statuses here.
      if (!outcome.ok) {
        const status = outcome.reason === "project_not_found" ? 404 : 404;
        return Response.json({ error: outcome.reason }, { status });
      }
    }

    // Metadata is untouched when the request carried none — sending a bare
    // `{parentId}` must not blank the name, which `updateProject`'s
    // absent-means-leave-it contract gives us for free.
    const hasMetadataPatch =
      rest.name !== undefined || rest.description !== undefined || rest.livingDoc !== undefined;

    if (hasMetadataPatch || lifecycleState !== undefined) {
      try {
        const updated = await updateProject(workspaceIds, id, {
          ...rest,
          ...(lifecycleState !== undefined ? { lifecycleState } : {}),
        });
        if (!updated) return Response.json({ error: "not_found" }, { status: 404 });
      } catch (e) {
        // The domain throws a stable message for an illegal move
        // ("Illegal lifecycle transition: archived -> draft"). Report 409 with
        // the text so the UI can say what happened; nothing was written.
        if (e instanceof Error && e.message.startsWith("Illegal lifecycle transition")) {
          return Response.json({ error: "invalid_transition", message: e.message }, { status: 409 });
        }
        throw e;
      }
    }

    // ONE response shape for every PATCH, and the same shape `GET` returns.
    // Reading it back rather than echoing the write is what keeps that true: a
    // re-parent changes no column on `projects`, so a response built from the
    // update's own RETURNING row could not show the project's new parent.
    const project = await getProject(workspaceIds, id);
    if (!project) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ project });
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
