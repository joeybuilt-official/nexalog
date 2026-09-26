// SPDX-License-Identifier: MIT
/**
 * GET /api/captures — list captures by status, as JSON.
 *
 * This is the mobile client's read path. Until now the capture list existed
 * only inside the `/inbox` **server component**, which reads `ListInbox` →
 * `FsGitBrainStore` from the brain repo and renders HTML — so a native client
 * had no way to see that a capture was awaiting an operator decision, and the
 * accept/reject route it would have to POST to had nothing to list rows from.
 * The write path (`POST /api/captures/[id]/review`) was already shipped for the
 * web UI; this route is the missing read half.
 *
 * Query:
 *   status  optional — one of `CAPTURE_STATUSES`; omitted means every status.
 *   limit   optional — 1..500, default 200. Applied AFTER counting, so the
 *           counts are never a partial view of the inbox.
 *
 * Response (200):
 *   {
 *     "captures": [ CaptureDto, … ],       // most recent first
 *     "counts":   { "<status>": <number> … }  // over the WHOLE inbox, not just
 *                                             // the returned page
 *   }
 *
 * Errors follow the repo's typed shape — clients branch on the code, never on
 * message text: 401 `Unauthorized`, 400 `invalid_query`, 500 `captures_failed`.
 *
 * The read itself is one `ListInbox` call, the same use case the web page
 * calls, so there is exactly one definition of "what is in the inbox". The
 * store reads the inbox directory per call (it is small, and the brain repo —
 * not Postgres — is the system of record for captures), hence reading once and
 * doing the filter + count in memory rather than issuing two reads that could
 * disagree. No business logic here: parse the query, call the use case, map the
 * application type onto the wire DTO (`lib/captures/capture-dto.ts`).
 */

export const dynamic = "force-dynamic";

import { CAPTURE_STATUSES, type CaptureStatus } from "@nexalog/core";
import { z } from "zod";
import { getComposition } from "@/composition";
import { getAuthUser } from "@/lib/auth/server";
import { logEvent } from "@/lib/logger";
import { toCaptureDto } from "@/lib/captures/capture-dto";

/**
 * `strict()` so a misspelled parameter is a 400, not a silently ignored intent
 * — `?stat=review` returning the whole inbox is the failure this prevents, the
 * same reasoning as the review route's strict body.
 */
const listQuery = z
  .object({
    status: z.enum(CAPTURE_STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional().default(200),
  })
  .strict();

export async function GET(request: Request) {
  // Middleware only checks the session cookie is PRESENT and lets bearer
  // requests straight through, so the handler is where the session is actually
  // validated (same pattern as ../captures/[id]/review).
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const raw: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    // A repeated parameter is ambiguous input, not a value to pick from: the
    // last-wins shortcut would silently answer a question nobody asked.
    if (key in raw) return Response.json({ error: "invalid_query" }, { status: 400 });
    raw[key] = value;
  }
  const parsed = listQuery.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "invalid_query" }, { status: 400 });
  const { status, limit } = parsed.data;

  try {
    const { listInbox } = getComposition();
    // Unfiltered read: counts must describe the whole inbox, and the store has
    // to walk the directory either way to answer a status-filtered read.
    const all = await listInbox.execute({});
    const counts = Object.fromEntries(
      CAPTURE_STATUSES.map((s) => [s, all.filter((c) => c.status === s).length]),
    ) as Record<CaptureStatus, number>;

    const captures = (status ? all.filter((c) => c.status === status) : all)
      .slice(0, limit)
      .map(toCaptureDto);

    return Response.json({ captures, counts });
  } catch (e) {
    const message = e instanceof Error ? e.message : "captures failed";
    logEvent("captures.list.failed", {
      status: status ?? null,
      limit,
      error: message,
    });
    return Response.json({ error: "captures_failed" }, { status: 500 });
  }
}
