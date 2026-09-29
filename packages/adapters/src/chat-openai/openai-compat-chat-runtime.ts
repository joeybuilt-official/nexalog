// SPDX-License-Identifier: MIT
/**
 * OpenAiCompatChatRuntime — the adapter behind `ChatRuntime` (the ONE chat
 * port), speaking the OpenAI-compatible streaming wire that BOTH legs of the
 * decided architecture already expose:
 *
 *   - the Hermes agent endpoint (deployed alongside this app) — Hermes hosts the
 *     TURN: the agent loop, tools and writeback. It keeps the session itself,
 *     continued with its own session-id header, so `sessionId` is forwarded as
 *     that header only when the leg declares one (`sessionHeader`).
 *   - the LiteLLM gateway (the standalone tier): the same wire with no agent
 *     loop behind it.
 *
 * Endpoints are configuration, never code: the base URL, key, model and session
 * header all arrive through the composition root, and the deployment sets them
 * to its own internal service names. Nothing here is pinned to a host.
 *
 * ONE adapter for both, deliberately. The two legs differ in a base URL, a key
 * and at most one header — a second adapter class would be the same `fetch`
 * twice, and the decision that matters (which leg is configured) belongs in the
 * composition root, not in two files that drift.
 *
 * WHY THERE IS A MODEL LEG AT ALL, given "Nexalog makes no LLM calls": the
 * settled revision is "no PROVIDER calls" (ADR-0017 retired the exclusivity
 * clause). Nexalog hosts the surface — this session, this stream, the
 * citations. Whatever answers behind this port hosts the turn. Nothing here
 * embeds anything: no embeddings are produced, no vector is written, and the
 * 1024-dim pgvector invariant is untouched because this adapter never touches
 * the database at all.
 *
 * WIRE NOTES (why the parsing looks like this)
 * -------------------------------------------
 *  - SSE frames arrive split across chunk boundaries at arbitrary points, so
 *    the decoder keeps a buffer and only emits COMPLETE lines. A naive
 *    `chunk.split("\n")` silently drops a `data:` line every time a frame
 *    straddles a read, which shows up as missing words in the middle of an
 *    answer — the worst possible failure for a chat surface, because it reads
 *    as the model being wrong rather than the transport being broken.
 *  - `[DONE]` is the end-of-stream sentinel; it is not JSON and must not be
 *    parsed as one.
 *  - A response body that is NOT an event-stream (an error page, a JSON error
 *    object from a proxy) is reported as an error carrying its status, not
 *    parsed as deltas and not swallowed.
 *  - A non-2xx BEFORE any bytes streamed throws, so the caller can distinguish
 *    "this leg is unreachable/unconfigured" (degrade + say so) from "the stream
 *    died mid-answer" (report the partial answer).
 */

import type {
  ChatRuntime,
  ChatRuntimeEvent,
  ChatRuntimeRequest,
} from "@nexalog/core";

export interface OpenAiCompatChatRuntimeOptions {
  /** Stable id for this leg, e.g. `hermes` or `litellm:<model>`. */
  id: string;
  /** Base URL of the endpoint, WITHOUT `/v1` — e.g. `http://chat.internal:8080`. */
  baseUrl: string;
  /** Bearer token. Absent is allowed: an open local gateway needs none. */
  apiKey?: string;
  /** Model name to request. */
  model: string;
  /**
   * Session-continuity header this leg understands, sent with
   * `ChatRuntimeRequest.sessionId`. Omit for a leg that has no session concept
   * — sending an unknown header to LiteLLM would be noise, not continuity.
   */
  sessionHeader?: string;
  /** Request timeout in ms (default 120000 — a turn is slower than a lookup). */
  timeoutMs?: number;
}

/** Raised when the leg cannot be reached at all, before any token streamed. */
export class ChatRuntimeUnreachableError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "ChatRuntimeUnreachableError";
  }
}

export class OpenAiCompatChatRuntime implements ChatRuntime {
  readonly id: string;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly sessionHeader?: string;
  private readonly timeoutMs: number;

  constructor(opts: OpenAiCompatChatRuntimeOptions) {
    this.id = opts.id;
    this.model = opts.model;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.sessionHeader = opts.sessionHeader;
    this.timeoutMs = opts.timeoutMs ?? 120000;
  }

  async *streamTurn(request: ChatRuntimeRequest): AsyncIterable<ChatRuntimeEvent> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    if (this.sessionHeader && request.sessionId) headers[this.sessionHeader] = request.sessionId;

    // The context is handed over as a SYSTEM message, separately framed: the
    // endpoint decides how to place a system prompt, and the framing that marks
    // brain content as data lives in core (`renderContextBlock`).
    const messages: Array<{ role: string; content: string }> = [];
    if (request.context.trim()) messages.push({ role: "system", content: request.context });
    for (const turn of request.history) messages.push({ role: turn.role, content: turn.content });
    messages.push({ role: "user", content: request.message });

    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = request.signal
      ? AbortSignal.any([request.signal, timeout])
      : timeout;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: this.model, messages, stream: true }),
        signal,
      });
    } catch (e) {
      throw new ChatRuntimeUnreachableError(
        `Chat endpoint unreachable (${this.id}): ${String(e)}`,
        null,
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ChatRuntimeUnreachableError(
        `Chat endpoint answered HTTP ${res.status} (${this.id}): ${body.slice(0, 300)}`,
        res.status,
      );
    }

    // A 200 that is not an event-stream is a proxy/HTML page, not a model.
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream") || !res.body) {
      const body = await res.text().catch(() => "");
      if (contentType.includes("application/json")) {
        // Some gateways answer a non-streamed completion even when asked to
        // stream. That is a legitimate answer — surface its text as one delta
        // rather than failing a working request.
        const text = extractNonStreamedText(body);
        if (text) {
          yield { type: "delta", text };
          yield { type: "done", finishReason: "stop" };
          return;
        }
      }
      throw new ChatRuntimeUnreachableError(
        `Chat endpoint did not stream (${this.id}, content-type "${contentType || "none"}"): ` +
          body.slice(0, 300),
        res.status,
      );
    }

    yield* parseSseStream(res.body, this.id);
  }
}

/**
 * Walk one SSE body, emitting deltas as they arrive. Split out so the framing
 * rules can be read (and tested) on their own.
 */
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
  label: string,
): AsyncIterable<ChatRuntimeEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // `stream: true` on the decoder so a multi-byte character split across
      // two chunks is reassembled rather than mangled.
      buffer += decoder.decode(value, { stream: true });

      // Only complete lines are consumed; the tail stays buffered. An SSE frame
      // is `data: <json>\n` (the blank-line separator carries no payload we
      // need — every event here is a single JSON object).
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        const event = parseSseLine(line, label);
        if (event) yield event;
        newline = buffer.indexOf("\n");
      }
    }
    // A final frame without a trailing newline still counts.
    const tail = parseSseLine(buffer.replace(/\r$/, ""), label);
    if (tail) yield tail;
  } catch (e) {
    // The transport died mid-stream (`TypeError: terminated` is what a
    // truncated chunked body surfaces as). This is NOT thrown: a partial answer
    // is still an answer, and the caller's job is to report it as partial rather
    // than discard what already arrived. The frame is emitted here because only
    // this layer knows the stream was cut rather than completed.
    yield { type: "error", message: `${label}: stream terminated (${String(e)})`, status: null };
  } finally {
    reader.releaseLock();
  }
}

/** One SSE line → one event, or null when the line carries nothing usable. */
function parseSseLine(line: string, label: string): ChatRuntimeEvent | null {
  if (!line.startsWith("data:")) return null; // `event:` / `id:` / comments
  const data = line.slice(5).trim();
  if (!data) return null;
  if (data === "[DONE]") return { type: "done", finishReason: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null; // a partial/keep-alive frame — a later line carries the payload
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const frame = parsed as Record<string, unknown>;

  // An error can arrive INSIDE a 200 stream (the gateway opened the stream,
  // then failed). Reported as an error event so the surface can say the answer
  // stopped — never as an empty successful one.
  if (frame.error) {
    const err = typeof frame.error === "object" && frame.error !== null
      ? (frame.error as Record<string, unknown>)
      : null;
    const message =
      (typeof err?.message === "string" ? err.message : null) ??
      (typeof frame.error === "string" ? frame.error : JSON.stringify(frame.error));
    return { type: "error", message: `${label}: ${message}`, status: null };
  }

  const choice = firstChoice(frame);
  if (!choice) return null;

  const delta = choice.delta;
  if (typeof delta === "object" && delta !== null) {
    const content = (delta as Record<string, unknown>).content;
    if (typeof content === "string" && content.length > 0) {
      return { type: "delta", text: content };
    }
  }
  // A reasoning-only delta (some models stream `reasoning_content`) carries no
  // answer text: dropping it is correct, surfacing it would put chain-of-thought
  // into the user's answer.
  if (typeof choice.finish_reason === "string") {
    return { type: "done", finishReason: choice.finish_reason };
  }
  return null;
}

function firstChoice(frame: Record<string, unknown>): Record<string, unknown> | null {
  const choices = frame.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  return typeof first === "object" && first !== null
    ? (first as Record<string, unknown>)
    : null;
}

/** Pull `choices[0].message.content` out of a non-streamed completion body. */
function extractNonStreamedText(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const choice = firstChoice(parsed);
    const message = choice?.message;
    if (typeof message === "object" && message !== null) {
      const content = (message as Record<string, unknown>).content;
      if (typeof content === "string") return content;
    }
    return null;
  } catch {
    return null;
  }
}
