// SPDX-License-Identifier: MIT
/**
 * /api/chat/sessions and /api/chat/surface — the rail's own state.
 *
 * The defect class this pins is the one this repo has already paid for twice: a
 * surface that OFFERS something the deployment cannot serve. So the assertions
 * here are about refusing to lie:
 *
 *   - with no turn leg configured, opening a session is a typed 503 carrying the
 *     readiness, and the note NAMES the missing env var. A session created in
 *     that state would hand the client an object whose only next action 503s.
 *   - the surface probe reports both legs independently. The state that matters
 *     most is a WORKING turn leg with a dead retrieval leg: an answer that looks
 *     grounded and is not, which a single `available` boolean cannot express.
 *   - a session id belonging to someone else is a 404, identical to an unknown
 *     id, so ids are not probeable and ownership does not leak.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAuthUser, logEvent, getComposition } = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  logEvent: vi.fn(),
  getComposition: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({ getAuthUser }));
vi.mock("@/lib/logger", () => ({ logEvent }));
vi.mock("@/composition", () => ({ getComposition }));

import { GET as getSessions, POST as createSession } from "@/app/api/chat/sessions/route";
import { GET as getSurface } from "@/app/api/chat/surface/route";
import { getChatSessionStore } from "@/lib/chat/session-store";

const USER = { id: "user-1" };

function compose({
  chat = { id: "test-leg", model: "test-model" },
  gbrain = {},
}: {
  chat?: { id: string; model: string } | null;
  gbrain?: object | null;
} = {}) {
  getComposition.mockReturnValue({
    chat,
    gbrain: gbrain === null ? null : gbrain,
    assembleTurnContext: gbrain === null ? null : {},
    brainStore: {},
  });
}

function post(body: unknown) {
  return createSession(
    new Request("http://localhost/api/chat/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  getAuthUser.mockReset();
  getAuthUser.mockResolvedValue(USER);
  logEvent.mockReset();
  getComposition.mockReset();
  compose();
});

describe("POST /api/chat/sessions", () => {
  it("401s without a session", async () => {
    getAuthUser.mockResolvedValue(null);
    expect((await post({})).status).toBe(401);
  });

  it("creates a session scoped to the page in view", async () => {
    const res = await post({ scope: "concepts/litellm-gateway" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; session: { id: string; scope: string; turns: unknown[] } };
    expect(body.ok).toBe(true);
    expect(body.session.scope).toBe("concepts/litellm-gateway");
    expect(body.session.turns).toEqual([]);
  });

  it("400s on a misspelled field rather than silently ignoring it", async () => {
    expect((await post({ scopes: "typo" })).status).toBe(400);
    expect((await post({ scope: 42 })).status).toBe(400);
  });

  it("503s with the reason when no turn leg is configured", async () => {
    compose({ chat: null });
    const res = await post({ scope: "concepts/litellm-gateway" });
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      error: string;
      code: string;
      surface: { readiness: { ready: boolean; note: string } };
    };
    expect(body.error).toBe("chat_unavailable");
    expect(body.code).toBe("turn_unconfigured");
    expect(body.surface.readiness.note).toContain("CHAT_BASE_URL");
  });
});

describe("GET /api/chat/sessions", () => {
  it("reports the surface readiness", async () => {
    const res = await getSessions(new Request("http://localhost/api/chat/sessions"));
    const body = (await res.json()) as { ok: boolean; surface: { readiness: { ready: boolean; leg: string } } };
    expect(body.surface.readiness.ready).toBe(true);
    expect(body.surface.readiness.leg).toBe("test-leg");
  });

  it("reads a session back with the store's own durability note", async () => {
    const created = getChatSessionStore().create(USER.id, null);
    const res = await getSessions(new Request(`http://localhost/api/chat/sessions?id=${created.id}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { session: { id: string }; surface: { store: { note: string } } };
    expect(body.session.id).toBe(created.id);
    // The rail must state that sessions are not durable, in the server's words.
    expect(body.surface.store.note.toLowerCase()).toContain("restart");
  });

  it("404s another user's session, identically to an unknown id", async () => {
    const other = getChatSessionStore().create("someone-else", null);
    const mine = getChatSessionStore().create(USER.id, null);
    const theirs = await getSessions(new Request(`http://localhost/api/chat/sessions?id=${other.id}`));
    const unknown = await getSessions(new Request("http://localhost/api/chat/sessions?id=does-not-exist"));
    expect(theirs.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await theirs.json()).toEqual(await unknown.json());
  });
});

describe("GET /api/chat/surface", () => {
  it("reports both legs independently", async () => {
    const res = await getSurface();
    const body = (await res.json()) as { readiness: { ready: boolean; grounded: boolean; degraded: boolean; leg: string; model: string } };
    expect(body.readiness).toMatchObject({ ready: true, grounded: true, degraded: false, leg: "test-leg", model: "test-model" });
  });

  it("states that the turn leg is missing without claiming the brain is gone", async () => {
    compose({ chat: null });
    const body = (await (await getSurface()).json()) as { readiness: { ready: boolean; note: string } };
    expect(body.readiness.ready).toBe(false);
    // The note must not blame the brain: retrieval still works.
    expect(body.readiness.note).toContain("Retrieval and the reader work");
  });

  it("reports a working turn leg with no retrieval as degraded, not ready-and-grounded", async () => {
    compose({ chat: { id: "leg", model: "m" }, gbrain: null });
    const body = (await (await getSurface()).json()) as { readiness: { ready: boolean; grounded: boolean; degraded: boolean; note: string } };
    expect(body.readiness.ready).toBe(true);
    expect(body.readiness.grounded).toBe(false);
    expect(body.readiness.degraded).toBe(true);
    expect(body.readiness.note).toContain("cannot cite");
  });

  it("401s without a session", async () => {
    getAuthUser.mockResolvedValue(null);
    expect((await getSurface()).status).toBe(401);
  });
});
