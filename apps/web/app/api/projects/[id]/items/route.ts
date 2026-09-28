// SPDX-License-Identifier: MIT
/**
 * /api/projects/[id]/items — the reference edges of one project.
 *
 * `POST`   add a reference. `{ kind, id }` where kind is note | bookmark |
 *          journal | project. `kind: "project"` makes the target a SUB-PROJECT:
 *          the two nesting rules (one parent per project, at most two levels)
 *          are enforced here by the domain guard and answer 400 with a
 *          machine-readable `code` — clients branch on the code, never on the
 *          message text.
 * `DELETE` remove a reference. This detaches; it never deletes the target.
 *
 * The target must belong to one of the caller's workspaces. A reference that
 * fails that check answers 404 `item_not_found`, not 403: a 403 would confirm
 * the id exists somewhere the caller cannot see.
 */

import { getAuthUser } from "@/lib/auth/server";
import { surfaceUnavailableIfMissingRelation } from "@/lib/db/surface-unavailable";
import { getUserWorkspaces } from "@/lib/workspace";
import { addItemToProject, removeItemFromProject } from "@/lib/projects/store";
import { isItemKind, ProjectNestingError } from "@/lib/projects/domain";
import { z } from "zod";

export const dynamic = "force-dynamic";

const itemBody = z
  .object({
    kind: z.string(),
    id: z.string().uuid(),
  })
  .strict();

export async function POST(
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

    const parsed = itemBody.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "invalid_body", details: parsed.error.issues.map((i) => i.path.join(".")) },
        { status: 400 },
      );
    }
    if (!isItemKind(parsed.data.kind)) {
      return Response.json({ error: "invalid_item_kind" }, { status: 400 });
    }

    const workspaces = await getUserWorkspaces(user.id);
    const workspaceIds = workspaces.map((ws) => ws.id);

    let outcome;
    try {
      outcome = await addItemToProject({
        workspaceIds,
        projectId: id,
        kind: parsed.data.kind,
        itemId: parsed.data.id,
      });
    } catch (e) {
      if (e instanceof ProjectNestingError) {
        return Response.json({ error: "invalid_nesting", code: e.code, message: e.message }, { status: 400 });
      }
      throw e;
    }

    if (!outcome.ok) {
      const status = outcome.reason === "project_not_found" ? 404 : 404;
      return Response.json({ error: outcome.reason }, { status });
    }

    return Response.json(
      { ok: true, kind: parsed.data.kind, id: parsed.data.id, alreadyPresent: outcome.alreadyPresent },
      { status: outcome.alreadyPresent ? 200 : 201 },
    );
  } catch (err) {
    const unavailable = surfaceUnavailableIfMissingRelation(err, "POST /api/projects/[id]/items");
    if (unavailable) return unavailable;
    throw err;
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    if (!id) return Response.json({ error: "missing_id" }, { status: 400 });

    // A DELETE with a body is unusual but unambiguous here: the resource being
    // removed is the (project, kind, item) edge, so the target must be named.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }

    const parsed = itemBody.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "invalid_body", details: parsed.error.issues.map((i) => i.path.join(".")) },
        { status: 400 },
      );
    }
    if (!isItemKind(parsed.data.kind)) {
      return Response.json({ error: "invalid_item_kind" }, { status: 400 });
    }

    const workspaces = await getUserWorkspaces(user.id);
    const result = await removeItemFromProject({
      workspaceIds: workspaces.map((ws) => ws.id),
      projectId: id,
      kind: parsed.data.kind,
      itemId: parsed.data.id,
    });
    if (!result.ok) return Response.json({ error: "not_found" }, { status: 404 });

    return Response.json({ ok: true, kind: parsed.data.kind, id: parsed.data.id });
  } catch (err) {
    const unavailable = surfaceUnavailableIfMissingRelation(err, "DELETE /api/projects/[id]/items");
    if (unavailable) return unavailable;
    throw err;
  }
}
