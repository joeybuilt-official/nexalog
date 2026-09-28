// SPDX-License-Identifier: MIT
/**
 * Route-level tests for the Projects reference edges — `/api/projects/[id]/items`.
 *
 * The nesting rules (one parent per project, at most two levels) are POLICY, not
 * schema: a CHECK constraint cannot see another row, so nothing in Postgres stops
 * a bad edge. That makes the write path the only thing holding the rule up, and
 * these tests are what pin it — through the real route, the real store and the
 * real domain guard, with only `@/lib/db` faked (no Postgres runs here).
 *
 * Three things are asserted that a pure-domain test cannot cover:
 *   1. a refused nesting is a 400 `invalid_nesting` carrying the machine-readable
 *      `code` — the client branches on the code, never on the message;
 *   2. NOTHING is written when the guard refuses (no insert reaches the database);
 *   3. ownership is checked BEFORE the nesting guard — a target from another
 *      workspace is `item_not_found` with no structural query issued, so the
 *      response cannot be used to probe a project the caller cannot see.
 *
 * Lives under `app/api/__tests__/` beside the other route tests: a test under
 * `lib/` may not import `app/` (blocking `web-lib-no-ui` in `.dependency-cruiser.cjs`).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAuthUser, selectResults, queryMock, insertMock } = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  selectResults: [] as unknown[][],
  queryMock: vi.fn(),
  insertMock: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({ getAuthUser }));

/**
 * Chainable stand-in for drizzle's builder. Each `db.select(...)` / `db.insert(...)`
 * consumes the next queued result, so a test states the rows the queries see in
 * the order the store issues them. An exhausted queue yields `[]`.
 */
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
  ) => Promise.resolve(selectResults.shift() ?? []).then(onFulfilled, onRejected);
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
    update: () => chain(),
    delete: () => chain(),
  },
  schema: new Proxy({}, { get: (_t, prop) => ({ __table: String(prop) }) }),
}));

vi.mock("@/lib/workspace", () => ({
  getUserWorkspaces: vi.fn(async () => [{ id: "ws-1", userId: "user-1" }]),
  ensurePersonalWorkspace: vi.fn(async () => ({ id: "ws-1" })),
}));

import { POST, DELETE } from "@/app/api/projects/[id]/items/route";

// Ids are shape-valid RFC-4122 values on purpose: the route validates `id` with
// zod's `.uuid()`, which since zod 4 also checks the version/variant nibbles, so a
// hand-typed `1111-1111-1111-…` is a 400 before any of this logic runs.
const user = { id: "user-1" };
const params = { params: Promise.resolve({ id: "22222222-2222-4222-8222-222222222222" }) };

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/projects/22222222-2222-4222-8222-222222222222/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params,
  );
}

function del(body: unknown) {
  return DELETE(
    new Request("http://localhost/api/projects/22222222-2222-4222-8222-222222222222/items", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params,
  );
}

/** The rows the store reads for a legal sub-project add, in issue order. */
function legalNestingRows() {
  return [
    [{ id: "22222222-2222-4222-8222-222222222222" }],   // the parent project, workspace-scoped
    [{ id: "33333333-3333-4333-8333-333333333333" }],   // the child project is owned (filterOwnedRefs)
    [],                   // child has no parent
    [{ count: 0 }],       // child has no sub-projects
    [],                   // the prospective parent is a root
    [{ id: "pi-1" }],     // the inserted edge
  ];
}

beforeEach(() => {
  getAuthUser.mockReset();
  getAuthUser.mockResolvedValue(user);
  queryMock.mockReset();
  insertMock.mockReset();
  selectResults.length = 0;
});

describe("POST /api/projects/[id]/items", () => {
  it("401 when there is no session — auth is checked first", async () => {
    getAuthUser.mockResolvedValue(null);

    const res = await post({ kind: "note", id: "11111111-1111-4111-8111-111111111111" });

    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("400 on an unknown kind (the domain's ITEM_KINDS is the gate)", async () => {
    const res = await post({ kind: "idea", id: "11111111-1111-4111-8111-111111111111" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_item_kind" });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("400 on a malformed body before any query runs", async () => {
    const res = await post({ kind: "note" });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("invalid_body");
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("201 nests a root project under a root project", async () => {
    selectResults.push(...legalNestingRows());

    const res = await post({ kind: "project", id: "33333333-3333-4333-8333-333333333333" });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      ok: true,
      kind: "project",
      id: "33333333-3333-4333-8333-333333333333",
      alreadyPresent: false,
    });
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("400 invalid_nesting / already_has_parent — one parent per project", async () => {
    selectResults.push(
      [{ id: "22222222-2222-4222-8222-222222222222" }],
      [{ id: "33333333-3333-4333-8333-333333333333" }],
      [{ itemId: "someone-else" }], // the child already has a parent
    );

    const res = await post({ kind: "project", id: "33333333-3333-4333-8333-333333333333" });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code: string; message: string };
    expect(body.error).toBe("invalid_nesting");
    expect(body.code).toBe("already_has_parent");
    expect(body.message.length).toBeGreaterThan(0);

    // Nothing was written: a refusal must not leave a second parent edge behind.
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("400 invalid_nesting / child_is_parent — two levels deep, never three", async () => {
    selectResults.push(
      [{ id: "22222222-2222-4222-8222-222222222222" }],
      [{ id: "33333333-3333-4333-8333-333333333333" }],
      [],                    // the child is a root …
      [{ count: 3 }],        // … but it already has sub-projects of its own
    );

    const res = await post({ kind: "project", id: "33333333-3333-4333-8333-333333333333" });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe("child_is_parent");
    expect(body.message).toContain("2 levels deep");
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("400 invalid_nesting / parent_is_child — a sub-project cannot be a parent", async () => {
    selectResults.push(
      [{ id: "22222222-2222-4222-8222-222222222222" }],
      [{ id: "33333333-3333-4333-8333-333333333333" }],
      [],                    // the child is a root …
      [{ count: 0 }],        // … and has no children of its own …
      [{ itemId: "grand" }], // … but the target parent is itself nested
    );

    const res = await post({ kind: "project", id: "33333333-3333-4333-8333-333333333333" });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("parent_is_child");
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("404 item_not_found for a target outside the caller's workspaces, and issues NO structural query about it", async () => {
    selectResults.push(
      [{ id: "22222222-2222-4222-8222-222222222222" }], // the project is the caller's
      [],                 // the referenced project is not (filterOwnedRefs)
    );

    const res = await post({ kind: "project", id: "44444444-4444-4444-8444-444444444444" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "item_not_found" });
    expect(insertMock).not.toHaveBeenCalled();

    // Ownership ran FIRST: exactly two reads (the project, the target's
    // ownership) — none of the nesting probes. Otherwise a refusal like
    // `already_has_parent` would tell the caller the shape of a project they
    // cannot see.
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it("404 project_not_found when the project is not the caller's", async () => {
    selectResults.push([]); // the workspace-scoped project read finds nothing

    const res = await post({ kind: "note", id: "11111111-1111-4111-8111-111111111111" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "project_not_found" });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("a note reference skips the nesting guard entirely (two reads, then the insert)", async () => {
    selectResults.push(
      [{ id: "22222222-2222-4222-8222-222222222222" }],
      [{ id: "11111111-1111-4111-8111-111111111111" }],
      [{ id: "pi-9" }],
    );

    const res = await post({ kind: "note", id: "11111111-1111-4111-8111-111111111111" });

    expect(res.status).toBe(201);
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("is idempotent from the caller's point of view: an edge that already exists is a 200", async () => {
    selectResults.push(
      [{ id: "22222222-2222-4222-8222-222222222222" }],
      [{ id: "11111111-1111-4111-8111-111111111111" }],
      [], // onConflictDoNothing wrote nothing
    );

    const res = await post({ kind: "note", id: "11111111-1111-4111-8111-111111111111" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      kind: "note",
      id: "11111111-1111-4111-8111-111111111111",
      alreadyPresent: true,
    });
  });
});

describe("DELETE /api/projects/[id]/items", () => {
  it("detaches a reference and never touches the target", async () => {
    selectResults.push([{ id: "22222222-2222-4222-8222-222222222222" }]);

    const res = await del({ kind: "project", id: "33333333-3333-4333-8333-333333333333" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, kind: "project", id: "33333333-3333-4333-8333-333333333333" });
    // A delete on project_items only — no update/delete reaches `projects`.
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("404 when the project is not the caller's", async () => {
    selectResults.push([]);

    const res = await del({ kind: "note", id: "11111111-1111-4111-8111-111111111111" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("400 on an unknown kind", async () => {
    const res = await del({ kind: "idea", id: "11111111-1111-4111-8111-111111111111" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_item_kind" });
  });
});