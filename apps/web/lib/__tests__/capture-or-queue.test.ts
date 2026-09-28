// SPDX-License-Identifier: MIT
/**
 * The URL-save wire: `captureOrQueue` must send what the route can parse.
 *
 * The defect this pins: the helper posted `JSON.stringify({kind:"url",…})`
 * with `Content-Type: application/json` to `/api/capture`, whose handler calls
 * `request.formData()`. A JSON body makes that throw ("Content-Type was not one
 * of multipart/form-data or application/x-www-form-urlencoded"), the route
 * catches it and returns `400 {ok:false}`, and the client turns that into the
 * user-visible "your capture wasn't saved". Every mounted save control went
 * through this helper, so nothing could be saved from the app at all.
 *
 * Two assertions that matter and are easy to get wrong in opposite directions:
 *   - a URL save goes to `/api/bookmarks` as JSON (a saved link is a bookmark,
 *     not a note) — with `application/json` set EXPLICITLY;
 *   - a text/form save goes to `/api/capture` as multipart with NO hand-written
 *     Content-Type, because the boundary must come from the browser.
 *
 * `fetch` and the outbox are faked; nothing here needs a network or a DB.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { enqueue, drainOutbox } = vi.hoisted(() => ({
  enqueue: vi.fn(),
  drainOutbox: vi.fn(),
}));

vi.mock("@/lib/offline/outbox", () => ({ enqueue, getPending: vi.fn(async () => []) }));
vi.mock("@/lib/offline/drain", () => ({ drainOutbox }));

import { captureOrQueue, routeForCapture, wireRequest } from "@/lib/offline/captureOrQueue";

const fetchMock = vi.fn();

beforeEach(() => {
  enqueue.mockReset();
  drainOutbox.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("{}", { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(globalThis.navigator, "onLine", { value: true, configurable: true });
});

describe("captureOrQueue — the URL-save wire", () => {
  it("posts a URL save to /api/bookmarks as JSON (the route that can parse it)", async () => {
    await captureOrQueue({ kind: "url", content: "https://example.com/x" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [route, init] = fetchMock.mock.calls[0];
    expect(route).toBe("/api/bookmarks");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ url: "https://example.com/x" });
  });

  it("passes the workspace through when the caller knows it", async () => {
    await captureOrQueue({ kind: "url", content: "https://example.com/x", workspaceId: "ws-1" });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      url: "https://example.com/x",
      workspaceId: "ws-1",
    });
  });

  it("posts a text capture to /api/capture as multipart with NO hand-written content type", async () => {
    await captureOrQueue({ kind: "text", content: "a thought" });

    const [route, init] = fetchMock.mock.calls[0];
    expect(route).toBe("/api/capture");
    // A hand-written Content-Type breaks the multipart boundary, and that is
    // exactly how `request.formData()` came to throw server-side.
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("text")).toBe("a thought");
  });

  it("forwards a caller-built FormData untouched", async () => {
    const form = new FormData();
    form.append("url", "https://example.com/y");
    form.append("source", "pwa-share");

    await captureOrQueue(form);

    const [route, init] = fetchMock.mock.calls[0];
    expect(route).toBe("/api/capture");
    expect(init.headers).toBeUndefined();
    expect(init.body).toBe(form);
  });

  it("queues for later when offline, against the same route it would have used", async () => {
    Object.defineProperty(globalThis.navigator, "onLine", { value: false, configurable: true });

    const result = await captureOrQueue({ kind: "url", content: "https://example.com/z" });

    expect(result).toEqual({ queued: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ route: "/api/bookmarks", body: expect.objectContaining({ kind: "url" }) }),
    );
  });

  it("throws on a non-OK response so the caller can show the failure", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 400 }));

    await expect(captureOrQueue({ kind: "url", content: "https://example.com/x" })).rejects.toThrow(
      "HTTP 400",
    );
  });

  it("drains the outbox after a successful online write", async () => {
    await captureOrQueue({ kind: "url", content: "https://example.com/x" });

    expect(drainOutbox).toHaveBeenCalledTimes(1);
  });
});

describe("routeForCapture / wireRequest", () => {
  it("routes by kind, deterministically", () => {
    expect(routeForCapture({ kind: "url", content: "https://example.com" })).toBe("/api/bookmarks");
    expect(routeForCapture({ kind: "text", content: "x" })).toBe("/api/capture");
    expect(routeForCapture(new FormData())).toBe("/api/capture");
  });

  it("never sends a JSON content type with a FormData body", () => {
    const wire = wireRequest({ kind: "text", content: "x" });
    expect(wire.headers).toBeUndefined();
    expect(wire.body).toBeInstanceOf(FormData);
  });
});
