// SPDX-License-Identifier: MIT
/**
 * Endpoint tests for the three `/api/queue*` lenses — the routes four live
 * components had been calling into the void.
 *
 * The defect these describe: `today-brief.tsx`, `today-forgotten.tsx`,
 * `today-related.tsx` and `useVoiceQueue.ts` all fetched `/api/queue*`, no route
 * existed, and every caller rendered `null` on failure — so three of Today's
 * eight blocks were silently missing in production and nothing said so. A test
 * that only asserted "a route file exists" would not have caught the part that
 * mattered, so these assert what each caller actually depends on:
 *
 *   - the exact response shape (`{ items: [{ id, url, title, host, reason? }] }`)
 *     the components destructure, including `title` never being a raw URL;
 *   - the unauthorized path (the edge middleware only checks the cookie is
 *     PRESENT, so the handler is where the session is really validated);
 *   - a missing relation degrading to a typed 503, NOT an empty 200 — "you have
 *     nothing waiting" and "this surface cannot read its data" are different
 *     statements, and every one of the consumers renders them identically;
 *   - an unexpected failure being a typed 500 with a log line, never a silent
 *     empty list.
 *
 * The database and auth are faked at the module boundary (`testing.md` →
 * "Mocking"): what is under test is the route's mapping, not Postgres's.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAuthUser, logEvent, getUserWorkspaces, selectQueue, executeQueue, failNextSelect } =
  vi.hoisted(() => ({
    getAuthUser: vi.fn(),
    logEvent: vi.fn(),
    getUserWorkspaces: vi.fn(),
    selectQueue: [] as unknown[],
    executeQueue: [] as unknown[],
    /** When set, the next `db.select(...)` throws it instead of returning a builder. */
    failNextSelect: { error: null as unknown },
  }));

vi.mock("@/lib/auth/server", () => ({ getAuthUser }));
vi.mock("@/lib/logger", () => ({ logEvent }));
vi.mock("@/lib/workspace", () => ({ getUserWorkspaces }));

/**
 * Chainable drizzle stand-in. Awaiting the builder resolves the NEXT queued
 * value, so a test queues one result per query the route makes, in order.
 * `db.execute` (raw SQL — the related lens) has its own queue.
 *
 * Failure injection goes through `failNextSelect` rather than queuing a
 * rejected promise: a rejection parked in the queue is only awaited if the
 * builder is awaited, and an unawaited one surfaces as an unhandled rejection
 * that fails the suite for the wrong reason.
 */
vi.mock("@/lib/db", () => {
  const makeBuilder = (queue: unknown[]) => {
    const builder: Record<string, unknown> = {};
    const passthrough = () => builder;
    for (const method of [
      "from",
      "where",
      "limit",
      "orderBy",
      "groupBy",
      "leftJoin",
      "innerJoin",
      "returning",
      "values",
      "set",
    ]) {
      builder[method] = vi.fn(passthrough);
    }
    builder.then = (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(queue.shift() ?? []).then(onFulfilled, onRejected);
    return builder;
  };
  return {
    db: {
      select: vi.fn(() => {
        if (failNextSelect.error) {
          const err = failNextSelect.error;
          failNextSelect.error = null;
          throw err;
        }
        // A queued Error means "this query fails"; it is raised inside the
        // await path so the route's try/catch sees it.
        const next = selectQueue.length > 0 && selectQueue[0] instanceof Error ? selectQueue.shift() : undefined;
        if (next instanceof Error) {
          const builder = makeBuilder([]);
          builder.then = (_f?: unknown, rej?: (e: unknown) => unknown) =>
            Promise.reject(next).then(undefined, rej);
          return builder;
        }
        return makeBuilder(selectQueue);
      }),
      execute: vi.fn(() => {
        const next = executeQueue.shift() ?? [];
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
      }),
      insert: vi.fn(() => makeBuilder(selectQueue)),
      update: vi.fn(() => makeBuilder(selectQueue)),
    },
    schema: new Proxy({}, { get: (_t, prop) => ({ __table: String(prop) }) }),
  };
});

import { GET as getQueue } from "@/app/api/queue/route";
import { GET as getForgotten } from "@/app/api/queue/forgotten/route";
import { GET as getRelated } from "@/app/api/queue/related/route";

const USER = { id: "user-1" };

/** A capture row as the brief loader selects it. */
function briefRow(over: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    url: "https://example.com/a-post",
    ogTitle: "A saved post",
    derivedTitle: null,
    urlHost: "example.com",
    summary: "A short summary.",
    bookmarkedAt: new Date("2026-09-25T12:00:00Z"),
    createdAt: new Date("2026-09-26T12:00:00Z"),
    readMinutes: 6,
    watchMinutes: null,
    ...over,
  };
}

function call(handler: (r: Request) => Promise<Response>, path: string) {
  return handler(new Request(`http://localhost${path}`, { method: "GET" }));
}

/** A Postgres undefined_table error, wrapped the way drizzle wraps driver errors. */
function missingRelation(relation: string) {
  const driver = Object.assign(new Error(`relation "${relation}" does not exist`), {
    code: "42P01",
  });
  return Object.assign(new Error("Failed query"), { cause: driver });
}

beforeEach(() => {
  selectQueue.length = 0;
  executeQueue.length = 0;
  failNextSelect.error = null;
  getAuthUser.mockReset();
  getAuthUser.mockResolvedValue(USER);
  getUserWorkspaces.mockReset();
  getUserWorkspaces.mockResolvedValue([{ id: "ws-1", name: "Personal" }]);
  logEvent.mockReset();
});

describe("GET /api/queue — the daily brief", () => {
  it("returns the exact shape the brief and voice reader destructure", async () => {
    selectQueue.push([briefRow()]);

    const response = await call(getQueue, "/api/queue?n=5");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: Array<Record<string, unknown>> };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items).toHaveLength(1);
    const item = body.items[0];
    // Exactly the fields the consumers read — the brief renders reason, the
    // voice reader speaks summary, both link on url/id.
    expect(Object.keys(item).sort()).toEqual(["host", "id", "reason", "summary", "title", "url"]);
    expect(item.id).toBe("11111111-1111-4111-8111-111111111111");
    expect(item.url).toBe("https://example.com/a-post");
    expect(item.title).toBe("A saved post");
    expect(item.host).toBe("example.com");
    expect(typeof item.reason).toBe("string");
  });

  it("never leaks a raw URL into title", async () => {
    // displayTitle's hard rule: a card must never read as `https://…`.
    selectQueue.push([briefRow({ ogTitle: "https://example.com/raw-url" })]);

    const body = (await (await call(getQueue, "/api/queue?n=5")).json()) as {
      items: Array<{ title: string }>;
    };

    expect(body.items[0].title).not.toMatch(/^https?:\/\//);
  });

  it("bounds an oversized n instead of trusting it", async () => {
    selectQueue.push([]);
    await expect(call(getQueue, "/api/queue?n=10000")).resolves.toBeInstanceOf(Response);

    // The clamp happens before the query is built, so the emitted SQL carries a
    // bounded LIMIT. Assert it through the logged start event + a successful
    // response rather than by reaching into drizzle internals.
    expect(logEvent).toHaveBeenCalledWith(
      "route.start",
      expect.objectContaining({ route: "/api/queue", n: 50 }),
    );
  });

  it("401s without a session, and never reads", async () => {
    getAuthUser.mockResolvedValue(null);

    const response = await call(getQueue, "/api/queue?n=5");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(getUserWorkspaces).not.toHaveBeenCalled();
  });

  it("returns an empty list — not an error — for a caller with no workspace", async () => {
    getUserWorkspaces.mockResolvedValue([]);

    const response = await call(getQueue, "/api/queue?n=5");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [], degraded: false });
  });

  it("degrades a missing relation to a typed 503, never an empty 200", async () => {
    // A blank block and a 200 with no items are indistinguishable to every one
    // of the consumers; both read as "nothing to show", which would be a lie.
    selectQueue.push(missingRelation("nexalog.capture_sources"));

    const response = await call(getQueue, "/api/queue?n=5");

    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string; code: string };
    expect(body.error).toBe("surface_unavailable");
    expect(body.code).toBe("missing_relation");
  });

  it("500s with a typed body and a log line on an unexpected failure", async () => {
    selectQueue.push(new Error("connection reset"));

    const response = await call(getQueue, "/api/queue?n=5");

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "queue_failed" });
    expect(logEvent).toHaveBeenCalledWith(
      "queue.brief.failed",
      expect.objectContaining({ error: "connection reset" }),
    );
  });
});

describe("GET /api/queue/forgotten", () => {
  it("returns the pinned item shape with a reason", async () => {
    selectQueue.push([
      {
        id: "22222222-2222-4222-8222-222222222222",
        url: "https://example.com/old",
        ogTitle: "Something old",
        derivedTitle: null,
        urlHost: "example.com",
        summary: null,
        openedAt: null,
        bookmarkedAt: new Date("2026-01-01T00:00:00Z"),
        createdAt: new Date("2026-01-02T00:00:00Z"),
      },
    ]);

    const response = await call(getForgotten, "/api/queue/forgotten?n=3");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe("22222222-2222-4222-8222-222222222222");
    expect(body.items[0].reason).toContain("never opened");
  });

  it("401s without a session", async () => {
    getAuthUser.mockResolvedValue(null);
    const response = await call(getForgotten, "/api/queue/forgotten?n=3");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("does not leak a raw URL into title", async () => {
    selectQueue.push([
      {
        id: "22222222-2222-4222-8222-222222222222",
        url: "https://example.com/old-page",
        ogTitle: null,
        derivedTitle: null,
        urlHost: "example.com",
        summary: null,
        openedAt: null,
        bookmarkedAt: new Date("2026-01-01T00:00:00Z"),
        createdAt: new Date("2026-01-02T00:00:00Z"),
      },
    ]);

    const body = (await (await call(getForgotten, "/api/queue/forgotten?n=3")).json()) as {
      items: Array<{ title: string }>;
    };

    expect(body.items[0].title).not.toMatch(/^https?:\/\//);
    expect(body.items[0].title.length).toBeGreaterThan(0);
  });

  it("500s with a typed body on an unexpected failure", async () => {
    selectQueue.push(new Error("boom"));

    const response = await call(getForgotten, "/api/queue/forgotten?n=3");

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "queue_failed" });
    expect(logEvent).toHaveBeenCalledWith(
      "queue.forgotten.failed",
      expect.objectContaining({ error: "boom" }),
    );
  });
});

describe("GET /api/queue/related", () => {
  it("401s without a session", async () => {
    getAuthUser.mockResolvedValue(null);
    const response = await call(getRelated, "/api/queue/related?n=3");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("answers an honest empty lens when no note was edited recently", async () => {
    // No seeds ⇒ no centroid ⇒ no "related to what?". An empty lens with a
    // reason beats inventing a seed or reporting a failure.
    selectQueue.push([]);

    const response = await call(getRelated, "/api/queue/related?n=3");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: unknown[]; note?: string };
    expect(body.items).toEqual([]);
    expect(body.note).toMatch(/No notes were edited in the last 24 hours/);
  });

  it("ranks neighbours and states the similarity as the reason", async () => {
    // One seed note with a 3-dim embedding, then one neighbour capture.
    selectQueue.push([{ embedding: "[1,0,0]" }]);
    executeQueue.push([
      {
        id: "33333333-3333-4333-8333-333333333333",
        url: "https://example.com/neighbour",
        og_title: "A neighbour",
        derived_title: null,
        url_host: "example.com",
        summary: null,
        dist: 0.2,
      },
    ]);

    const response = await call(getRelated, "/api/queue/related?n=3");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: Array<{ id: string; title: string; reason: string }>;
      note?: string;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].title).toBe("A neighbour");
    expect(body.items[0].reason).toBe("similar · 0.80");
    expect(body.note).toMatch(/1 note edited in the last 24h/);
  });

  it("reports an unusable centroid as an honest empty, not a 500", async () => {
    // Seeds exist but cancel toward the origin: normalizing that would rank
    // arbitrary rows as related, so the lens refuses and says why.
    selectQueue.push([{ embedding: "[1,0,0]" }, { embedding: "[-1,0,0]" }]);

    const response = await call(getRelated, "/api/queue/related?n=3");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: unknown[]; note?: string };
    expect(body.items).toEqual([]);
    expect(body.note).toMatch(/no usable embedding centroid/);
  });

  it("500s with a typed body on an unexpected failure", async () => {
    selectQueue.push(new Error("vector exploded"));

    const response = await call(getRelated, "/api/queue/related?n=3");

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "queue_failed" });
    expect(logEvent).toHaveBeenCalledWith(
      "queue.related.failed",
      expect.objectContaining({ error: "vector exploded" }),
    );
  });
});
