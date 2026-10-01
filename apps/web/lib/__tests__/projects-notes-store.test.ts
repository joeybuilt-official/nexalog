// SPDX-License-Identifier: MIT
/**
 * The linked-notes QUERIES — the two claims about the store that a pure test
 * cannot reach, asserted against the real Drizzle SQL that the real store builds.
 *
 *   1. **The list query never selects the note body.** It selects a bounded
 *      PREFIX (`left(content, NOTE_EXCERPT_SOURCE_CHARS)`) instead. This is the
 *      load-bearing property of the whole feature: a note can be a conversation
 *      past a million characters, and the project page renders a one-line excerpt
 *      per row. If someone "simplifies" the projection to `content: notes.content`,
 *      the page still looks right in a small dev database and ships megabytes in
 *      production — so the assertion is on the SQL, not on a screenshot.
 *   2. **The list query filters soft-deleted notes** (`deleted_at IS NULL`), scopes
 *      to the caller's workspaces, the edge's `item_kind = 'note'` and this
 *      project's id. The pure projection refuses deleted rows a second time
 *      (`projects-notes.test.ts`); this is the first refusal, in the query.
 *
 * The detail query is the deliberate opposite on purpose 1 — it DOES read the body,
 * because the reader asked for that one note — and that contrast is asserted too,
 * so "on demand" cannot quietly become "never".
 *
 * The store is driven through the real Drizzle builders; only `@/lib/db` is faked
 * (no Postgres runs here), and the fake records what the builders were handed so
 * the SQL itself is the thing under test. Drizzle's clause objects are walked for
 * their string chunks, column names and bound parameters — see `sqlFacts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NOTE_EXCERPT_SOURCE_CHARS } from "@/lib/projects/notes";

const { selectMock, queries } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  queries: [] as Array<{
    projection: Record<string, unknown>;
    where: unknown;
    joins: unknown[];
    limit: number | null;
  }>,
}));

// The real schema (table and column objects), the faked client. Nothing connects.
vi.mock("@/lib/db", async () => {
  const schema = await vi.importActual<typeof import("@/lib/db/schema")>("@/lib/db/schema");
  return { schema, db: { select: selectMock } };
});

type Thenable = { then<T>(resolve: (value: unknown) => T): Promise<T> };

/** Chainable stand-in for Drizzle's builder: records the clause, then resolves. */
function builder(record: {
  projection: Record<string, unknown>;
  where: unknown;
  joins: unknown[];
  limit: number | null;
}, rows: unknown[]): Thenable & Record<string, unknown> {
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

/** Queue the rows the next `select` will resolve with. */
function stubSelect(rows: unknown[]): void {
  selectMock.mockImplementation((projection: Record<string, unknown>) => {
    const record = { projection, where: undefined as unknown, joins: [] as unknown[], limit: null };
    queries.push(record);
    return builder(record, rows);
  });
}

/**
 * Everything a Drizzle clause says: the column names it names, the string chunks
 * it carries, and the values it binds.
 */
function sqlFacts(node: unknown): { columns: string[]; text: string; params: unknown[] } {
  const columns: string[] = [];
  const chunks: string[] = [];
  const params: unknown[] = [];
  const seen = new Set<unknown>();

  const walk = (current: unknown) => {
    if (current === null || current === undefined) return;
    if (Array.isArray(current)) {
      for (const item of current) {
        // Drizzle inlines a plain JS number as a SQL literal chunk rather than a
        // bound parameter, so a bare primitive IS a param as far as this walk is
        // concerned (here: the excerpt's character bound).
        if (typeof item === "number" || typeof item === "boolean" || item instanceof Date) {
          params.push(item);
        } else {
          walk(item);
        }
      }
      return;
    }
    if (typeof current !== "object") return;
    if (seen.has(current)) return;
    seen.add(current);

    const rec = current as Record<string, unknown>;
    // A Drizzle column carries its SQL name in `name`.
    if (typeof rec.name === "string") columns.push(rec.name);
    // A StringChunk carries its literals in `value`; a Param carries one bound value.
    if (Array.isArray(rec.value) && rec.value.every((v) => typeof v === "string")) {
      chunks.push(rec.value.join(""));
    } else if (typeof rec.value === "string" || typeof rec.value === "number") {
      params.push(rec.value);
    }
    if (Array.isArray(rec.queryChunks)) walk(rec.queryChunks);
    if ("then" in rec) return; // never walk into a builder's own resolve chain
  };

  walk(node);
  return { columns, text: chunks.join(" ").replace(/\s+/g, " ").trim(), params };
}

beforeEach(() => {
  selectMock.mockReset();
  queries.length = 0;
});

describe("getProjectNotes — the list query", () => {
  it("selects a BOUNDED PREFIX of the body and never the body itself", async () => {
    stubSelect([]);
    const { getProjectNotes } = await import("@/lib/projects/store");

    await getProjectNotes(["11111111-1111-4111-8111-111111111111"], "22222222-2222-4222-8222-222222222222");

    const { projection } = queries[0];
    expect(projection).not.toHaveProperty("content");

    // No value of the projection IS the `content` column...
    const selectedColumns = Object.entries(projection)
      .filter(([, value]) => value !== null && typeof value === "object" && "name" in (value as object))
      .map(([key, value]) => [key, (value as { name: string }).name]);
    expect(selectedColumns).not.toContainEqual(["content", "content"]);
    expect(selectedColumns).toEqual([
      ["id", "id"],
      ["title", "title"],
      ["date", "date"],
      ["updatedAt", "updated_at"],
      ["addedAt", "added_at"],
      // Selected so the projection can refuse a deleted row a second time.
      ["deletedAt", "deleted_at"],
    ]);

    // ...the excerpt is an expression whose bound length is the pure module's
    // constant, so the query cannot drift from the excerpt rule that reads it.
    const excerpt = sqlFacts(projection.excerptSource);
    expect(excerpt.text).toContain("left(");
    expect(excerpt.columns).toContain("content");
    expect(excerpt.params).toContain(NOTE_EXCERPT_SOURCE_CHARS);
  });

  it("excludes soft-deleted notes and scopes to the workspace, the kind and the project", async () => {
    stubSelect([]);
    const { getProjectNotes } = await import("@/lib/projects/store");
    const workspace = "11111111-1111-4111-8111-111111111111";
    const project = "22222222-2222-4222-8222-222222222222";

    await getProjectNotes([workspace], project);

    const facts = sqlFacts(queries[0].where);
    expect(facts.columns).toEqual(
      expect.arrayContaining(["project_id", "item_kind", "workspace_id", "deleted_at"]),
    );
    expect(facts.text).toContain("is null");
    expect(facts.params).toEqual(expect.arrayContaining([project, "note", workspace]));
  });

  it("reads through the edge — the notes join on the project_items item id", async () => {
    stubSelect([]);
    const { getProjectNotes } = await import("@/lib/projects/store");

    await getProjectNotes(["11111111-1111-4111-8111-111111111111"], "22222222-2222-4222-8222-222222222222");

    expect(queries[0].joins).toHaveLength(1);
    const on = sqlFacts((queries[0].joins[0] as { on: unknown }).on);
    expect(on.columns).toEqual(expect.arrayContaining(["id", "item_id"]));
    expect(on.text).toContain("=");
  });

  it("maps the rows the query returns, and never hands back the body", async () => {
    const updatedAt = new Date("2026-09-30T12:00:00.000Z");
    const addedAt = new Date("2026-09-01T00:00:00.000Z");
    stubSelect([
      {
        id: "note-1",
        title: "Full-On Pictures chat",
        excerptSource: "<p>Hello</p>",
        date: "2026-09-30",
        updatedAt,
        addedAt,
        deletedAt: null,
      },
      {
        id: "note-2",
        title: "",
        excerptSource: null,
        date: null,
        updatedAt,
        addedAt,
        deletedAt: null,
      },
    ]);
    const { getProjectNotes } = await import("@/lib/projects/store");

    const rows = await getProjectNotes(["11111111-1111-4111-8111-111111111111"], "p1");

    expect(rows).toEqual([
      {
        id: "note-1",
        title: "Full-On Pictures chat",
        excerptSource: "<p>Hello</p>",
        date: "2026-09-30",
        updatedAt,
        addedAt,
        deletedAt: null,
      },
      {
        id: "note-2",
        title: "",
        excerptSource: "",
        date: null,
        updatedAt,
        addedAt,
        deletedAt: null,
      },
    ]);
    // A `null` body prefix becomes an empty excerpt, never the string "null".
    expect(rows[1].excerptSource).toBe("");
  });

  it("issues no query at all when the caller has no workspace", async () => {
    stubSelect([]);
    const { getProjectNotes } = await import("@/lib/projects/store");

    expect(await getProjectNotes([], "p1")).toEqual([]);
    expect(selectMock).not.toHaveBeenCalled();
  });
});

describe("getProjectNote — the on-demand detail query", () => {
  it("reads the FULL body — this is the one note the reader asked for", async () => {
    stubSelect([
      {
        id: "note-1",
        title: "A chat",
        content: "<p>the whole thing</p>",
        date: null,
        kind: "note",
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
        updatedAt: new Date("2026-09-30T00:00:00.000Z"),
        addedAt: new Date("2026-09-02T00:00:00.000Z"),
        projectId: "p1",
        projectName: "Full-On Pictures",
      },
    ]);
    const { getProjectNote } = await import("@/lib/projects/store");

    const note = await getProjectNote(["11111111-1111-4111-8111-111111111111"], "p1", "note-1");

    expect(note?.content).toBe("<p>the whole thing</p>");
    expect(note?.projectName).toBe("Full-On Pictures");
    expect(queries[0].projection).toHaveProperty("content");
    expect(queries[0].limit).toBe(1);

    // Reached THROUGH the project edge, with both soft-deletes and the caller's
    // workspace in the same clause: an unlinked or foreign note is a 404.
    const facts = sqlFacts(queries[0].where);
    expect(facts.columns).toEqual(
      expect.arrayContaining(["project_id", "item_kind", "id", "workspace_id", "deleted_at"]),
    );
    expect(facts.text).toContain("is null");
    expect(facts.params).toEqual(expect.arrayContaining(["p1", "note", "note-1"]));
    expect(queries[0].joins).toHaveLength(2);
  });

  it("is null when the note is not linked to this project", async () => {
    stubSelect([]);
    const { getProjectNote } = await import("@/lib/projects/store");

    expect(await getProjectNote(["11111111-1111-4111-8111-111111111111"], "p1", "nope")).toBeNull();
  });

  it("defaults an empty body to an empty string rather than null", async () => {
    stubSelect([
      {
        id: "note-1",
        title: "",
        content: null,
        date: null,
        kind: "note",
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
        updatedAt: new Date("2026-09-01T00:00:00.000Z"),
        addedAt: new Date("2026-09-01T00:00:00.000Z"),
        projectId: "p1",
        projectName: "P",
      },
    ]);
    const { getProjectNote } = await import("@/lib/projects/store");

    const note = await getProjectNote(["w1"], "p1", "note-1");
    expect(note?.content).toBe("");
  });

  it("issues no query at all when the caller has no workspace", async () => {
    stubSelect([]);
    const { getProjectNote } = await import("@/lib/projects/store");

    expect(await getProjectNote([], "p1", "note-1")).toBeNull();
    expect(selectMock).not.toHaveBeenCalled();
  });
});
