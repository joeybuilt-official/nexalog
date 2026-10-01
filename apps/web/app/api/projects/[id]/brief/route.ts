// SPDX-License-Identifier: MIT
/**
 * /api/projects/[id]/brief — one project's synthesized brief, on demand, and the
 * EXPLICIT publish of that brief into gbrain's proposal queue.
 *
 * `GET`  read the brief: a short structured markdown summary synthesized from
 *        the project's linked notes, sub-projects and matched themes.
 * `POST` with no body, or `{ "intent": "regenerate" }`: regenerate it. Nothing is
 *        persisted, so every response is synthesized on demand and the verbs
 *        differ in INTENT, not in caching.
 * `POST` with `{ "intent": "publish" }`: publish THIS brief. The route
 *        re-synthesizes (that is the brief being published) and then proposes it
 *        into the SAME queue every other proposal rides, as a `kind = "brief"`
 *        row the operator reviews at `/app/proposals`.
 *
 * PUBLISHING IS NEVER A SIDE EFFECT. A reader viewing a brief, or regenerating
 * one, writes nothing anywhere — the only path that emits a proposal is a request
 * that names the intent. That is deliberate: `GET` is called by the page render.
 *
 * WHY A FALLBACK IS A 409 AND NOT A NO-OP
 * ---------------------------------------
 * A `state: "fallback"` brief is a mechanical digest of the project's own data,
 * not a claim about it. Publishing one would put un-synthesized text into the
 * brain as if a model had said it. The refusal is TYPED (`brief_not_synthesized`,
 * with the brief's own reason code alongside) because silently doing nothing
 * would tell the operator their click worked.
 *
 * Errors use the repo's typed shape and never carry internals: 400 for a
 * malformed id or body, 401 unauthenticated, 404 when the project is not the
 * caller's, 409 for a fallback, 503 `gbrain_unavailable` when this deployment has
 * no queue, 503 `surface_unavailable` when a table is missing.
 */

import { z } from "zod";
import { BriefPublishError } from "@nexalog/core";
import { getAuthUser } from "@/lib/auth/server";
import { surfaceUnavailableIfMissingRelation } from "@/lib/db/surface-unavailable";
import { getUserWorkspaces } from "@/lib/workspace";
import { logEvent } from "@/lib/logger";
import { resolveIntelligence } from "@/lib/intelligence/resolve";
import { assembleProjectBriefInput, type ProjectBrief } from "@/lib/projects/brief";
import { synthesizeProjectBrief } from "@/lib/projects/brief-service";
import { getProjectBriefSource } from "@/lib/projects/store";
import {
  briefPostBody,
  projectPageHref,
  type PublishedProvenance,
} from "@/lib/projects/publish";
import {
  BriefQueueUnavailable,
  publishProjectBriefPass,
} from "@/app/api/plan-impact/reconcile/pass";

export const dynamic = "force-dynamic";

const projectId = z.string().uuid();

/** The `kind` a published brief carries, echoed so a client can assert it. */
const BRIEF_KIND = "brief";

/**
 * Read or regenerate the brief. Nothing is written; this is the function the
 * page render and the Regenerate button both call.
 */
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
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!id) return Response.json({ error: "missing_id" }, { status: 400 });
  if (!projectId.safeParse(id).success) {
    return Response.json({ error: "invalid_id" }, { status: 400 });
  }

  // An ABSENT body is the regenerate intent (the pre-existing contract). A body
  // that is present must name an intent this route implements — a misspelled one
  // is a 400, never a silent synthesis the caller did not ask for.
  let body: z.infer<typeof briefPostBody> = {};
  const raw = await request.text();
  if (raw.trim() !== "") {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }
    const parsed = briefPostBody.safeParse(parsedJson);
    if (!parsed.success) {
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }
    body = parsed.data;
    if (body.intent === undefined) {
      return Response.json({ error: "invalid_body", code: "intent_required" }, { status: 400 });
    }
  }

  if (body.intent !== "publish") return respond("POST", Promise.resolve({ id }));

  return publish(user.id, id, body.sourceId);
}

/** The publish intent: synthesize the brief, then propose it. */
async function publish(userId: string, id: string, sourceId?: string): Promise<Response> {
  const surface = "POST /api/projects/[id]/brief (publish)";

  logEvent("route.start", { route: "/api/projects/[id]/brief", method: "POST", intent: "publish" });

  try {
    const workspaces = await getUserWorkspaces(userId);
    const workspaceIds = workspaces.map((ws) => ws.id);

    const source = await getProjectBriefSource(workspaceIds, id);
    if (!source) return Response.json({ error: "not_found" }, { status: 404 });

    const now = new Date();
    const input = assembleProjectBriefInput(source, { now });
    if (!input) return Response.json({ error: "not_found" }, { status: 404 });

    const brief: ProjectBrief = await synthesizeProjectBrief(input, {
      intelligence: resolveIntelligence(),
      now,
      log: logEvent,
    });

    // The ONE rule this feature turns on, enforced before any queue work: a
    // mechanical digest is not a claim and never reaches the brain.
    if (brief.state !== "synthesized") {
      logEvent("brief.publish_refused", {
        projectId: id,
        state: brief.state,
        reason: brief.reason,
      });
      return Response.json(
        {
          error: "brief_not_synthesized",
          code: brief.reason ?? "not_synthesized",
          message:
            "This brief is a mechanical digest of the project's own data rather than a " +
            "synthesis, so it was not published to the brain.",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    const result = await publishProjectBriefPass({
      workspaceIds,
      projectId: id,
      brief,
      ...(sourceId ? { sourceId } : {}),
    });

    const provenance: PublishedProvenance = {
      projectId: id,
      projectName: source.project.name,
      projectHref: projectPageHref(result.pageSlug),
      pageSlug: result.pageSlug,
      modelId: result.modelId,
      generatedAt: result.generatedAt,
      promptVersion: brief.promptVersion,
    };

    logEvent("brief.published", {
      projectId: id,
      pageSlug: result.pageSlug,
      proposalId: result.proposalId,
      created: !result.duplicate,
      modelId: result.modelId,
      contentHash: result.contentHash,
    });

    return Response.json(
      {
        ok: true,
        // `duplicate` is SUCCESS — the queue already held this exact brief.
        created: !result.duplicate,
        duplicate: result.duplicate,
        kind: BRIEF_KIND,
        proposalId: result.proposalId,
        pageSlug: result.pageSlug,
        pageHref: provenance.projectHref,
        provenance,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof BriefQueueUnavailable) {
      return Response.json(
        {
          error: "gbrain_unavailable",
          code: err.code,
          message: err.message,
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (err instanceof BriefPublishError) {
      // A refusal is a CONFLICT for the one case that can be retried after a
      // re-synthesis, and a 404 when the project itself did not resolve.
      const status = err.code === "missing_project" ? 404 : 409;
      return Response.json(
        { error: err.code, message: err.message },
        { status, headers: { "Cache-Control": "no-store" } },
      );
    }

    const unavailable = surfaceUnavailableIfMissingRelation(err, surface);
    if (unavailable) return unavailable;

    const message = err instanceof Error ? err.message : "brief publish failed";
    logEvent("brief.publish_failed", { projectId: id, error: message });
    // The queue's own transport failure is the same honest answer the proposals
    // surface gives: this deployment cannot reach gbrain right now.
    return Response.json(
      { error: "gbrain_unavailable", code: "write_failed", message: "The brief could not be published." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
