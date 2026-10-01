// SPDX-License-Identifier: MIT
/**
 * The brief's IO — the claims a pure test cannot reach, asserted against the
 * real Drizzle SQL the real store builds.
 *
 * Three properties are load-bearing and each is asserted on the SQL, not on a
 * rendered screenshot:
 *
 *   1. **No note body is selected.** The brief reads `length(content)` and the
 *      embedding; a projection that grew a `content` column would ship a
 *      megabyte-to-the-row for a character count.
 *   2. **The notes are scoped, filtered and reached through the project edge**
 *      — workspace, `item_kind = 'note'`, `deleted_at IS NULL`, `project_id`.
 *   3. **Themes are READ from `memory_themes` and parsed through a `::text` cast**
 *      (so the same code reads a pgvector or jsonb centroid) — nothing
 *      recomputes them.
 *
 * Only `@/lib/db` is faked (no Postgres runs here); the real schema objects and
 * the real builders produce the clauses under test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { selectMock, queries } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  queries: [] as Array<{
    projection: Record<string, unknown>;
    where: unknown;
    joins: unknown[];
    limit: number | null;
  }>,
}));

vi.mock("@/lib/db", async () => {
  const schema = await vi.importActual<typeof import("@/lib/db/schema")>("@/lib/db/schema");
  return { schema, db: { select: selectMock } };
});

type Thenable = { then<T>(resolve: (value: unknown) => T): Promise<T> };

function builder(
  record: { projection: Record<string, unknown>; where: unknown; joins: unknown[]; limit: number | null },
  rows: unknown[],
): Thenable & Record<string, unknown> {
  const b: Record<string, unknown> = {
    from: () => b,
    innerJoin: (table: unknown, on: unknown) => {
      record.joins.push({ table, on });
      return b;
    },
    where: (condition: unknown) => {
      record.where = condition;
      return b;
    },
    limit: (count: number) => {
      record.limit = count;
      return b;
    },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve),
  };
  return b as Thenable & Record<string, unknown>;
}

/** Each `select` consumes the next queued row-set. */
function stubSelectQueue(...sets: unknown[][]): void {
  let i = 0;
  selectMock.mockImplementation((projection: Record<string, unknown>) => {
    const record = { projection, where: undefined as unknown, joins: [] as unknown[], limit: null };
    queries.push(record);
    const rows = sets[i] ?? [];
    i += 1;
    return builder(record, rows);
  });
}

/** Everything a Drizzle clause says: column names, string chunks, bound values. */
function sqlFacts(node: unknown): { columns: string[]; text: string; params: unknown[] } {
  const columns: string[] = [];
  const chunks: string[] = [];
  const params: unknown[] = [];
  const seen = new Set<unknown>();

  const walk = (current: unknown) => {
    if (current === null || current === undefined) return;
    if (Array.isArray(current)) {
      for (const item of current) {
        if (typeof item === "number" || typeof item === "boolean" || item instanceof Date) {
          params.push(item);
        } else {
          walk(item);
        }
      }
      return;
    }
    if (typeof current !== "object") {
      if (typeof current === "string" || typeof current === "number") params.push(current);
      return;
    }
    if (seen.has(current)) return;
    seen.add(current);

    const rec = current as Record<string, unknown>;
    if (typeof rec.name === "string") columns.push(rec.name);
    if (Array.isArray(rec.value) && rec.value.every((v) => typeof v === "string")) {
      chunks.push(rec.value.join(""));
    } else if (typeof rec.value === "string" || typeof rec.value === "number") {
      params.push(rec.value);
    }
    if (Array.isArray(rec.queryChunks)) walk(rec.queryChunks);
    if ("then" in rec) return;
  };

  walk(node);
  return { columns, text: chunks.join(" ").replace(/\s+/g, " ").trim(), params };
}

const WS = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  selectMock.mockReset();
  queries.length = 0;
});

describe("getProjectBriefNotes", () => {
  it("selects a SIZE and an embedding, never the note body", async () => {
    stubSelectQueue([]);
    const { getProjectBriefNotes } = await import("@/lib/projects/store");

    await getProjectBriefNotes([WS], "22222222-2222-4222-8222-222222222222");

    const { projection } = queries[0];
    expect(Object.keys(projection).sort()).toEqual(
      ["addedAt", "contentLength", "date", "deletedAt", "embedding", "id", "title", "updatedAt"].sort(),
    );
    // No selected VALUE is the `content` column object.
    const selectedColumns = Object.entries(projection)
      .filter(([, value]) => value !== null && typeof value === "object" && "name" in (value as object))
      .map(([, value]) => (value as { name: string }).name);
    expect(selectedColumns).not.toContain("content");

    // The size IS the length of the content, computed in SQL.
    const size = sqlFacts(projection.contentLength);
    expect(size.text).toContain("length(");
    expect(size.columns).toContain("content");

    // The embedding is cast to text so it can be parsed app-side.
    const embedding = sqlFacts(projection.embedding);
    expect(embedding.text).toContain("embedding");
    expect(embedding.text).toContain("::text");
  });

  it("scopes to the workspace, the note kind, this project and live rows", async () => {
    stubSelectQueue([]);
    const { getProjectBriefNotes } = await import("@/lib/projects/store");

    await getProjectBriefNotes([WS], "p1");

    const facts = sqlFacts(queries[0].where);
    expect(facts.columns).toEqual(
      expect.arrayContaining(["project_id", "item_kind", "workspace_id", "deleted_at"]),
    );
    expect(facts.text).toContain("is null");
    expect(facts.params).toEqual(expect.arrayContaining(["p1", "note", WS]));
    // Reached through the project edge, not a global note scan.
    expect(queries[0].joins).toHaveLength(1);
    const on = sqlFacts((queries[0].joins[0] as { on: unknown }).on);
    expect(on.columns).toEqual(expect.arrayContaining(["id", "item_id"]));
  });

  it("parses the embedding literal and defaults absent values", async () => {
    stubSelectQueue([
      {
        id: "n1",
        title: "Kickoff",
        date: "2026-09-20",
        updatedAt: new Date("2026-09-30T00:00:00.000Z"),
        addedAt: new Date("2026-09-21T00:00:00.000Z"),
        deletedAt: null,
        contentLength: 1234,
        embedding: "[0.1,0.2,0.3]",
      },
      {
        id: "n2",
        title: "",
        date: null,
        updatedAt: new Date("2026-09-01T00:00:00.000Z"),
        addedAt: null,
        deletedAt: null,
        contentLength: null,
        embedding: null,
      },
    ]);
    const { getProjectBriefNotes } = await import("@/lib/projects/store");

    const rows = await getProjectBriefNotes([WS], "p1");

    expect(rows[0].embedding).toEqual([0.1, 0.2, 0.3]);
    expect(rows[0].contentLength).toBe(1234);
    expect(rows[1].embedding).toBeNull();
    expect(rows[1].contentLength).toBe(0);
  });

  it("issues no query when the caller has no workspace", async () => {
    stubSelectQueue([]);
    const { getProjectBriefNotes } = await import("@/lib/projects/store");
    expect(await getProjectBriefNotes([], "p1")).toEqual([]);
    expect(selectMock).not.toHaveBeenCalled();
  });
});

describe("getWorkspaceThemes", () => {
  it("reads memory_themes and parses a jsonb-or-pgvector centroid via ::text", async () => {
    stubSelectQueue([
      { themeId: "t1", label: "Agents", size: 12, centroidText: "[0.5, 0.5]" },
      { themeId: "t2", label: "Unusable", size: 3, centroidText: null },
    ]);
    const { getWorkspaceThemes } = await import("@/lib/projects/store");

    const themes = await getWorkspaceThemes([WS]);

    expect(themes[0]).toEqual({ themeId: "t1", label: "Agents", size: 12, centroid: [0.5, 0.5] });
    expect(themes[1].centroid).toBeNull();
    const facts = sqlFacts(queries[0].projection.centroidText);
    expect(facts.text).toContain("::text");
  });

  it("issues no query without a workspace", async () => {
    stubSelectQueue([]);
    const { getWorkspaceThemes } = await import("@/lib/projects/store");
    expect(await getWorkspaceThemes([])).toEqual([]);
    expect(selectMock).not.toHaveBeenCalled();
  });
});

describe("loadProjectBriefSource", () => {
  it("composes the project, its notes, sub-projects and themes without a re-read", async () => {
    stubSelectQueue(
      [
        { id: "n1", title: "Kickoff", date: null, updatedAt: new Date(0), addedAt: null, deletedAt: null, contentLength: 10, embedding: null },
      ],
      [{ themeId: "t1", label: "Agents", size: 4, centroidText: "[1,0]" }],
    );
    const { loadProjectBriefSource } = await import("@/lib/projects/store");

    const source = await loadProjectBriefSource([WS], {
      id: "p1",
      workspaceId: WS,
      userId: "u1",
      name: "Project Alpha",
      description: null,
      lifecycleState: "active",
      livingDocUpdatedAt: null,
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      updatedAt: new Date("2026-09-30T00:00:00.000Z"),
      parentId: null,
      itemCount: 1,
      subProjectCount: 1,
      livingDoc: "doc",
      units: [],
      subProjects: [{ id: "s1", name: "Sub Alpha", lifecycleState: "active" }],
      parent: null,
    });

    expect(selectMock).toHaveBeenCalledTimes(2);
    expect(source.project.name).toBe("Project Alpha");
    expect(source.project.deletedAt).toBeNull();
    expect(source.notes).toHaveLength(1);
    expect(source.subProjects).toEqual([
      { id: "s1", name: "Sub Alpha", lifecycleState: "active", deletedAt: null },
    ]);
    expect(source.themes![0].centroid).toEqual([1, 0]);
  });
});

describe("getProjectBriefSource", () => {
  it("is null without a workspace, and queries nothing", async () => {
    stubSelectQueue([]);
    const { getProjectBriefSource } = await import("@/lib/projects/store");
    expect(await getProjectBriefSource([], "p1")).toBeNull();
    expect(selectMock).not.toHaveBeenCalled();
  });
});
