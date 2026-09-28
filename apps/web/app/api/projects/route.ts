// SPDX-License-Identifier: MIT
/**
 * /api/projects — the Projects collection.
 *
 * `GET`  list the caller's projects (workspace-scoped), each with the member and
 *        sub-project counts the list view renders.
 * `POST` create a project.
 *
 * Workspace scoping is the whole authorization model here: every read and write
 * goes through a `workspaceIds` list resolved from the session, so a project id
 * belonging to another workspace answers 404 and never leaks its existence.
 * (`.claude/rules/api-design.md` → "enforce it per record, not just per route".)
 */

import { getAuthUser } from "@/lib/auth/server";
import { surfaceUnavailableIfMissingRelation } from "@/lib/db/surface-unavailable";
import { getUserWorkspaces } from "@/lib/workspace";
import { createProject, listProjects } from "@/lib/projects/store";
import { z } from "zod";

/** `strict()` so a misspelled field is a 400, not a silently ignored intent. */
const createBody = z
  .object({
    name: z.string().trim().min(1, "name is required").max(200),
    description: z.string().max(4000).nullish(),
    workspaceId: z.string().uuid().optional(),
  })
  .strict();

export async function GET() {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const workspaces = await getUserWorkspaces(user.id);
    if (!workspaces.length) return Response.json({ projects: [] });

    const projects = await listProjects(workspaces.map((ws) => ws.id));
    return Response.json({ projects });
  } catch (err) {
    const unavailable = surfaceUnavailableIfMissingRelation(err, "GET /api/projects");
    if (unavailable) return unavailable;
    throw err;
  }
}

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }

    const parsed = createBody.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "invalid_body", details: parsed.error.issues.map((i) => i.path.join(".")) },
        { status: 400 },
      );
    }

    const workspaces = await getUserWorkspaces(user.id);
    if (!workspaces.length) {
      return Response.json({ error: "No workspace found" }, { status: 404 });
    }

    // An explicit workspaceId must be one the caller actually owns — otherwise
    // it is not "not found", it is someone else's workspace.
    const target = parsed.data.workspaceId;
    if (target && !workspaces.some((ws) => ws.id === target)) {
      return Response.json({ error: "Workspace not found" }, { status: 404 });
    }

    const project = await createProject({
      workspaceId: target ?? workspaces[0].id,
      userId: user.id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
    });

    return Response.json({ project }, { status: 201 });
  } catch (err) {
    const unavailable = surfaceUnavailableIfMissingRelation(err, "POST /api/projects");
    if (unavailable) return unavailable;
    throw err;
  }
}
