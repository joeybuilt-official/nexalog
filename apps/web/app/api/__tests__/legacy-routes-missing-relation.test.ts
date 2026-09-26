// SPDX-License-Identifier: MIT
/**
 * Regression tests for the missing-relation stopgap on the carried-over v1
 * routes (`/api/sync`, `/api/sync/mutations`, `/api/notes`, `/api/bookmarks`,
 * `/api/journal`).
 *
 * The production failure: those routes query the v1 content model through
 * `{ db }` from `@/lib/db`, and the deployed database does not carry those
 * tables, so Postgres raises `42P01` and the routes 500 (mobile offline sync
 * fails for every user, every poll). These tests pin the honest replacement —
 * a 503 `surface_unavailable` body — and pin the things it must NOT become:
 *
 *   - it must not be an empty 200 (that tells the client "nothing changed",
 *     advancing its cursor past rows it never received);
 *   - it must not leak the relation name / SQL to the caller;
 *   - it must not swallow unrelated failures (those keep their 500).
 *
 * `@/lib/db` is mocked, so no Postgres runs here; the error objects are the
 * real shapes the driver produces (drizzle wraps the driver error, the driver
 * error carries `code`). The driver-level matching itself is covered directly
 * in `lib/__tests__/surface-unavailable.test.ts`.
 *
 * Lives here, not under `lib/__tests__/`, because a test under `lib/` may not
 * import `app/` — that is a blocking `web-lib-no-ui` violation in
 * `.dependency-cruiser.cjs`. Same reason the review-route test is colocated.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAuthUser, logEvent, queryMock, insertMock, updateMock } = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  logEvent: vi.fn(),
  queryMock: vi.fn(),
  insertMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({ getAuthUser }));
vi.mock("@/lib/logger", () => ({ logEvent }));

/**
 * Chainable stand-in for drizzle's builder. Every terminal operation rejects
 * with `nextError`, so a route that touches the database in any order hits the
 * missing-relation failure.
 */
let nextError: unknown = null;

function chain(): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  const passthrough = () => builder;
  for (const method of [
    "select", "from", "where", "limit", "orderBy", "groupBy",
    "leftJoin", "innerJoin", "returning", "values", "set",
    "onConflictDoNothing",
  ]) {
    builder[method] = vi.fn(passthrough);
  }
  builder.then = (
    onFulfilled?: (v: unknown) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) => Promise.reject(nextError).then(onFulfilled, onRejected);
  return builder;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => {
      queryMock(...args);
      return chain();
    },
    insert: (...args: unknown[]) => {
      insertMock(...args);
      return chain();
    },
    update: (...args: unknown[]) => {
      updateMock(...args);
      return chain();
    },
  },
  schema: new Proxy({}, { get: (_t, prop) => ({ __table: String(prop) }) }),
}));

vi.mock("@/lib/workspace", () => ({
  getUserWorkspaces: vi.fn(async () => [{ id: "ws-1", userId: "user-1" }]),
  ensurePersonalWorkspace: vi.fn(async () => ({ id: "ws-1" })),
}));
vi.mock("@/lib/notes/wikilinks", () => ({ persistWikilinks: vi.fn(async () => null) }));
vi.mock("@/lib/time/user-tz", () => ({
  userTodayStr: vi.fn(async () => "2026-09-26"),
  getUserTimezone: vi.fn(async () => "UTC"),
}));

import { GET as syncGet } from "@/app/api/sync/route";
import { POST as mutationsPost } from "@/app/api/sync/mutations/route";
import { POST as notesPost } from "@/app/api/notes/route";
import { GET as bookmarksGet } from "@/app/api/bookmarks/route";
import { GET as journalGet, POST as journalPost } from "@/app/api/journal/route";

const USER = { id: "user-1" };

/** The real shape: drizzle `DrizzleQueryError` wrapping the driver's error. */
function missingRelationError(relation = "nexalog.notes") {
  const driverError = Object.assign(
    new Error(`relation "${relation}" does not exist`),
    { code: "42P01", severity: "ERROR", name: "PostgresError" },
  );
  return Object.assign(new Error(`Failed query: select ...`), {
    name: "DrizzleQueryError",
    cause: driverError,
  });
}

type Case = { name: string; call: () => Promise<Response> };

const cases: Case[] = [
  {
    name: "GET /api/sync",
    call: () => syncGet(new Request("http://localhost/api/sync?since=0")),
  },
  {
    name: "POST /api/sync/mutations",
    call: () =>
      mutationsPost(
        new Request("http://localhost/api/sync/mutations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ops: [{ opId: "op-1", entity: "notes", op: "create", payload: {} }],
          }),
        }),
      ),
  },
  {
    name: "POST /api/notes",
    call: () =>
      notesPost(
        new Request("http://localhost/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "t", content: "c" }),
        }),
      ),
  },
  {
    name: "GET /api/bookmarks",
    call: () => bookmarksGet(new Request("http://localhost/api/bookmarks")),
  },
  {
    name: "GET /api/journal",
    call: () => journalGet(new Request("http://localhost/api/journal")),
  },
  {
    name: "POST /api/journal",
    call: () =>
      journalPost(
        new Request("http://localhost/api/journal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: "hello" }),
        }),
      ),
  },
];

beforeEach(() => {
  getAuthUser.mockReset();
  getAuthUser.mockResolvedValue(USER);
  logEvent.mockReset();
  queryMock.mockReset();
  insertMock.mockReset();
  updateMock.mockReset();
  nextError = missingRelationError();
});

describe("v1 routes degrade honestly on a missing relation", () => {
  // One test per route: this is the assertion that fails if the handling is
  // ever removed, because the route would then throw out of the handler.
  for (const { name, call } of cases) {
    it(`${name}: 503 surface_unavailable, never an empty 200`, async () => {
      const response = await call();

      expect(response.status).toBe(503);
      const body = (await response.json()) as Record<string, unknown>;

      expect(body).toMatchObject({
        error: "surface_unavailable",
        code: "missing_relation",
        surface: name,
      });
      expect(typeof body.message).toBe("string");
      expect((body.message as string).length).toBeGreaterThan(0);

      // The trap this stopgap exists to avoid: reporting success for a surface
      // whose data lives somewhere else. An empty 200 would advance the mobile
      // client's sync cursor past rows it never received.
      expect(response.status).not.toBe(200);
      expect(body).not.toHaveProperty("changes");
      expect(body).not.toHaveProperty("results");
      expect(body).not.toHaveProperty("bookmarks");
      expect(body).not.toHaveProperty("entries");

      // No internal schema detail in the response, ever.
      expect(JSON.stringify(body)).not.toContain("nexalog.notes");
      expect(JSON.stringify(body)).not.toContain("42P01");
      expect(JSON.stringify(body)).not.toContain("select ");

      // …but it IS logged with the relation, so the operator can see why.
      expect(logEvent).toHaveBeenCalledWith(
        "api.surface_unavailable",
        expect.objectContaining({ surface: name, reason: "missing_relation", relation: "nexalog.notes" }),
      );
    });
  }

  it("POST /api/sync/mutations does NOT report the op as rejected", async () => {
    // The pre-stopgap behaviour for this route was a 200 whose ops all came
    // back `rejected`. The shipped Flutter client treats `rejected` as
    // terminal and parks the op as a conflict, so the user's queued write
    // would be dropped for good. A 503 is retried instead.
    const response = await mutationsPost(
      new Request("http://localhost/api/sync/mutations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ops: [{ opId: "op-1", entity: "notes", op: "create", payload: {} }],
        }),
      }),
    );

    expect(response.status).toBe(503);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("results");
  });

  it("unrelated failures still fail loudly (the stopgap does not swallow them)", async () => {
    nextError = new Error("disk on fire");

    // Escapes the handler: Next turns a thrown error into a 500 and the cause is
    // logged with a stack trace — it is NOT mislabelled as a configuration gap.
    await expect(
      syncGet(new Request("http://localhost/api/sync?since=0")),
    ).rejects.toThrow("disk on fire");
    expect(logEvent).not.toHaveBeenCalledWith("api.surface_unavailable", expect.anything());
  });

  it("a NON-42P01 database error is not reported as surface_unavailable", async () => {
    // Same route, different failure: a connection error must not be laundered
    // into "surface unavailable" — that would hide an outage as a config gap.
    nextError = Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });

    await expect(
      syncGet(new Request("http://localhost/api/sync?since=0")),
    ).rejects.toThrow("connection refused");
    expect(logEvent).not.toHaveBeenCalledWith("api.surface_unavailable", expect.anything());
  });

  it("401 still wins over the stopgap (auth is checked first)", async () => {
    getAuthUser.mockResolvedValue(null);

    const response = await syncGet(new Request("http://localhost/api/sync?since=0"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(queryMock).not.toHaveBeenCalled();
  });
});
