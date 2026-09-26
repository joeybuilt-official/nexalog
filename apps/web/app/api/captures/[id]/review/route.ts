// SPDX-License-Identifier: MIT
/**
 * POST /api/captures/[id]/review — the operator's decision on a review capture.
 *
 * Body: `{ "accept": boolean }` — `true` completes the capture
 * (`review → processed`, the pages the worker proposed are kept), `false`
 * rejects it (`review → rejected`).
 *
 * This is the operator side of the Phase 2 loop: the Hermes inbox worker
 * escalates an uncertain capture to `status: review` and writes a
 * `nexalog.proposal` block, and until now nothing could resolve it — the
 * ResolveReview use case was wired into the composition root but had no route.
 *
 * One route, not two, because accept and reject are the same decision on the
 * same resource with one boolean of difference; the capture transitions stay in
 * the domain (`Capture.acceptReview` / `reject`), this handler only parses,
 * delegates, and maps the outcome onto a status. Domain errors carry a stable
 * `code` — clients branch on that, never on `message`.
 */

export const dynamic = "force-dynamic";

import { Ulid, CaptureNotFoundError, CaptureTransitionError } from "@nexalog/core";
import { z } from "zod";
import { getComposition } from "@/composition";
import { getAuthUser } from "@/lib/auth/server";
import { logEvent } from "@/lib/logger";

/** `strict()` so a misspelled field is a 400, not a silently ignored intent. */
const reviewBody = z.object({ accept: z.boolean() }).strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Middleware only checks the session cookie is PRESENT and lets bearer
  // requests straight through, so the handler is where the session is actually
  // validated (same pattern as ../archive and ../open).
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!id) return Response.json({ error: "missing_id" }, { status: 400 });

  let captureId: Ulid;
  try {
    captureId = Ulid.of(id);
  } catch {
    return Response.json({ error: "invalid_id" }, { status: 400 });
  }

  // Validate the shape before touching the store: a malformed body must not
  // commit a transition.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const parsed = reviewBody.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  // Composition access is inside the try: a missing `BRAIN_REPO` is a genuine
  // server fault, not a silently-typed success — it reports 500 and logs.
  try {
    const { resolveReview } = getComposition();
    await resolveReview.execute({ captureId, accept: parsed.data.accept });
  } catch (e) {
    if (e instanceof CaptureNotFoundError) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    if (e instanceof CaptureTransitionError) {
      // The row moved under the operator (another tab, or the worker resolved
      // it): report the state it is actually in so the UI can say so.
      return Response.json(
        {
          error: "invalid_transition",
          message: e.message,
          from: e.from,
          to: e.to,
        },
        { status: 409 }
      );
    }
    const message = e instanceof Error ? e.message : "review failed";
    logEvent("capture.review.failed", { captureId: id, accept: parsed.data.accept, error: message });
    return Response.json({ error: "review_failed" }, { status: 500 });
  }

  return Response.json({
    ok: true,
    captureId: id,
    status: parsed.data.accept ? "processed" : "rejected",
  });
}
