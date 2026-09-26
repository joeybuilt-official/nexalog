// SPDX-License-Identifier: MIT
/**
 * Endpoint test for POST /api/captures/[id]/review — the operator's accept /
 * reject on a `status: review` capture.
 *
 * Covers, per `.claude/rules/testing.md` → "What an endpoint test asserts":
 *   - success (both decisions) with the exact response shape;
 *   - every validation failure (missing/invalid id, body not JSON, wrong type,
 *     missing field, rejected extra field) and the status each produces;
 *   - the unauthorized path;
 *   - the not-found path (the id is real but no capture is behind it);
 *   - the conflict path — a capture the operator cannot resolve because it is
 *     not in `review` any more;
 *   - the unexpected-failure path, which must be a 500 with a typed body and a
 *     log line, never a silent success.
 *
 * The use case is faked at the composition root (`@/composition`) and auth is
 * mocked to a fixed user, so nothing here boots Next, touches the brain repo,
 * or re-tests auth (see testing.md → "Mocking").
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CaptureNotFoundError, CaptureTransitionError, Ulid } from "@nexalog/core";

const { execute, getAuthUser, logEvent, getComposition } = vi.hoisted(() => ({
  execute: vi.fn(),
  getAuthUser: vi.fn(),
  logEvent: vi.fn(),
  getComposition: vi.fn(),
}));

vi.mock("@/composition", () => ({ getComposition }));
vi.mock("@/lib/auth/server", () => ({ getAuthUser }));
vi.mock("@/lib/logger", () => ({ logEvent }));

import { POST } from "@/app/api/captures/[id]/review/route";

const ID = "0123456789ABCDEFGHJKMNPQRS";

const USER = { id: "user-1" };

function call(id: string, body?: unknown, init: RequestInit = {}) {
  const request = new Request(`http://localhost/api/captures/${id}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    ...init,
  });
  return POST(request, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  execute.mockReset();
  execute.mockResolvedValue(undefined);
  getAuthUser.mockReset();
  getAuthUser.mockResolvedValue(USER);
  logEvent.mockReset();
  getComposition.mockReset();
  getComposition.mockReturnValue({ resolveReview: { execute } });
});

describe("POST /api/captures/[id]/review", () => {
  it("accepts: 200 + the resolved status, and passes a real Ulid inward", async () => {
    const response = await call(ID, { accept: true });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, captureId: ID, status: "processed" });

    expect(execute).toHaveBeenCalledTimes(1);
    const arg = execute.mock.calls[0][0] as { captureId: Ulid; accept: boolean };
    expect(arg.accept).toBe(true);
    // The use case takes a value object, not the raw path string.
    expect(arg.captureId).toBeInstanceOf(Ulid);
    expect(arg.captureId.value).toBe(ID);
  });

  it("rejects: 200 + the rejected status", async () => {
    const response = await call(ID, { accept: false });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, captureId: ID, status: "rejected" });
    expect((execute.mock.calls[0][0] as { accept: boolean }).accept).toBe(false);
  });

  it("401s without a session, and never reaches the use case", async () => {
    getAuthUser.mockResolvedValue(null);

    const response = await call(ID, { accept: true });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("400s on an id that is not a ULID", async () => {
    const response = await call("not-a-ulid", { accept: true });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_id" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("400s on a body that is not JSON", async () => {
    const request = new Request(`http://localhost/api/captures/${ID}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{nope",
    });
    const response = await POST(request, { params: Promise.resolve({ id: ID }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_body" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("400s on an empty body", async () => {
    const response = await call(ID);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_body" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("400s when accept is missing, not a boolean, or accompanied by junk", async () => {
    for (const body of [{}, { accept: "yes" }, { accept: 1 }, { accept: true, extra: 1 }]) {
      const response = await call(ID, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_body" });
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it("404s when the capture does not exist", async () => {
    execute.mockRejectedValue(new CaptureNotFoundError(ID));

    const response = await call(ID, { accept: true });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("409s when the capture is no longer in review, and names both statuses", async () => {
    execute.mockRejectedValue(
      new CaptureTransitionError({
        captureId: ID,
        from: "processed",
        to: "processed",
        rule: "Only a review capture can be accepted",
      }),
    );

    const response = await call(ID, { accept: true });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "invalid_transition",
      message: "Only a review capture can be accepted",
      from: "processed",
      to: "processed",
    });
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("500s loudly on an unexpected failure — typed body, logged, no fake success", async () => {
    execute.mockRejectedValue(new Error("disk on fire"));

    const response = await call(ID, { accept: false });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "review_failed" });
    expect(logEvent).toHaveBeenCalledWith(
      "capture.review.failed",
      expect.objectContaining({ captureId: ID, accept: false, error: "disk on fire" }),
    );
  });

  it("500s (not a framework crash) when the composition root itself cannot build", async () => {
    getComposition.mockImplementation(() => {
      throw new Error("BRAIN_REPO env is required (absolute path to the brain repo)");
    });

    const response = await call(ID, { accept: true });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "review_failed" });
    expect(logEvent).toHaveBeenCalledWith(
      "capture.review.failed",
      expect.objectContaining({ captureId: ID, accept: true }),
    );
  });
});
