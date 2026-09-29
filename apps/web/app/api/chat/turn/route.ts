// SPDX-License-Identifier: MIT
/**
 * POST /api/chat/turn — ask the brain a question, streamed.
 *
 * THE SURFACE HALF OF THE DECIDED ARCHITECTURE
 * -------------------------------------------
 * Nexalog hosts the SURFACE: this session, the stream the browser reads, the
 * citations and the session rail. Whatever is behind the ONE chat port hosts
 * the TURN. This route's job is to be the seam between them and to be HONEST
 * about which half is missing when it is.
 *
 * `text/event-stream`, written by the route handler itself. Next.js route
 * handlers stream natively, so no SSE dependency is added — the repo has no
 * streaming primitive and does not need one for this.
 *
 * PRE-STREAM FAILURES ARE TYPED RESPONSES, NOT STREAM EVENTS
 * ---------------------------------------------------------
 * A failure before the first byte can still be a status code, and that is worth
 * much more to a client than an in-stream error: it is what makes "this
 * deployment cannot take a turn" distinguishable from "the answer stopped". So:
 *
 *   401  unauthorized        no valid session
 *   400  invalid_body        body is not JSON, or not `{message, sessionId?}`
 *   400  invalid_message     message missing/empty/over the cap
 *   404  session_not_found   a sessionId was given that this user does not own
 *   503  chat_unavailable    no turn leg configured, or it refused before
 *                            streaming. `code` says which; `surface` carries
 *                            the same readiness the GET reports.
 *   502  stream_broken       the leg accepted the turn and then the transport
 *                            died before any token arrived — distinct from a
 *                            mid-answer cut-off, which is an in-stream error
 *                            on the `done`/`error` frames.
 *
 * The route NEVER renders an empty 200 that looks like a working turn: an
 * answer with no `done` frame is a partial answer and the client is told so.
 */

export const dynamic = "force-dynamic";

import { z } from "zod";

import { ChatRuntimeUnreachableError } from "@nexalog/adapters";
import { getAuthUser } from "@/lib/auth/server";
import { logEvent } from "@/lib/logger";
import { getTurnDeps } from "@/lib/chat/read";
import { getChatSessionStore } from "@/lib/chat/session-store";
import { readChatSurfaceState } from "@/lib/chat/read";
import { encodeSse, runChatTurn } from "@/lib/chat/turn";

/** A turn is a question, not a document. Bounded so a paste cannot be a DoS. */
const MAX_MESSAGE_CHARS = 4000;

const turnBody = z
  .object({
    message: z.string().min(1).max(MAX_MESSAGE_CHARS),
    sessionId: z.string().min(1).max(200).optional(),
    /** The brain page in view, used when the turn opens a new session. */
    scope: z.string().min(1).max(400).nullable().optional(),
  })
  .strict();

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const parsed = turnBody.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_message" }, { status: 400 });

  const store = getChatSessionStore();
  const { message, sessionId, scope } = parsed.data;

  const existing = sessionId ? store.get(user.id, sessionId) : null;
  if (sessionId && !existing) {
    return Response.json({ error: "session_not_found" }, { status: 404 });
  }

  const surface = readChatSurfaceState();
  if (!surface.readiness.ready) {
    logEvent("chat.turn.refused", { reason: "no_turn_leg" });
    return Response.json(
      { error: "chat_unavailable", code: "turn_unconfigured", surface },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const deps = getTurnDeps();

  // The session is created HERE (the route owns the store) and the generator
  // announces it in its `meta` frame, so a first turn needs no second call.
  // `sessionCreated` is passed explicitly: the service receives a session either
  // way and cannot infer whether the client already knew this id.
  const sessionCreated = existing === null;
  const session = existing ?? store.create(user.id, scope ?? null);

  // `request.signal` aborts when the client disconnects: a stream nobody reads
  // must stop, both to free the leg and because a half-consumed answer written
  // into the rail is worse than no answer.
  const generator = runChatTurn(
    {
      userId: user.id,
      message,
      session,
      sessionCreated,
      scope: scope ?? null,
      signal: request.signal,
    },
    deps,
  );

  // PRIME the generator: the first `meta`/`error` frame is produced before any
  // bytes are committed, which is what lets a leg that refuses outright become a
  // typed 503/502 instead of an empty stream the client must interpret.
  let first: Awaited<ReturnType<typeof generator.next>>;
  try {
    first = await generator.next();
  } catch (e) {
    logEvent("chat.turn.error", { stage: "prime", error: String(e) });
    return Response.json(
      { error: "stream_broken", code: "leg_failed", surface },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  const firstValue = first.done ? null : first.value;
  if (firstValue?.type === "error") {
    // `chat_unconfigured` cannot happen here (readiness gated it) but the leg
    // can still refuse; both are the same statement to a client.
    const status = firstValue.code === "chat_unconfigured" ? 503 : 502;
    logEvent("chat.turn.refused", { code: firstValue.code });
    return Response.json(
      { error: "chat_unavailable", code: firstValue.code, surface },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }

  logEvent("route.start", {
    route: "/api/chat/turn",
    method: "POST",
    leg: surface.readiness.leg,
    sessionId: session.id,
    scope: session.scope,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true; // the client went away; stop writing rather than throw
        }
      };

      try {
        if (firstValue) write(encodeSse(firstValue));
        for await (const event of generator) {
          write(encodeSse(event));
        }
      } catch (e) {
        // A throw past the prime can only be transport-level (the service turns
        // expected failures into `error` frames). Reporting it as a frame keeps
        // the client's contract: the stream always ends with `done` or `error`.
        const unreachable = e instanceof ChatRuntimeUnreachableError;
        write(
          encodeSse({
            type: "error",
            message: String(e),
            code: unreachable ? "leg_unreachable" : "stream_failed",
          }),
        );
        logEvent("chat.turn.error", { stage: "stream", error: String(e) });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed by the consumer
        }
      }
    },
    cancel() {
      // The browser navigated away or aborted. Stop the generator so the leg's
      // request is aborted with it.
      void generator.return(undefined);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      // Proxies that buffer would defeat the whole point of streaming.
      "X-Accel-Buffering": "no",
    },
  });
}
