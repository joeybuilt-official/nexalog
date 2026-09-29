// SPDX-License-Identifier: MIT
/**
 * GET /api/chat/surface — the chat surface's own readiness.
 *
 * A reader that is about to offer a composer needs to know whether this
 * deployment can take a turn at all, and it must not GUESS. This route reports
 * the composition root's own configuration plus the session store's health, so
 * the button and the API can never disagree — a screen offering a live control
 * while the route behind it is unconfigured is the exact "dead UI" class this
 * repo has already paid for (three Today blocks silently absent in production,
 * a disabled-by-omission chat control on every note).
 *
 * It is NOT `/api/health`: that route is public and cheap, and it answers "is
 * this process up". This requires a session and answers a narrower question
 * with a different audience (the chat page's own banner).
 */

export const dynamic = "force-dynamic";

import { getAuthUser } from "@/lib/auth/server";
import { readChatSurfaceState } from "@/lib/chat/read";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  return Response.json(
    { ok: true, ...readChatSurfaceState() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
