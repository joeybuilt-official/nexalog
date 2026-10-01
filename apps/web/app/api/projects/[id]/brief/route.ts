// SPDX-License-Identifier: MIT
/**
 * /api/projects/[id]/brief — one project's synthesized brief, on demand.
 *
 * `GET`  read the brief: a short structured markdown summary synthesized from
 *        the project's linked notes, sub-projects and matched themes.
 * `POST` regenerate it. Nothing is persisted, so every response is synthesized
 *        on demand and the two verbs differ in INTENT, not in caching — POST is
 *        the explicit "Regenerate" verb the UI calls.
 *
 * Degradation is the point, not an edge case: with no model configured the
 * response is a `state: "fallback"` brief — a clearly-labelled mechanical digest
 * — never a 5xx. The route therefore returns 200 for both states and lets the
 * `state` field (and `reason`) tell the caller which one it got.
 *
 * Errors use the repo's typed shape and never carry internals: 400 for a
 * malformed id, 401 unauthenticated, 404 when the project is not the caller's,
 * 503 `surface_unavailable` when a table is missing on this deployment.
 */

import { z } from "zod";
import { getAuthUser } from "@/lib/auth/server";
import { surfaceUnavailableIfMissingRelation } from "@/lib/db/surface-unavailable";
import { getUserWorkspaces } from "@/lib/workspace";
import { logEvent } from "@/lib/logger";
import { resolveIntelligence } from "@/lib/intelligence/resolve";
import { assembleProjectBriefInput } from "@/lib/projects/brief";
import { synthesizeProjectBrief } from "@/lib/projects/brief-service";
import { getProjectBriefSource } from "@/lib/projects/store";

export const dynamic = "force-dynamic";

const projectId = z.string().uuid();

async function respond(
  method: "GET" | "POST",
  params: Promise<{ id: string }>,
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const surface = `${method} /api/projects/[id]/brief`;

  try {
    const { id } = await params;
    if (!id) return Response.json({ error: "missing_id" }, { status: 400 });
    if (!projectId.safeParse(id).success) {
      return Response.json({ error: "invalid_id" }, { status: 400 });
    }

    const workspaces = await getUserWorkspaces(user.id);
    const workspaceIds = workspaces.map((ws) => ws.id);

    const source = await getProjectBriefSource(workspaceIds, id);
    if (!source) return Response.json({ error: "not_found" }, { status: 404 });

    const now = new Date();
    const input = assembleProjectBriefInput(source, { now });
    if (!input) return Response.json({ error: "not_found" }, { status: 404 });

    const brief = await synthesizeProjectBrief(input, {
      intelligence: resolveIntelligence(),
      now,
      log: logEvent,
    });

    logEvent("brief.responded", {
      projectId: id,
      method,
      state: brief.state,
      reason: brief.reason,
      themes: brief.summary.themes.length,
    });

    return Response.json(
      { brief },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const unavailable = surfaceUnavailableIfMissingRelation(err, surface);
    if (unavailable) return unavailable;
    throw err;
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return respond("GET", params);
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return respond("POST", params);
}
