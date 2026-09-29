// SPDX-License-Identifier: MIT
/**
 * The chat runtime adapter — the SSE framing rules, which are the part that
 * fails SILENTLY in production.
 *
 * WHY THESE CASES
 * ---------------
 * A dropped frame in a chat stream does not look like a transport bug; it looks
 * like the model being wrong. So the cases below are the ones where a naive
 * implementation loses data:
 *
 *   - a frame split across two chunks at an arbitrary byte. `chunk.split("\n")`
 *     is the natural implementation and it drops a `data:` line every time a
 *     boundary lands mid-frame. This case fails on that implementation.
 *   - a multi-byte character split across two chunks (the decoder must run in
 *     streaming mode or the character is mangled into replacement glyphs).
 *   - `[DONE]`, which is not JSON.
 *   - an error frame inside a 200 stream: the gateway opened the stream and then
 *     failed. Reporting an empty success here is the dishonest outcome.
 *   - a non-SSE body on a 200 (a proxy page): must be an error, not zero deltas.
 *   - a non-streamed JSON completion even though `stream: true` was asked for:
 *     a legitimate answer that must not be discarded.
 *   - a non-2xx before any bytes: must THROW so the caller can degrade, because
 *     that is the difference between "no answer to take" and "the answer stopped".
 */

import { describe, it, expect, vi, afterEach } from "vitest";

import {
  ChatRuntimeUnreachableError,
  OpenAiCompatChatRuntime,
  parseSseStream,
} from "../src/chat-openai/openai-compat-chat-runtime";

function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function delta(text: string): string {
  return frame({ choices: [{ index: 0, delta: { content: text } }] });
}

/** A stream that emits exactly the given string chunks, in order. */
function bodyOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i++]));
    },
  });
}

async function collect(events: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const e of events) out.push(e);
  return out;
}

/** A typed fetch spy so the call arguments are readable in assertions. */
type FetchMock = ReturnType<typeof vi.fn<(input: string, init: RequestInit) => Promise<Response>>>;

function stubFetch(res: Response): FetchMock {
  const fetchMock = vi.fn(async (_input: string, _init: RequestInit) => res);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock as unknown as FetchMock;
}

function sseResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function runtime() {
  return new OpenAiCompatChatRuntime({
    id: "test-leg",
    baseUrl: "http://chat.example.test",
    model: "test-model",
    sessionHeader: "X-Test-Session-Id",
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseSseStream", () => {
  it("reassembles a frame split across chunks", async () => {
    const events = await collect(
      parseSseStream(bodyOf("data: {\"choices\":[{\"delta\":{\"con", "tent\":\"hello\"}}]}\n\n", "data: [DONE]\n\n"), "t"),
    );
    expect(events).toEqual([{ type: "delta", text: "hello" }, { type: "done", finishReason: null }]);
  });

  it("reassembles a multi-byte character split across chunks", async () => {
    const full = delta("héllo — ok");
    // Cut at a byte that lands inside a multi-byte sequence.
    const cut = 30;
    const events = await collect(
      parseSseStream(bodyOf(full.slice(0, cut), full.slice(cut)), "t"),
    );
    expect(events).toEqual([{ type: "delta", text: "héllo — ok" }]);
  });

  it("emits a final frame with no trailing newline", async () => {
    const events = await collect(parseSseStream(bodyOf(delta("last")), "t"));
    expect(events).toEqual([{ type: "delta", text: "last" }]);
  });

  it("treats [DONE] as the end sentinel, not JSON", async () => {
    const events = await collect(parseSseStream(bodyOf("data: [DONE]\n\n"), "t"));
    expect(events).toEqual([{ type: "done", finishReason: null }]);
  });

  it("ignores event:/id:/comment lines and empty data lines", async () => {
    const events = await collect(
      parseSseStream(bodyOf("event: message\n\n: ping\n\ndata:\n\n", delta("x")), "t"),
    );
    expect(events).toEqual([{ type: "delta", text: "x" }]);
  });

  it("reports a finish_reason as done", async () => {
    const events = await collect(
      parseSseStream(bodyOf(frame({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })), "t"),
    );
    expect(events).toEqual([{ type: "done", finishReason: "stop" }]);
  });

  it("surfaces an error frame inside a 200 stream as an error, not an empty success", async () => {
    const events = await collect(
      parseSseStream(bodyOf(delta("partial"), frame({ error: { message: "upstream exploded" } })), "t"),
    );
    expect(events).toEqual([
      { type: "delta", text: "partial" },
      { type: "error", message: "t: upstream exploded", status: null },
    ]);
  });

  it("does not put reasoning-only deltas into the answer", async () => {
    const events = await collect(
      parseSseStream(
        bodyOf(frame({ choices: [{ index: 0, delta: { reasoning_content: "thinking…" } }] }), delta("answer")),
        "t",
      ),
    );
    expect(events).toEqual([{ type: "delta", text: "answer" }]);
  });

  it("drops an unparseable frame instead of failing the stream", async () => {
    const events = await collect(parseSseStream(bodyOf("data: {not json}\n\n", delta("ok")), "t"));
    expect(events).toEqual([{ type: "delta", text: "ok" }]);
  });
});

describe("streamTurn", () => {
  it("sends the model, stream:true and the session header the leg declares", async () => {
    const fetchMock = stubFetch(sseResponse(bodyOf(delta("hi"), "data: [DONE]\n\n")));
    await collect(runtime().streamTurn({
      context: "## Standing entities\n- card",
      message: "a question",
      history: [{ role: "assistant", content: "earlier" }],
      sessionId: "sess-1",
    }));

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://chat.example.test/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Test-Session-Id"]).toBe("sess-1");
    const body = JSON.parse(String(init.body)) as { model: string; stream: boolean; messages: Array<{ role: string; content: string }> };
    expect(body.model).toBe("test-model");
    expect(body.stream).toBe(true);
    // The context is a SYSTEM message; the user's turn is the last message.
    expect(body.messages[0]).toEqual({ role: "system", content: "## Standing entities\n- card" });
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "a question" });
  });

  it("omits the system message when there is no context", async () => {
    const fetchMock = stubFetch(sseResponse(bodyOf(delta("hi"), "data: [DONE]\n\n")));
    await collect(runtime().streamTurn({ context: "   ", message: "q", history: [] }));
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as {
      messages: Array<{ role: string }>;
    };
    expect(body.messages.map((m) => m.role)).toEqual(["user"]);
  });

  it("does not send the session header when the leg declares none", async () => {
    const leg = new OpenAiCompatChatRuntime({ id: "plain", baseUrl: "http://x.test", model: "m" });
    const fetchMock = stubFetch(sseResponse(bodyOf(delta("hi"), "data: [DONE]\n\n")));
    await collect(leg.streamTurn({ context: "", message: "q", history: [], sessionId: "sess-1" }));
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers["X-Test-Session-Id"]).toBeUndefined();
    expect(headers.Authorization).toBeUndefined();
  });

  it("throws ChatRuntimeUnreachableError with the status on a non-2xx", async () => {
    stubFetch(new Response("nope", { status: 503 }));
    const error = await collect(runtime().streamTurn({ context: "", message: "q", history: [] })).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(ChatRuntimeUnreachableError);
    expect((error as ChatRuntimeUnreachableError).status).toBe(503);
  });

  it("throws on a 200 that is NOT an event-stream", async () => {
    stubFetch(new Response("<html>proxy</html>", { status: 200, headers: { "Content-Type": "text/html" } }));
    const error = await collect(runtime().streamTurn({ context: "", message: "q", history: [] })).catch((e) => e);
    expect(error).toBeInstanceOf(ChatRuntimeUnreachableError);
  });

  it("accepts a non-streamed JSON completion instead of discarding a real answer", async () => {
    stubFetch(
      new Response(
        JSON.stringify({ choices: [{ message: { role: "assistant", content: "a whole answer" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const events = await collect(runtime().streamTurn({ context: "", message: "q", history: [] }));
    expect(events).toEqual([
      { type: "delta", text: "a whole answer" },
      { type: "done", finishReason: "stop" },
    ]);
  });
});
