// SPDX-License-Identifier: MIT
/**
 * The chat turn, server-side: assemble the brain context, take the turn through
 * the ONE chat port, and resolve what the answer may cite.
 *
 * RESPONSIBILITY SPLIT (this is the decided architecture, in code)
 * ---------------------------------------------------------------
 *   Nexalog (this file)  — the SURFACE. It owns the session, the window, the
 *                          stream the browser reads, and the citation list.
 *   the chat leg         — the TURN. Agent loop, tools, writeback. Nexalog does
 *                          not know which leg answered and must not branch on it.
 *   gbrain               — RETRIEVAL. Every fact in the context block comes from
 *                          its MCP tools; this file never embeds anything, and
 *                          therefore cannot create a second embedding path.
 *
 * CITATIONS ARE RESOLVED HERE, NOT IN THE UI
 * -----------------------------------------
 * A citation is a record `{href, slug, title, via}` where `href` is produced by
 * `brainPageHref` — the SAME helper the search page, the graph, the reader and
 * the content finder already use. There is deliberately no second href mapper:
 * four call sites once each derived a route from an id and every brain hit
 * 404'd on click, which is the exact defect this milestone's plan gates on.
 * Because the href is produced server-side and carried on the turn, a citation
 * that renders is a citation that resolves.
 *
 * WHAT THE STREAM MEANS
 * ---------------------
 * The browser reads `text/event-stream` frames from the route; this module
 * yields them. The events are a small, closed set:
 *
 *   meta   — once, first: leg, model, readiness, the plan's budgets, whether a
 *            session was created. Sent BEFORE the answer so the surface can
 *            state what grounded it rather than appending a receipt.
 *   delta  — answer text, in order.
 *   done   — the finished turn: the full text, the citations, the reads that
 *            degraded. Sent once. An answer with no `done` is a partial answer,
 *            and the client must render it as one.
 *   error  — a failure AFTER the stream opened. The status codes are the
 *            pre-stream ones; this is for a leg that dies mid-answer.
 *
 * A failure BEFORE any bytes are sent is a typed HTTP response instead (401,
 * 503 with a `code`), because that is what the client's fetch can act on.
 */

import type {
  AssembledContext,
  ChatRuntime,
  ChatRuntimeEvent,
} from "@nexalog/core";

import type { ChatCitation, ChatSession, ChatTurnRecord } from "./session-store";

/** The frames this surface emits. Closed set, so the client can switch on it. */
export type ChatStreamEvent =
  | { type: "meta"; leg: string; model: string; ready: boolean; grounded: boolean; note?: string; plan: TurnPlanSummary; sessionId: string; created: boolean }
  | { type: "delta"; text: string }
  | { type: "done"; content: string; citations: ChatCitation[]; degradedReads: string[]; partial: boolean }
  | { type: "error"; message: string; code: string };

/** What the plan did, stated to the client as data. */
export interface TurnPlanSummary {
  /** Brain page the turn was scoped to. */
  scope: string | null;
  /** Server-side token budgets actually requested. */
  packTokens: number;
  recallTokens: number;
  /** How many pages were read in full, and how many were offered. */
  expanded: number;
  /** True when the turn used `query` (expansion) rather than `search`. */
  concept: boolean;
  /** True when the turn opened with a graph walk. */
  graphWalk: boolean;
  /** Pages volunteered from the rolling window and used. */
  volunteered: number;
}

/** What the route must hand the service for one turn. */
export interface RunTurnInput {
  userId: string;
  message: string;
  /** The session to append to, or null to create one. */
  session: ChatSession | null;
  /**
   * True when the ROUTE created this session for this turn. The service cannot
   * infer it — it receives an already-created session either way — and the
   * client needs it to know whether to adopt the id it is about to be given.
   */
  sessionCreated: boolean;
  /** The brain page in view (used when creating a session). */
  scope: string | null;
  /** Aborted on client disconnect. */
  signal?: AbortSignal;
}

/** The dependencies one turn needs — injected, so the service is testable. */
export interface TurnDeps {
  chat: ChatRuntime | null;
  /**
   * Runs the gbrain reads and returns the assembled context + the plan that ran.
   * Null when gbrain is unconfigured — the turn proceeds ungrounded and says so.
   */
  assembleContext:
    | ((input: { message: string; scope: string | null; window: string }) => Promise<{
        context: AssembledContext;
        plan: TurnPlanSource;
      }>)
    | null;
  /** Append a turn and return the stored record. */
  appendTurn: (
    userId: string,
    sessionId: string,
    turn: Omit<ChatTurnRecord, "id" | "createdAt">,
  ) => ChatTurnRecord | null;
  /** Frame the assembled context for the model (pure, from core). */
  renderContext: (context: AssembledContext) => string;
  /** Rank/limit the citation list (pure, from core). */
  citationCandidates: (context: AssembledContext, max?: number) => Array<{
    slug: string;
    title: string;
    evidence: string | null;
  }>;
  /** Brain-page reader route, via the ONE existing mapper. */
  brainHref: (slug: string) => string;
}

/** The plan fields this service reports — a subset of the core `ContextPlan`. */
export interface TurnPlanSource {
  contextPackTokens: number;
  recallTokens: number;
  expanded: boolean;
  walkGraph: boolean;
}

/** The rolling window handed to `volunteer_context`: the last 3 turns. */
export const VOLUNTEER_WINDOW_TURNS = 3;

/**
 * Build the volunteer window from a session's turn list. It is `user:` /
 * `assistant:` prefixed lines, oldest → newest, because that is the shape
 * `volunteer_context` matches against — the tool needs to see WHO said what to
 * weight a mention, so flattening it to plain text would lose the signal.
 */
export function volunteerWindow(session: ChatSession | null, currentMessage: string): string {
  const turns = session ? session.turns.slice(-VOLUNTEER_WINDOW_TURNS) : [];
  const lines = turns.map((t) => `${t.role}: ${clip(t.content, 400)}`);
  lines.push(`user: ${clip(currentMessage, 400)}`);
  return lines.join("\n");
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/**
 * Run one turn, yielding surface events. Never throws for an expected failure:
 * every failure becomes an `error` event (after the stream opened) or is thrown
 * only for the route to map onto a typed pre-stream response.
 */
export async function* runChatTurn(
  input: RunTurnInput,
  deps: TurnDeps,
): AsyncGenerator<ChatStreamEvent> {
  if (!deps.chat) {
    yield {
      type: "error",
      message: "No chat leg is configured on this deployment.",
      code: "chat_unconfigured",
    };
    return;
  }

  // ── the session rail ────────────────────────────────────────────────────
  const session = input.session;
  const created = input.sessionCreated;
  const sessionId = session?.id ?? "";

  // ── per-turn grounding (gbrain reads only) ──────────────────────────────
  const scope = session?.scope ?? input.scope;
  const window = volunteerWindow(session, input.message);
  const degradedReads: string[] = [];
  let assembled: Awaited<ReturnType<NonNullable<TurnDeps["assembleContext"]>>> | null = null;

  if (deps.assembleContext) {
    try {
      assembled = await deps.assembleContext({ message: input.message, scope, window });
      degradedReads.push(...assembled.context.degradedReads);
    } catch {
      // The assembly use case already degrades per read; a throw here means the
      // client itself could not be constructed. The turn proceeds ungrounded
      // and SAYS SO rather than being refused.
      degradedReads.push("context_assembly");
    }
  } else {
    degradedReads.push("gbrain_unconfigured");
  }

  const contextText = assembled ? deps.renderContext(assembled.context) : "";

  // Store the user's turn BEFORE the answer is requested. If the turn leg then
  // dies, the question is still in the rail — a lost question is worse than a
  // lost answer, because the user cannot tell whether it was heard.
  const stored = session
    ? deps.appendTurn(input.userId, session.id, { role: "user", content: input.message })
    : null;

  const history = (session?.turns ?? [])
    .slice(-VOLUNTEER_WINDOW_TURNS - 1, stored ? -1 : undefined)
    .map((t) => ({ role: t.role, content: t.content }));

  // ── open the turn BEFORE committing anything to the wire ────────────────
  //
  // The first event is pulled here, not inside the loop: until the leg has
  // either produced something or failed, the route can still answer with a
  // STATUS. That is the difference the surface rests on — "this deployment
  // cannot take a turn" (a typed 503 with a reason) versus "the answer stopped"
  // (an in-stream error). Committing `meta` first would throw that distinction
  // away and leave the client reading frames to discover there is no leg.
  let answer = "";
  let streamError: string | null = null;
  let iterator: AsyncIterator<ChatRuntimeEvent>;
  let firstEvent: IteratorResult<ChatRuntimeEvent>;

  try {
    iterator = deps.chat.streamTurn({
      context: contextText,
      message: input.message,
      history,
      ...(session ? { sessionId: session.id } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    })[Symbol.asyncIterator]();
    firstEvent = await iterator.next();
  } catch (e) {
    // Transport-level refusal: rethrown for the route to map onto a status.
    // Nothing has been written yet, so this is still a pre-stream failure.
    throw e;
  }

  // The leg opened and immediately reported a failure — still pre-stream.
  if (!firstEvent.done && firstEvent.value.type === "error") {
    yield { type: "error", message: firstEvent.value.message, code: "leg_failed" };
    return;
  }

  yield {
    type: "meta",
    leg: deps.chat.id,
    model: deps.chat.model,
    ready: true,
    grounded: Boolean(assembled) && !degradedReads.includes("context_assembly"),
    ...(assembled
      ? {}
      : { note: "This turn runs without brain context — no page citations will be produced." }),
    sessionId,
    created,
    plan: {
      scope,
      packTokens: assembled?.plan.contextPackTokens ?? 0,
      recallTokens: assembled?.plan.recallTokens ?? 0,
      expanded: assembled?.context.expanded.length ?? 0,
      concept: assembled?.plan.expanded ?? false,
      graphWalk: assembled?.plan.walkGraph ?? false,
      volunteered: assembled?.context.volunteered.length ?? 0,
    },
  };

  // ── the turn ────────────────────────────────────────────────────────────
  try {
    for (let next = firstEvent; !next.done; next = await iterator.next()) {
      const event = next.value;
      if (event.type === "delta") {
        answer += event.text;
        yield { type: "delta", text: event.text };
      } else if (event.type === "error") {
        streamError = event.message;
        break;
      }
    }
  } catch (e) {
    // A throw past the prime is a transport failure mid-answer. The partial
    // answer is kept and the turn is marked partial.
    streamError = String(e);
  }

  const partial = streamError !== null;

  // ── citations ───────────────────────────────────────────────────────────
  const candidates = assembled
    ? deps.citationCandidates(assembled.context, 8)
    : [];
  const citations: ChatCitation[] = candidates.map((c) => ({
    href: deps.brainHref(c.slug),
    slug: c.slug,
    title: c.title || c.slug,
    via: c.evidence ?? "page",
  }));

  if (session && (answer || partial)) {
    deps.appendTurn(input.userId, session.id, {
      role: "assistant",
      content: answer,
      citations,
      degradedReads,
      ...(partial ? { partial: true } : {}),
    });
  }

  if (partial) {
    yield {
      type: "error",
      message: streamError ?? "The answer was cut off.",
      code: "stream_failed",
    };
    // The partial answer is still delivered with its citations — a half answer
    // the user can read beats a spinner that never resolves. `partial: true` is
    // what stops the client presenting it as complete.
  }

  yield {
    type: "done",
    content: answer,
    citations,
    degradedReads,
    partial,
  };
}

/**
 * One frame, encoded for the wire. `JSON.stringify` on an object with a `type`
 * discriminator — no `data:` smuggling of anything but JSON, so a page title
 * containing a newline cannot break the framing.
 */
export function encodeSse(event: ChatStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Re-exported for the route's leg classification without a second import site. */
export type { ChatRuntimeEvent };
