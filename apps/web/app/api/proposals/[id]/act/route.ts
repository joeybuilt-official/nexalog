// SPDX-License-Identifier: MIT
/**
 * POST /api/proposals/[id]/act — the operator's decision on one take proposal.
 *
 * `{ accept: boolean }` — one route, not two, because accept and reject are the
 * same decision on the same resource with one boolean of difference. (Same
 * reasoning as `POST /api/captures/[id]/review`, which this route's shape
 * mirrors deliberately: a client that can drive one of them can drive both.)
 *
 * WHAT AN ACCEPT DOES
 * -------------------
 * Claims the row (`pending → accepted`, rowcount checked, so exactly one caller
 * can win it), appends the take to the page at (max row on that page) + 1, and
 * stamps `promoted_row_num` + `acted_at` + `acted_by` — all in one transaction, so
 * an accept cannot leave a row marked accepted with nothing behind it. A reject
 * stamps `rejected` + `acted_at` + `acted_by` and writes nothing to the page.
 *
 * `acted_by` is the AUTHENTICATED USER's id, recorded server-side. It is never
 * taken from the request body: an audit column a caller can set is not an audit
 * column.
 *
 * ERROR MAPPING — the client branches on `code`, never on `message`:
 *   401  unauthorized              no valid session
 *   400  invalid_id                the path segment is not a positive integer
 *   400  invalid_body              body is not JSON, or not `{accept: boolean}`
 *   404  not_found                 no proposal with that id
 *   409  not_pending               it was already accepted/rejected/superseded
 *                                  (the row moved under this operator), or the
 *                                  claim is not promotable
 *   503  gbrain_unavailable        this deployment cannot reach the queue
 *   500  promote_failed            unexpected server fault
 *
 * A 409 is the interesting one: it is what two operators racing the same row
 * produces, and what a retry against an already-accepted row produces. Reporting
 * it as a conflict is the honest answer — the alternative was the silent success
 * a no-op UPDATE would have given.
 */

export const dynamic = "force-dynamic";

import { z } from "zod";

import { AdjudicateProposal, ProposalQueueError } from "@nexalog/core";
import { getAuthUser } from "@/lib/auth/server";
import { logEvent } from "@/lib/logger";
import { getProposalQueue } from "@/lib/proposals/queue";
import { toProposalDto } from "@/lib/proposals/dto";

/** `strict()` so a misspelled field is a 400, not a silently ignored intent. */
const actBody = z.object({ accept: z.boolean() }).strict();

function parseProposalId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const proposalId = parseProposalId(id ?? "");
  if (proposalId === null) return Response.json({ error: "invalid_id" }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const parsed = actBody.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });

  logEvent("route.start", {
    route: "/api/proposals/[id]/act",
    method: "POST",
    proposalId,
    accept: parsed.data.accept,
  });

  const queue = getProposalQueue();
  if (!queue) {
    return Response.json(
      {
        error: "gbrain_unavailable",
        code: "not_configured",
        message:
          "This deployment has no gbrain database configured (GBRAIN_DATABASE_URL is unset), so a proposal cannot be adjudicated here.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    // The audit identity is the session's, never the body's.
    const result = await new AdjudicateProposal(queue).execute({
      proposalId,
      accept: parsed.data.accept,
      actedBy: user.id,
    });

    return Response.json({
      ok: true,
      proposal: toProposalDto(result.proposal),
      promoted: result.promoted,
    });
  } catch (err) {
    if (err instanceof ProposalQueueError) {
      // `not_found` is a 404; every other business-rule failure is a conflict —
      // the row exists and is simply not in a state this decision applies to.
      const status = err.code === "not_found" ? 404 : 409;
      return Response.json(
        {
          error: err.code,
          message: err.message,
          ...(err.hint ? { hint: err.hint } : {}),
        },
        { status },
      );
    }

    const message = err instanceof Error ? err.message : "proposal act failed";
    logEvent("proposals.act.failed", { proposalId, accept: parsed.data.accept, error: message });
    return Response.json({ error: "promote_failed" }, { status: 500 });
  }
}
