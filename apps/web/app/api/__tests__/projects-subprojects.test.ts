// SPDX-License-Identifier: MIT
/**
 * Route-level tests for the SUB-PROJECT write paths — creating a project with a
 * parent (`POST /api/projects`) and moving one (`PATCH /api/projects/[id]` with
 * `parentId`).
 *
 * The nesting rules are POLICY, not schema: a CHECK constraint cannot see another
 * row, so nothing in Postgres stops a project from becoming its own ancestor.
 * That makes these two routes the only thing holding the tree up, and this file is
 * what pins them — through the real route, the real store and the real domain
 * guard, with only `@/lib/db` faked (no Postgres runs here).
 *
 * What a pure-domain test cannot cover, and what is asserted here:
 *   1. a refusal is a 400 `invalid_nesting` carrying the machine-readable `code`;
 *   2. NOTHING is written when the guard refuses — no project row, no parent
 *      edge, and for a move no DELETE either (the failure mode that would corrupt
 *      the tree is a half-applied move, so "nothing ran" is the assertion);
 *   3. a move REPLACES the edge (delete then insert) rather than adding a second
 *      one — R1 is a policy, and two `project_items` rows naming the same child
 *      is exactly what no constraint here can prevent;
 *   4. a create-with-parent writes BOTH rows, and `POST` with no parent writes
 *      only the project (the flat-create behaviour every existing caller has);
 *   5. an absent `parentId` on PATCH leaves the parent alone — the three states
 *      (uuid / null / absent) are distinct requests.
 *
 * Lives under `app/api/__tests__/` beside the other route tests: a test under
 * `lib/` may not import `app/` (`web-lib-no-ui` in `.dependency-cruiser.cjs` is an
 * ERROR, and it overrides the prose rule that puts route tests under `lib/`).
 *
 * The db harness differs from its sibling `projects-items-nesting.test.ts` on one
 * point, deliberately: there, every awaited builder consumes from ONE queue, so
 * adding a query silently shifts every later assertion. Here reads, writes and
 * deletes consume from separate queues and the writes are CAPTURED, because this
 * file's central claims are about which writes did and did not run.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAuthUser, readQueue, writeQueue, insertCalls, deleteCalls, transactionCalls } = vi.hoisted(
  () => ({
    getAuthUser: vi.fn(),
    readQueue: [] as unknown[][],
    writeQueue: [] as unknown[][],
    insertCalls: [] as Array<{ table: string; values: Record<string, unknown> }>,
    deleteCalls: [] as Array<{ table: string }>,
    transactionCalls: { count: 0 },
  }),
);

vi.mock("@/lib/auth/server", () => ({ getAuthUser }));

/** The table name behind the mocked schema (`{ __table: "<name>" }`). */
function tableName(table: unknown): string {
  return (table as { __table?: string }).__table ?? "unknown";
}

const CHAIN_METHODS = [
  "select",
  "from",
  "where",
  "limit",
  "orderBy",
  "groupBy",
  "leftJoin",
  "innerJoin",
  "returning",
  "set",
  "onConflictDoNothing",
  "values",
  "delete",
];

/**
 * Chainable stand-in for drizzle's builder.
 *
 * Three queue kinds, deliberately SEPARATE, because a write that consumed a read
 * queue entry would shift every later read by one and the assertions would still
 * pass while reading the wrong row (the "sequentially-consumed mocks go stale"
 * failure mode in `.claude/rules/testing.md`):
 *
 *   - `read`  — a `select` chain; consumes the next queued read result;
 *   - `write` — an `insert`/`update` chain; consumes the next queued write result;
 *   - `void`  — a `delete` chain; consumes NOTHING. A DELETE has no RETURNING here,
 *               so nothing awaits a value, and letting it take a read slot is
 *               exactly how the read-back below ends up reading an empty queue.
 *
 * `values(...)` and the table of an `insert`/`delete` are RECORDED, because those
 * ARE the effect under test — an assertion like "the parent edge names the child"
 * has to read the captured values, not the mock's return.
 */
function chain(kind: "read" | "write" | "void"): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  const passthrough = () => builder;
  for (const method of CHAIN_METHODS) builder[method] = vi.fn(passthrough);

  builder.then = (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
    const result =
      kind === "read" ? (readQueue.shift() ?? []) : kind === "write" ? (writeQueue.shift() ?? []) : [];
    return Promise.resolve(result).then(onFulfilled, onRejected);
  };

  return builder;
}

vi.mock("@/lib/db", () => {
  const insert = (table: unknown) => {
    const builder = chain("write");
    builder.values = vi.fn((values: Record<string, unknown>) => {
      insertCalls.push({ table: tableName(table), values });
      return builder;
    });
    return builder;
  };
  const remove = (table: unknown) => {
    deleteCalls.push({ table: tableName(table) });
    return chain("void");
  };

  const db: Record<string, unknown> = {
    select: () => chain("read"),
    insert,
    update: () => chain("write"),
    delete: remove,
    // One transaction = one callback run. The `tx` handed in carries the same
    // captured fakes, which is what lets a test assert that a move's DELETE and
    // INSERT both happened inside it.
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      transactionCalls.count += 1;
      return fn(db);
    },
  };

  return {
    db,
    schema: new Proxy({}, { get: (_t, prop) => ({ __table: String(prop) }) }),
  };
});

vi.mock("@/lib/workspace", () => ({
  getUserWorkspaces: vi.fn(async () => [{ id: WS_ID, userId: "user-1" }]),
  ensurePersonalWorkspace: vi.fn(async () => ({ id: WS_ID })),
}));

import { POST } from "@/app/api/projects/route";
import { PATCH } from "@/app/api/projects/[id]/route";

// Ids are shape-valid RFC-4122 values on purpose: both routes validate ids with
// zod's `.uuid()`, which since zod 4 also checks the version/variant nibbles.
const USER = { id: "user-1" };
/** The caller's only workspace. A real uuid, because the route validates an
 *  explicit `workspaceId` with zod and a hand-typed id would be a 400 before any
 *  of the parent logic runs. */
const WS_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const PARENT_ID = "33333333-3333-4333-8333-333333333333";
const GRANDPARENT_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_ID = "55555555-5555-4555-8555-555555555555";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function patch(body: unknown, id = PROJECT_ID) {
  return PATCH(
    new Request(`http://localhost/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

/** A `projects` row as the store's `getProjectRow` reads it. */
function projectRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: PROJECT_ID,
    workspaceId: WS_ID,
    userId: "user-1",
    name: "10 Ton",
    description: null,
    lifecycleState: "active",
    livingDoc: "",
    livingDocUpdatedAt: null,
    plexoSessionId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
    ...over,
  };
}

/** `getProjectParentId` — the edge naming this project as a child. */
const edge = (itemId: string) => [{ itemId }];
const noEdge: unknown[] = [];
/** `countSubProjects`. */
const subCount = (n: number) => [{ count: n }];

/**
 * The exact read sequence the store's `getProject` issues for one project, so a
 * write test can let the REAL read-back run instead of stubbing it (which would
 * make the assertion about the stub). Order is the store's own:
 *   1. the project row, 2. its grouped units, 3. its sub-projects, 4. its parent
 *   edge, 5. the parent row (only when it HAS a parent), 6-7. the two counts.
 */
function queueReadBack(parentId: string | null) {
  readQueue.push(
    [projectRow({ name: "Moved" })], // 1 — getProjectRow
    [], //                              2 — hydrateGroupedUnits: no items
    [], //                              3 — getSubProjects: none
    parentId ? edge(parentId) : noEdge, // 4 — getProjectParentId
    parentId ? [projectRow({ id: parentId, name: "Parent" })] : noEdge, // 5 — parent row
    [], //                              6 — member count
    [], //                              7 — sub-project count
  );
}

beforeEach(() => {
  getAuthUser.mockReset();
  getAuthUser.mockResolvedValue(USER);
  readQueue.length = 0;
  writeQueue.length = 0;
  insertCalls.length = 0;
  deleteCalls.length = 0;
  transactionCalls.count = 0;
});

// ---- POST /api/projects — create, optionally as a sub-project --------------

describe("POST /api/projects (create with an optional parent)", () => {
  it("401 when there is no session — auth is checked first", async () => {
    getAuthUser.mockResolvedValue(null);

    const res = await post({ name: "Anything" });

    expect(res.status).toBe(401);
    expect(insertCalls).toHaveLength(0);
  });

  it("201 creates a ROOT when no parent is given — one row, no edge (the existing behaviour)", async () => {
    writeQueue.push([projectRow()]);

    const res = await post({ name: "10 Ton", workspaceId: WS_ID });

    expect(res.status).toBe(201);
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].table).toBe("projects");
    const body = (await res.json()) as { project: { parentId: string | null; name: string } };
    expect(body.project.parentId).toBeNull();
    expect(body.project.name).toBe("10 Ton");
  });

  it("treats an explicit `parentId: null` as a root too, and writes no edge", async () => {
    writeQueue.push([projectRow()]);

    const res = await post({ name: "10 Ton", parentId: null });

    expect(res.status).toBe(201);
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls.map((c) => c.table)).toEqual(["projects"]);
  });

  it("201 creates a SUB-PROJECT: the project row AND the parent edge, in that order", async () => {
    readQueue.push([projectRow({ id: PARENT_ID })], noEdge); // parent row, then its ancestry (a root)
    writeQueue.push([projectRow({ id: PROJECT_ID, name: "Frame Forge" })]); // the new project row

    const res = await post({ name: "Frame Forge", parentId: PARENT_ID });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { project: { id: string; parentId: string | null } };
    expect(body.project.parentId).toBe(PARENT_ID);

    // Two writes, and the edge names the PARENT as the container and the NEW
    // project as the child — the direction matters and is easy to invert.
    expect(insertCalls.map((c) => c.table)).toEqual(["projects", "projectItems"]);
    expect(insertCalls[1].values).toEqual({
      projectId: PARENT_ID,
      itemKind: "project",
      itemId: PROJECT_ID,
    });
  });

  it("400 invalid_nesting / parent_is_child — a sub-project cannot be a parent, and nothing is written", async () => {
    readQueue.push(
      [projectRow({ id: PARENT_ID })], // the parent is the caller's …
      edge(GRANDPARENT_ID), //           … but it is itself nested
      noEdge, //                         … two levels up: a root, so the walk stops
    );

    const res = await post({ name: "Too deep", parentId: PARENT_ID });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code: string; message: string };
    expect(body.error).toBe("invalid_nesting");
    expect(body.code).toBe("parent_is_child");
    expect(body.message).toContain("2 levels deep");

    // A refusal must leave NOTHING behind — not even the project row, which is
    // inserted after the guard precisely so this holds.
    expect(insertCalls).toHaveLength(0);
  });

  it("404 parent_not_found for a parent outside the caller's workspaces, with no writes", async () => {
    readQueue.push([]); // the parent row is not the caller's

    const res = await post({ name: "Orphan", parentId: OTHER_ID });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "parent_not_found" });
    expect(insertCalls).toHaveLength(0);
    // Ownership ran first: exactly ONE read, and none of the ancestry probes — so
    // the response cannot be used to learn the shape of a project the caller
    // cannot see.
    expect(readQueue.length).toBe(0);
  });

  it("400 invalid_body when parentId is not a uuid, before any query runs", async () => {
    const res = await post({ name: "Bad parent", parentId: "not-a-uuid" });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details: string[] };
    expect(body.error).toBe("invalid_body");
    expect(body.details).toContain("parentId");
    expect(insertCalls).toHaveLength(0);
  });
});

// ---- PATCH /api/projects/[id] — re-parent / promote ------------------------

describe("PATCH /api/projects/[id] with parentId (move / promote)", () => {
  it("401 when there is no session", async () => {
    getAuthUser.mockResolvedValue(null);

    const res = await patch({ parentId: PARENT_ID });

    expect(res.status).toBe(401);
    expect(transactionCalls.count).toBe(0);
  });

  it("200 moves a child under a different parent: the OLD edge is deleted and the NEW one inserted", async () => {
    readQueue.push(
      [projectRow({ name: "Learning Curve" })], // 1 the project being moved
      edge(OTHER_ID), //                           2 its current parent
      subCount(0), //                              3 it has no children of its own
      [projectRow({ id: PARENT_ID })], //          4 the new parent
      noEdge, //                                   5 the new parent is a root
    );
    queueReadBack(PARENT_ID);

    const res = await patch({ parentId: PARENT_ID });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { project: { parentId: string | null } };
    expect(body.project.parentId).toBe(PARENT_ID);

    // One transaction, one DELETE (the edge that named this project as a child),
    // one INSERT (the replacement). A MOVE, not an addition — a second edge would
    // be two parents, which no constraint here can prevent.
    expect(transactionCalls.count).toBe(1);
    expect(deleteCalls.map((c) => c.table)).toEqual(["projectItems"]);
    expect(insertCalls.map((c) => c.table)).toEqual(["projectItems"]);
    expect(insertCalls[0].values).toEqual({
      projectId: PARENT_ID,
      itemKind: "project",
      itemId: PROJECT_ID,
    });
  });

  it("200 PROMOTES to a top level with `parentId: null`: the edge is deleted and none is written", async () => {
    readQueue.push(
      [projectRow({ name: "Frame Forge" })], // 1 the project being promoted
      edge(PARENT_ID), //                       2 it is a child right now
      subCount(0), //                           3 no children of its own
    );
    queueReadBack(null);

    const res = await patch({ parentId: null });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { project: { parentId: string | null } };
    expect(body.project.parentId).toBeNull();

    expect(deleteCalls.map((c) => c.table)).toEqual(["projectItems"]);
    expect(insertCalls).toHaveLength(0);
  });

  it("200 is a no-op when the project is already under that parent — and touches the database not at all", async () => {
    readQueue.push(
      [projectRow()], // 1 the project
      edge(PARENT_ID), // 2 it is ALREADY under the requested parent
      subCount(0), //    3
    );
    queueReadBack(PARENT_ID);

    const res = await patch({ parentId: PARENT_ID });

    expect(res.status).toBe(200);
    // No transaction, so no delete-and-reinsert of an identical edge. The caller
    // asked for the state the project is already in; that is a success, not an
    // error and not a write.
    expect(transactionCalls.count).toBe(0);
    expect(deleteCalls).toHaveLength(0);
    expect(insertCalls).toHaveLength(0);
  });

  it("200 is a no-op promoting a project that is already a root", async () => {
    readQueue.push(
      [projectRow()], // 1
      noEdge, //         2 it has no parent
      subCount(0), //    3
    );
    queueReadBack(null);

    const res = await patch({ parentId: null });

    expect(res.status).toBe(200);
    expect(transactionCalls.count).toBe(0);
    expect(deleteCalls).toHaveLength(0);
    expect(insertCalls).toHaveLength(0);
  });

  it("400 invalid_nesting / self_nesting — a project cannot be its own parent", async () => {
    readQueue.push(
      [projectRow()], // 1 the project
      noEdge, //         2 it is a root
      subCount(0), //    3
      [projectRow()], // 4 the "parent" resolves to the same project
      noEdge, //         5 whose ancestry is empty
    );

    const res = await patch({ parentId: PROJECT_ID });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.error).toBe("invalid_nesting");
    expect(body.code).toBe("self_nesting");

    expect(transactionCalls.count).toBe(0);
    expect(deleteCalls).toHaveLength(0);
    expect(insertCalls).toHaveLength(0);
  });

  it("400 invalid_nesting / cycle — the DIRECT-child case (A is B's parent, move A under B)", async () => {
    readQueue.push(
      [projectRow({ id: PROJECT_ID, name: "A" })], // 1 the project being moved
      noEdge, //                                      2 it is a root today
      subCount(0), //                                 3
      [projectRow({ id: PARENT_ID, name: "B" })], //  4 the target parent
      edge(PROJECT_ID), //                            5 B's parent IS A
      noEdge, //                                      6 A is a root: the walk stops
    );

    const res = await patch({ parentId: PARENT_ID });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe("cycle");
    expect(body.message).toContain("own ancestor");
    expect(transactionCalls.count).toBe(0);
    expect(deleteCalls).toHaveLength(0);
    expect(insertCalls).toHaveLength(0);
  });

  it("400 invalid_nesting / cycle — the DEEPER chain (A → B → C, move A under C)", async () => {
    readQueue.push(
      [projectRow({ id: PROJECT_ID, name: "A" })], // 1 A
      noEdge, //                                      2 A is a root
      subCount(0), //                                 3
      [projectRow({ id: PARENT_ID, name: "C" })], //  4 C
      edge(OTHER_ID), //                              5 C's parent is B …
      edge(PROJECT_ID), //                            6 … B's parent is A — the project moving
      noEdge, //                                      7 A is a root: the walk stops
    );

    const res = await patch({ parentId: PARENT_ID });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("cycle");
    expect(transactionCalls.count).toBe(0);
    expect(deleteCalls).toHaveLength(0);
    expect(insertCalls).toHaveLength(0);
  });

  it("400 invalid_nesting / parent_is_child — cannot move under a project that is itself a sub-project", async () => {
    readQueue.push(
      [projectRow()], //                              1 the project
      noEdge, //                                       2 it is a root
      subCount(0), //                                  3
      [projectRow({ id: PARENT_ID })], //              4 the target parent
      edge(GRANDPARENT_ID), //                         5 which is itself nested
      noEdge, //                                       6 its own parent is a root
    );

    const res = await patch({ parentId: PARENT_ID });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("parent_is_child");
    expect(transactionCalls.count).toBe(0);
  });

  it("400 invalid_nesting / child_is_parent — a project with sub-projects cannot become one", async () => {
    readQueue.push(
      [projectRow()], //           1 the project
      noEdge, //                    2 it is a root
      subCount(2), //               3 it HAS sub-projects of its own
      [projectRow({ id: PARENT_ID })], // 4 the target parent
      noEdge, //                    5 a root
    );

    const res = await patch({ parentId: PARENT_ID });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("child_is_parent");
    expect(transactionCalls.count).toBe(0);
    expect(deleteCalls).toHaveLength(0);
    expect(insertCalls).toHaveLength(0);
  });

  it("404 parent_not_found for a parent outside the caller's workspaces, with no writes", async () => {
    readQueue.push(
      [projectRow()], // 1 the project
      edge(OTHER_ID), // 2 its current parent
      subCount(0), //    3
      [], //             4 the requested parent is not the caller's
    );

    const res = await patch({ parentId: PARENT_ID });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "parent_not_found" });
    expect(transactionCalls.count).toBe(0);
    expect(deleteCalls).toHaveLength(0);
    expect(insertCalls).toHaveLength(0);
  });

  it("404 project_not_found when the project itself is not the caller's", async () => {
    readQueue.push([]); // the workspace-scoped project read finds nothing

    const res = await patch({ parentId: PARENT_ID });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "project_not_found" });
    expect(transactionCalls.count).toBe(0);
  });

  it("an ABSENT parentId leaves the parent completely alone — a metadata patch is not a move", async () => {
    readQueue.push(
      [projectRow()], //       1 updateProject's own read of the row
      [], //                    2 summariseCounts: members
      [], //                    3 summariseCounts: sub-projects
      edge(PARENT_ID), //       4 updateProject reads the parent back to shape its result
    );
    writeQueue.push([projectRow({ name: "Renamed" })]);
    queueReadBack(PARENT_ID);

    const res = await patch({ name: "Renamed" });

    expect(res.status).toBe(200);
    // The one write is the UPDATE of the project row. No transaction, no DELETE,
    // no edge INSERT: "do not touch the parent" and "make it a root" are
    // different requests and this is the former.
    expect(transactionCalls.count).toBe(0);
    expect(deleteCalls).toHaveLength(0);
    expect(insertCalls).toHaveLength(0);
  });

  it("400 invalid_body when parentId is not a uuid — no query runs", async () => {
    const res = await patch({ parentId: 42 });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details: string[] };
    expect(body.error).toBe("invalid_body");
    expect(body.details).toContain("parentId");
    expect(transactionCalls.count).toBe(0);
  });
});
