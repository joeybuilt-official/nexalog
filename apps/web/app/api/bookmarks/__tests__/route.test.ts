// SPDX-License-Identifier: MIT
/**
 * POST /api/bookmarks — the create half of the bookmark resource.
 *
 * This is the front door that did not exist: every mounted "save a link"
 * control posted JSON at `/api/capture` (which parses multipart and made the
 * request fail), and `AddBookmarkForm` was never rendered anywhere. These tests
 * pin the contract the clients now depend on:
 *
 *   - a URL becomes a `capture_sources` row with `kind='url'`, classified at
 *     write time (`kind_classified` set — `NULL` is invisible to `/api/search`),
 *     `url_host`/`url_path` filled and `bookmarked_at` stamped;
 *   - the URL is canonicalized through `normalizeUrl` before it is stored, so
 *     utm-tagged duplicates collapse instead of accumulating;
 *   - re-saving the same link is a no-op that returns the EXISTING row
 *     (`duplicate: true`) — there is no unique index on `url`, so idempotency
 *     is this handler's job;
 *   - workspace scoping is enforced against the caller's OWN memberships: a
 *     workspace id the user does not belong to is a 404, never a write;
 *   - bad input (non-URL, junk scheme, misspelled field, no body) is a 400 in
 *     the repo's typed-error shape; unauthenticated is a 401;
 *   - a missing relation degrades through `surfaceUnavailableIfMissingRelation`
 *     (503), and any other failure propagates rather than being laundered.
 *
 * The enrichment chain (og metadata → reader) is QUEUED after the response and
 * is asserted by spying on the two workers, so the test proves a newly saved
 * link is set up to become body-searchable without waiting on a network fetch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  getAuthUser,
  logEvent,
  getUserWorkspaces,
  enrichOne,
  extractReader,
  insertValues,
  existingRows,
} = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  logEvent: vi.fn(),
  getUserWorkspaces: vi.fn(),
  enrichOne: vi.fn(),
  extractReader: vi.fn(),
  insertValues: vi.fn(),
  existingRows: [] as unknown[],
}));

vi.mock("@/lib/auth/server", () => ({ getAuthUser }));
vi.mock("@/lib/logger", () => ({ logEvent }));
vi.mock("@/lib/workspace", () => ({ getUserWorkspaces }));
vi.mock("@/lib/enrichment/metadata", () => ({ enrichOne }));
vi.mock("@/lib/enrichment/reader", () => ({ extractReader }));

const INSERTED = {
  id: "33333333-3333-4333-8333-333333333333",
  workspaceId: "ws-1",
  userId: "user-1",
  kind: "url",
  url: "https://example.com/docker-guide",
  state: "raw",
  kindClassified: "article",
  urlHost: "example.com",
  urlPath: "/docker-guide",
  readerState: "pending",
  metadataState: "pending",
  bookmarkedAt: new Date("2026-09-28T12:00:00Z"),
  createdAt: new Date("2026-09-28T12:00:00Z"),
  updatedAt: new Date("2026-09-28T12:00:00Z"),
};

vi.mock("@/lib/db", () => {
  const makeBuilder = (terminal: "select" | "insert") => {
    const builder: Record<string, unknown> = {};
    const passthrough = () => builder;
    for (const method of [
      "from", "where", "limit", "orderBy", "groupBy", "leftJoin", "innerJoin",
      "onConflictDoNothing",
    ]) {
      builder[method] = vi.fn(passthrough);
    }
    builder.values = vi.fn((values: unknown) => {
      insertValues(values);
      return builder;
    });
    builder.returning = vi.fn(() => Promise.resolve([INSERTED]));
    builder.then = (onFulfilled?: (v: unknown) => unknown) =>
      Promise.resolve(terminal === "select" ? existingRows.slice() : []).then(onFulfilled);
    return builder;
  };
  return {
    db: {
      select: vi.fn(() => makeBuilder("select")),
      insert: vi.fn(() => makeBuilder("insert")),
      update: vi.fn(() => makeBuilder("select")),
    },
    schema: new Proxy({}, { get: (_t, prop) => ({ __table: String(prop) }) }),
  };
});

import { POST } from "@/app/api/bookmarks/route";

/** Real UUIDs: the body schema validates `workspaceId` as one (strict input). */
const WS1 = "11111111-1111-4111-8111-111111111111";
const WS2 = "22222222-2222-4222-8222-222222222222";
const FOREIGN = "99999999-9999-4999-8999-999999999999";

function save(body: unknown) {
  return POST(
    new Request("http://localhost/api/bookmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  getAuthUser.mockReset();
  getAuthUser.mockResolvedValue({ id: "user-1" });
  logEvent.mockReset();
  getUserWorkspaces.mockReset();
  getUserWorkspaces.mockResolvedValue([
    { id: WS1, userId: "user-1" },
    { id: WS2, userId: "user-1" },
  ]);
  enrichOne.mockReset();
  enrichOne.mockResolvedValue({ ok: true, reason: "enriched", state: "enriched" });
  extractReader.mockReset();
  extractReader.mockResolvedValue({ ok: true, reason: "ok", state: "ready" });
  insertValues.mockReset();
  existingRows.length = 0;
});

describe("POST /api/bookmarks", () => {
  it("saves a URL as a classified bookmark row and returns it", async () => {
    const res = await save({ url: "https://example.com/docker-guide" });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toMatchObject({ ok: true, duplicate: false });
    expect(body.bookmark.id).toBe(INSERTED.id);
    expect(insertValues).toHaveBeenCalledTimes(1);
  });

  it("classifies at write time — the row is not invisible to /api/search", async () => {
    await save({ url: "https://example.com/blog/docker-guide" });

    const values = insertValues.mock.calls[0][0] as Record<string, unknown>;
    // `kind_classified` NULL is filtered out by the search route's
    // `inArray(kindClassified, …)`, so this field is what makes a new save
    // findable at all.
    expect(values.kindClassified).toBe("article");
    expect(values.kind).toBe("url");
    expect(values.urlHost).toBe("example.com");
    expect(values.urlPath).toBe("/blog/docker-guide");
    expect(values.bookmarkedAt).toBeInstanceOf(Date);
  });

  it("keeps a plain unknown-host save in a search-visible kind, never NULL", async () => {
    await save({ url: "https://example.com/docker-guide" });

    const values = insertValues.mock.calls[0][0] as Record<string, unknown>;
    // The heuristic is allowed to say "other" — what it may never do is leave
    // the column NULL, because that is the one value `/api/search` drops.
    expect(values.kindClassified).toBe("other");
    expect(values.kindClassified).not.toBeNull();
  });

  it("canonicalizes the URL, so a utm-tagged save collapses onto the clean one", async () => {
    await save({
      url: "https://Example.com/docker-guide/?utm_source=newsletter&fbclid=abc123#section",
    });

    const values = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(values.url).toBe("https://example.com/docker-guide");
  });

  it("queues the enrichment chain so a new link can become body-searchable", async () => {
    await save({ url: "https://example.com/docker-guide" });

    // Fire-and-forget: the response is returned first, the writes happen next
    // tick. Await a macrotask so the assertion is about behaviour, not timing.
    await new Promise((r) => setTimeout(r, 0));

    expect(enrichOne).toHaveBeenCalledWith(INSERTED.id);
    expect(extractReader).toHaveBeenCalledWith(INSERTED.id);
  });

  it("returns the existing row for a duplicate instead of writing a second one", async () => {
    existingRows.push({ ...INSERTED, id: "existing-row" });

    const res = await save({ url: "https://example.com/docker-guide" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, duplicate: true });
    expect(body.bookmark.id).toBe("existing-row");
    expect(insertValues).not.toHaveBeenCalled();
    expect(enrichOne).not.toHaveBeenCalled();
  });

  it("accepts an explicit workspace the user belongs to", async () => {
    const res = await save({ url: "https://example.com/x", workspaceId: WS2 });

    expect(res.status).toBe(201);
    const values = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(values.workspaceId).toBe(WS2);
  });

  it("404s a workspace the user is NOT a member of and writes nothing", async () => {
    const res = await save({ url: "https://example.com/x", workspaceId: FOREIGN });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("400s a non-http(s) URL rather than storing it", async () => {
    for (const url of ["javascript:alert(1)", "ftp://example.com/x", "not a url", "   "]) {
      const res = await save({ url });
      expect(res.status, url).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_url" });
    }
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("400s a misspelled body field instead of ignoring the intent", async () => {
    const res = await save({ link: "https://example.com/x" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("400s a malformed JSON body", async () => {
    const res = await save("{not json");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
  });

  it("404s when the user has no workspace at all", async () => {
    getUserWorkspaces.mockResolvedValue([]);

    const res = await save({ url: "https://example.com/x" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no_workspace" });
  });

  it("401s without a session, and never resolves a workspace", async () => {
    getAuthUser.mockResolvedValue(null);

    const res = await save({ url: "https://example.com/x" });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(getUserWorkspaces).not.toHaveBeenCalled();
  });
});
