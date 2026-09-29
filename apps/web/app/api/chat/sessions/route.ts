// SPDX-License-Identifier: MIT
/**
 * GET  /api/chat/surface — can this deployment take a turn, and how is it wired?
 * POST /api/chat/sessions — open a chat session scoped to a brain page.
 * GET  /api/chat/sessions — read one back (the rail's own state).
 *
 * ONE route file for the session resource, mirroring `POST /api/captures/[id]/review`'s
 * single-resource shape: creating and reading a session are the same object
 * with one verb of difference, and splitting them would put the id contract in
 * two places.
 *
 * Why the surface probe lives beside it rather than under `/api/health`: the
 * health route answers "is this process up" and must stay cheap and public.
 * This answers "which chat legs answered", requires a session, and reports the
 * composition root's own configuration — a different question with a different
 * audience (the chat page's own banner).
 *
 * A session is per USER and the store enforces it: an id belonging to another
 * user reads as a 404, not a 403, so a session id is not probeable.
 */

export const dynamic = "force-dynamic";

import { z } from "zod";

import { getAuthUser } from "@/lib/auth/server";
import { logEvent } from "@/lib/logger";
import { readChatSurfaceState } from "@/lib/chat/read";
import { getChatSessionStore } from "@/lib/chat/session-store";

/** `strict()` so a misspelled field is a 400, not a silently ignored intent. */
const createBody = z.object({ scope: z.string().min(1).max(400).nullable().optional() }).strict();

export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  const surface = readChatSurfaceState();
  const store = getChatSessionStore();

  if (!id) return Response.json({ ok: true, surface }, { headers: { "Cache-Control": "no-store" } });

  const session = store.get(user.id, id);
  // Unknown id and someone else's id are the same answer, deliberately.
  if (!session) return Response.json({ error: "not_found" }, { status: 404 });

  logEvent("route.start", { route: "/api/chat/sessions", method: "GET", turns: session.turns.length });
  return Response.json(
    { ok: true, session, surface },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const parsed = createBody.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });

  const surface = readChatSurfaceState();
  // Refuse to open a session nobody can answer in. Creating one anyway would
  // hand the client an object whose only legal next action fails — and would
  // make the rail look like a working chat with a broken answer, instead of an
  // honestly unavailable one. The body carries the reason.
  if (!surface.readiness.ready) {
    logEvent("chat.session.refused", { reason: "no_turn_leg" });
    return Response.json(
      {
        error: "chat_unavailable",
        code: "turn_unconfigured",
        surface,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const scope = parsed.data.scope ?? null;
  const session = getChatSessionStore().create(user.id, scope);
  logEvent("route.start", { route: "/api/chat/sessions", method: "POST", scope });

  return Response.json(
    { ok: true, session, surface },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
