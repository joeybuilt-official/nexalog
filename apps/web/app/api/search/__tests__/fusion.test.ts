// SPDX-License-Identifier: MIT
/**
 * POST /api/search — result FUSION across the three corpora.
 *
 * The defect these tests pin: the GBrain branch used to `return` the moment it
 * had a single hit, so the bookmark/note lexical pipeline never ran. Because
 * GBrain's index is bound to the brain repo (`/brain/pages`) and can never hold
 * a `capture_sources` row, the two result sets are disjoint — and answering
 * with brain pages silently *deleted* every bookmark and note from the result
 * list for that query. The fix makes GBrain hits a semantic LIST that fuses
 * with (never replaces) the lexical one.
 *
 * What is asserted here:
 *   - a bookmark hit and a brain hit come back in the SAME result set, with
 *     the bookmark still present when GBrain answers;
 *   - the note branch is reached too (three-way fusion);
 *   - `rankingMode` tells the truth: "hybrid" only when a semantic list
 *     participated, "lexical" when GBrain failed/was absent — a GBrain outage
 *     must degrade to lexical-only, not to an empty page;
 *   - the GBrain transport failure path still falls through and still returns
 *     the bookmarks (the degrade semantics that existed before the fix).
 *
 * Postgres and GBrain are both faked at the module boundary (the repo's
 * convention for route tests, `.claude/rules/testing.md` → "Mocking"): the
 * route's *fusion decision* is what is under test, not the database's.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAuthUser, logEvent, getComposition, selectQueue, queryOrder } = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  logEvent: vi.fn(),
  getComposition: vi.fn(),
  selectQueue: [] as unknown[],
  queryOrder: [] as string[],
}));

vi.mock("@/lib/auth/server", () => ({ getAuthUser }));
vi.mock("@/lib/logger", () => ({ logEvent }));
vi.mock("@/composition", () => ({ getComposition }));
vi.mock("@/lib/workspace", () => ({
  getUserWorkspaces: vi.fn(async () => [{ id: "ws-1", userId: "user-1" }]),
}));

/**
 * Chainable drizzle stand-in. Each `select` call mints a builder; awaiting it
 * resolves the NEXT queued value, so queued results line up with the route's
 * own query order (captures → notes → themes).
 */
vi.mock("@/lib/db", () => {
  const makeBuilder = () => {
    const builder: Record<string, unknown> = {};
    const passthrough = () => builder;
    for (const method of [
      "from", "where", "limit", "orderBy", "groupBy", "leftJoin", "innerJoin",
      "returning", "values", "set", "onConflictDoNothing",
    ]) {
      builder[method] = vi.fn(passthrough);
    }
    builder.then = (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(selectQueue.shift() ?? []).then(onFulfilled, onRejected);
    return builder;
  };
  return {
    db: {
      select: vi.fn((...args: unknown[]) => {
        queryOrder.push("select");
        void args;
        return makeBuilder();
      }),
      insert: vi.fn(() => makeBuilder()),
      update: vi.fn(() => makeBuilder()),
    },
    schema: new Proxy({}, { get: (_t, prop) => ({ __table: String(prop) }) }),
  };
});

import { POST } from "@/app/api/search/route";

const BOOKMARK = {
  id: "11111111-1111-4111-8111-111111111111",
  workspaceId: "ws-1",
  userId: "user-1",
  kind: "url",
  content: "https://example.com/docker-guide",
  url: "https://example.com/docker-guide",
  state: "raw",
  noteId: null,
  ogTitle: "Self-hosting Docker",
  ogDescription: "A guide",
  ogImage: null,
  faviconUrl: null,
  audioUrl: null,
  kindClassified: "article",
  classifiedAt: new Date("2026-09-01T00:00:00Z"),
  lastOpenedAt: null,
  openCount: 0,
  lastCheckedAt: null,
  httpStatus: null,
  stalenessScore: 0,
  stalenessReason: null,
  smartArchivedAt: null,
  urlHost: "example.com",
  urlPath: "/docker-guide",
  ogType: "article",
  lastVisitedAt: null,
  stalenessReasons: [],
  evergreen: null,
  currentCheckedAt: null,
  extractedText: "Docker compose lets you self-host with a single file.",
  extractedAt: new Date("2026-09-01T00:00:00Z"),
  summary: null,
  paywalled: false,
  readMinutes: 3,
  watchMinutes: null,
  themeId: null,
  themeLabel: null,
  themeRegion: null,
  openedAt: null,
  metadata: {},
  ogDescriptionEnriched: null,
  ogImageUrl: null,
  ogSiteName: null,
  canonicalUrl: null,
  summaryState: "pending",
  metadataState: "enriched",
  metadataFetchedAt: null,
  metadataAttempts: 1,
  metadataLastError: null,
  readerHtml: "<p>Docker compose…</p>",
  readerText: "Docker compose lets you self-host with a single file.",
  readerState: "ready",
  readerFetchedAt: null,
  videoId: null,
  videoThumbnailUrl: null,
  videoDurationSeconds: null,
  transcript: null,
  transcriptState: "pending",
  transcriptSource: null,
  transcriptLanguage: null,
  transcriptChars: null,
  transcriptFetchedAt: null,
  transcriptAttempts: 0,
  transcriptLastError: null,
  longSummary: null,
  longSummaryState: "pending",
  derivedTitle: null,
  embeddingState: "pending",
  embeddedAt: null,
  embeddingDimensions: null,
  lastClusteredAt: null,
  bookmarkedAt: new Date("2026-09-01T00:00:00Z"),
  importedAt: null,
  importSource: null,
  sourcePayload: null,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  updatedAt: new Date("2026-09-01T00:00:00Z"),
  deletedAt: null,
};

const NOTE = {
  id: "22222222-2222-4222-8222-222222222222",
  workspaceId: "ws-1",
  userId: "user-1",
  title: "Docker notes",
  content: "<p>compose up -d</p>",
  kind: "note",
  lifecycleState: "active",
  date: null,
  deletedAt: null,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  updatedAt: new Date("2026-08-01T00:00:00Z"),
};

const GBRAIN_HIT = {
  slug: "concepts/self-hosting",
  title: "Self-hosting",
  type: "concept",
  chunkText: "Self-hosting means running the stack on your own hardware.",
  effectiveDate: "2026-07-01T00:00:00.000Z",
};

/** Wire the composition root: GBPrain answers this query with one hit. */
function withGbrain(hits: unknown[] = [GBRAIN_HIT]) {
  getComposition.mockReturnValue({
    gbrain: {
      search: vi.fn(async () => hits),
      query: vi.fn(async () => []),
    },
    brainIndex: { search: vi.fn(async () => []) },
  });
}

function search(query = "docker") {
  return POST(
    new Request("http://localhost/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, surfaces: ["notes", "bookmarks"], sort: "relevance" }),
    }),
  );
}

beforeEach(() => {
  getAuthUser.mockReset();
  getAuthUser.mockResolvedValue({ id: "user-1" });
  logEvent.mockReset();
  getComposition.mockReset();
  selectQueue.length = 0;
  queryOrder.length = 0;
});

describe("POST /api/search — GBrain and lexical results FUSE", () => {
  it("returns the bookmark AND the note AND the brain page for one query", async () => {
    // Route query order: captures (FTS), notes (FTS), themes.
    selectQueue.push([{ row: BOOKMARK, rank: 0.9 }]);
    selectQueue.push([{ row: NOTE, rank: 0.5 }]);
    selectQueue.push([]);
    withGbrain();

    const res = await search("docker");
    const body = await res.json();

    expect(res.status).toBe(200);
    const ids = body.results.map((r: { id: string }) => r.id);
    expect(ids).toContain(BOOKMARK.id);
    expect(ids).toContain(NOTE.id);
    expect(ids).toContain(GBRAIN_HIT.slug);
    expect(body.total).toBe(3);
  });

  it("does NOT drop bookmarks when GBrain answers — the regression this fixes", async () => {
    selectQueue.push([{ row: BOOKMARK, rank: 0.9 }]);
    selectQueue.push([]);
    selectQueue.push([]);
    withGbrain();

    const body = await (await search("self hosting docker")).json();

    // Before the fix this was exactly the GBrain list and nothing else.
    const bookmark = body.results.find((r: { id: string }) => r.id === BOOKMARK.id);
    expect(bookmark).toBeDefined();
    expect(bookmark.title).toBe("Self-hosting Docker");
    // …and the brain hit is still there. Fusion, not substitution.
    expect(body.results.map((r: { id: string }) => r.id)).toContain(GBRAIN_HIT.slug);
  });

  it("ranks across lists with RRF: a hit present in only one list still scores", async () => {
    selectQueue.push([{ row: BOOKMARK, rank: 0.9 }]);
    selectQueue.push([]);
    selectQueue.push([]);
    withGbrain();

    const body = await (await search("docker")).json();

    for (const r of body.results) expect(r.score).toBeGreaterThan(0);
    expect(body.rankingMode).toBe("hybrid");
  });

  it("reports `lexical` when GBrain is not configured — bookmarks still searchable", async () => {
    selectQueue.push([{ row: BOOKMARK, rank: 0.9 }]);
    selectQueue.push([]);
    selectQueue.push([]);
    getComposition.mockReturnValue({ gbrain: null, brainIndex: { search: vi.fn() } });

    const body = await (await search("docker")).json();

    expect(body.rankingMode).toBe("lexical");
    expect(body.results.map((r: { id: string }) => r.id)).toContain(BOOKMARK.id);
  });

  it("degrades to lexical when the GBrain transport fails — never an empty page", async () => {
    selectQueue.push([{ row: BOOKMARK, rank: 0.9 }]);
    selectQueue.push([]);
    selectQueue.push([]);
    getComposition.mockReturnValue({
      gbrain: {
        search: vi.fn(async () => {
          throw new Error("GBrain MCP HTTP 503 (search)");
        }),
        query: vi.fn(async () => {
          throw new Error("GBrain MCP HTTP 503 (query)");
        }),
      },
      brainIndex: { search: vi.fn(async () => []) },
    });

    const res = await search("docker");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.rankingMode).toBe("lexical");
    expect(body.results.map((r: { id: string }) => r.id)).toEqual([BOOKMARK.id]);
    expect(logEvent).toHaveBeenCalledWith(
      "search.gbrain.error",
      expect.objectContaining({ error: expect.stringContaining("503") }),
    );
  });

  it("falls back to the fs brain scan only when GBrain itself returned nothing", async () => {
    selectQueue.push([]);
    selectQueue.push([]);
    selectQueue.push([]);
    const fsHit = { slug: "people/jane-doe", title: "Jane Doe", snippet: "…jane…" };
    getComposition.mockReturnValue({
      gbrain: { search: vi.fn(async () => []), query: vi.fn(async () => []) },
      brainIndex: { search: vi.fn(async () => [fsHit]) },
    });

    const body = await (await search("jane")).json();

    expect(body.results.map((r: { id: string }) => r.id)).toContain("people/jane-doe");
    expect(body.rankingMode).toBe("hybrid");
  });

  it("does not consult the brain at all for a query-less browse", async () => {
    selectQueue.push([BOOKMARK]); // recency branch: plain rows, no rank
    selectQueue.push([NOTE]);
    const gbrainSearch = vi.fn(async () => [GBRAIN_HIT]);
    getComposition.mockReturnValue({
      gbrain: { search: gbrainSearch, query: gbrainSearch },
      brainIndex: { search: vi.fn(async () => []) },
    });

    const res = await POST(
      new Request("http://localhost/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surfaces: ["notes", "bookmarks"], sort: "recency" }),
      }),
    );
    const body = await res.json();

    expect(gbrainSearch).not.toHaveBeenCalled();
    expect(body.rankingMode).toBe("recency");
  });

  it("401s without a session and never touches a store", async () => {
    getAuthUser.mockResolvedValue(null);

    const res = await search("docker");

    expect(res.status).toBe(401);
    expect(getComposition).not.toHaveBeenCalled();
    expect(queryOrder).toEqual([]);
  });
});
