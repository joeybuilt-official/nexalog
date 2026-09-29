// SPDX-License-Identifier: MIT
/**
 * GET /api/proposals — the pending take queue, paged.
 *
 * THE DEAD QUEUE THIS DRAINS
 * --------------------------
 * gbrain's `propose_takes` cycle phase scans brain pages and writes candidate
 * claims into its `take_proposals` table. Nothing could adjudicate them: gbrain's
 * MCP surface exposes no accept verb, its `takes propose --accept` exists only as
 * a local CLI, and Nexalog had neither a surface nor a write path. The measured
 * result — 170 rows pending, 92 rejected, ZERO ever promoted — is what a queue
 * looks like when the decision it exists for has no path.
 *
 * WHY THIS ROUTE SITS BESIDE `/api/pages` AND NOT INSIDE IT
 * --------------------------------------------------------
 * Brain pages are global to the deployment (one repo, one index), so a session is
 * the whole isolation boundary there. This queue is the same shape: gbrain owns
 * one brain, a proposal belongs to that brain, and there is no workspace column to
 * scope by. The auth gate is therefore identical to the neighbouring brain routes
 * — a validated session, 401 before any read.
 *
 * RESPONSE
 *   {
 *     proposals: [ProposalDto, …],          // newest first
 *     counts:    { pending, accepted, rejected, superseded },  // over the WHOLE queue
 *     nextOffset: number | null,
 *     degraded:  false,
 *     note?:     string
 *   }
 *
 * `counts` is over the whole queue rather than the returned page, because the
 * number this surface exists to display is "how many decisions are outstanding" —
 * a badge that described only the first page is how a backlog goes unnoticed.
 *
 * A deployment with no gbrain database is a 503 `gbrain_unavailable`, never an
 * empty list: "you have nothing to review" and "this instance cannot read the
 * queue" are different statements and only one of them is true.
 */

export const dynamic = "force-dynamic";

import { getAuthUser } from "@/lib/auth/server";
import { logEvent } from "@/lib/logger";
import { getProposalQueue } from "@/lib/proposals/queue";
import { toProposalDto } from "@/lib/proposals/dto";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function positiveInt(raw: string | null, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(max, Math.floor(n));
}

export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const limit = Math.max(1, positiveInt(url.searchParams.get("limit"), DEFAULT_LIMIT, MAX_LIMIT));
  const offset = positiveInt(url.searchParams.get("offset"), 0, Number.MAX_SAFE_INTEGER);

  logEvent("route.start", { route: "/api/proposals", method: "GET", limit, offset });

  const queue = getProposalQueue();
  if (!queue) {
    return Response.json(
      {
        error: "gbrain_unavailable",
        code: "not_configured",
        message:
          "This deployment has no gbrain database configured (GBRAIN_DATABASE_URL is unset), so the take-proposal queue cannot be read or adjudicated here.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const page = await queue.list({ limit, offset });
    return Response.json({
      proposals: page.proposals.map(toProposalDto),
      counts: page.counts,
      nextOffset: page.nextOffset,
      degraded: false,
    });
  } catch (err) {
    // A transport/driver failure is a server fault — 500 with a log line, never
    // a 200 whose empty list reads as "the queue is clear".
    const message = err instanceof Error ? err.message : "proposals failed";
    logEvent("proposals.list.failed", { limit, offset, error: message });
    return Response.json(
      { error: "gbrain_unavailable", code: "read_failed", message: "The proposal queue could not be read." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
