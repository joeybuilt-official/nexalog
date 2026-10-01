// SPDX-License-Identifier: MIT
/**
 * GET /api/pages — the brain page index.
 *
 * These tests pin the endpoint contract the /app/brain surface now depends on:
 *
 *   - a session is REQUIRED (401 without one, before any read);
 *   - the response is the typed ladder payload (`ok` / `source` / `degraded` /
 *     `pages` / `nextOffset` / `truncated`), with `source: "gbrain"` and
 *     `degraded: false` when GBrain answered;
 *   - a GBrain failure or an unconfigured environment is NOT a 500: the route
 *     answers 200 with `source: "local"` (or `"none"`) and a `note` explaining
 *     why, so the surface can say what it is showing;
 *   - query params are bounded and parsed (`limit` clamped, `offset` honoured,
 *     an unknown `sort` dropped rather than passed through);
 *   - the wire shape is `{slug, title, type, updatedAt}` per row — no body —
 *     because the index is a catalogue, not a corpus.
 *
 * GBrain and the brain repo are both faked at the module boundary (the repo's
 * convention for route tests, `.agents/rules/testing.md` → "Mocking"): the
 * route's DECISION is what is under test, not the MCP transport.
 *
 * Co-located with the route it covers, beside `route.ts`, like every other
 * endpoint suite in this repo — a test that drives a route handler imports
 * from `app/`, which the `web-lib-no-ui` architecture rule forbids from under
 * `lib/`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAuthUser, logEvent, getComposition, buildLocalGraph } = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  logEvent: vi.fn(),
  getComposition: vi.fn(),
  buildLocalGraph: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({ getAuthUser }));
vi.mock("@/lib/logger", () => ({ logEvent }));
vi.mock("@/composition", () => ({ getComposition }));
vi.mock("@/lib/graph/local-graph", () => ({ buildLocalGraph }));

import { GET } from "@/app/api/pages/route";

const GBRAIN_ROWS = [
  { slug: "concepts/litellm-gateway", title: "LiteLLM Gateway", type: "concept", sourceId: "default", updatedAt: "2026-09-23T05:47:55.889Z" },
  { slug: "people/example-person", title: "Example Person", type: "person", sourceId: "default", updatedAt: "2026-09-22T05:00:00.000Z" },
];

function withGbrain(listPages = vi.fn(async () => GBRAIN_ROWS)) {
  getComposition.mockReturnValue({
    gbrain: { listPages },
    brainStore: { getPage: vi.fn() },
  });
  return listPages;
}

function request(query = "") {
  return GET(new Request(`http://localhost/api/pages${query}`));
}

beforeEach(() => {
  getAuthUser.mockReset();
  getAuthUser.mockResolvedValue({ id: "user-1" });
  logEvent.mockReset();
  getComposition.mockReset();
  buildLocalGraph.mockReset();
  buildLocalGraph.mockResolvedValue({ nodes: [], edges: [], pagesScanned: 0, truncated: false });
});

describe("GET /api/pages", () => {
  it("401s without a session and never touches GBrain", async () => {
    getAuthUser.mockResolvedValue(null);
    const listPages = withGbrain();

    const res = await request();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(listPages).not.toHaveBeenCalled();
  });

  it("lists pages from GBrain with the documented row shape and not degraded", async () => {
    withGbrain();

    const res = await request();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.source).toBe("gbrain");
    expect(body.degraded).toBe(false);
    expect(body.note).toBeUndefined();
    expect(body.pages).toEqual(GBRAIN_ROWS);
    // A catalogue, not a corpus: no page bodies cross this endpoint.
    for (const p of body.pages) expect(p).not.toHaveProperty("body");
  });

  it("passes limit/offset through and clamps limit to the remote cap", async () => {
    const listPages = withGbrain();

    await request("?limit=9999&offset=20");

    expect(listPages).toHaveBeenCalledWith(expect.objectContaining({ limit: 100, offset: 20 }));
  });

  it("drops an unknown sort rather than forwarding it to the MCP tool", async () => {
    const listPages = withGbrain();

    await request("?sort=definitely-not-a-sort");

    expect(listPages).toHaveBeenCalledWith(expect.not.objectContaining({ sort: expect.anything() }));
  });

  it("honours a known sort and a type filter", async () => {
    const listPages = withGbrain();

    await request("?sort=slug&type=concept");

    expect(listPages).toHaveBeenCalledWith(expect.objectContaining({ sort: "slug", type: "concept" }));
  });

  it("degrades to the brain repo when GBrain is unreachable — 200, not a 500", async () => {
    getComposition.mockReturnValue({
      gbrain: {
        listPages: vi.fn(async () => {
          throw new Error("GBrain MCP HTTP 503 (list_pages)");
        }),
      },
      brainStore: { getPage: vi.fn() },
    });
    buildLocalGraph.mockResolvedValue({
      nodes: [{ slug: "concepts/from-disk", title: "From Disk", type: "concept" }],
      edges: [],
      pagesScanned: 1,
      truncated: false,
    });

    const res = await request();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.source).toBe("local");
    expect(body.degraded).toBe(true);
    expect(body.note).toMatch(/unreachable/);
    expect(body.pages[0].slug).toBe("concepts/from-disk");
    expect(logEvent).toHaveBeenCalledWith(
      "pages.gbrain.error",
      expect.objectContaining({ error: expect.stringContaining("503") }),
    );
  });

  it("reports `none` with a reason when neither GBrain nor the repo has pages", async () => {
    getComposition.mockReturnValue({ gbrain: null, brainStore: { getPage: vi.fn() } });

    const body = await (await request()).json();

    expect(body.ok).toBe(true);
    expect(body.source).toBe("none");
    expect(body.degraded).toBe(true);
    expect(body.pages).toEqual([]);
    expect(body.note).toMatch(/not configured/);
  });

  it("marks a full page as truncated with a next offset", async () => {
    withGbrain(vi.fn(async () => [GBRAIN_ROWS[0]]));

    const body = await (await request("?limit=1")).json();

    expect(body.truncated).toBe(true);
    expect(body.nextOffset).toBe(1);
  });

  it("does not rebuild a later page from disk when GBrain is simply exhausted", async () => {
    withGbrain(vi.fn(async () => []));
    buildLocalGraph.mockResolvedValue({
      nodes: [{ slug: "concepts/from-disk", title: "From Disk", type: "concept" }],
      edges: [],
      pagesScanned: 1,
      truncated: false,
    });

    const body = await (await request("?offset=100")).json();

    // GBrain answered; the disk fallback describes a DIFFERENT position.
    expect(body.source).toBe("gbrain");
    expect(body.pages).toEqual([]);
    expect(body.nextOffset).toBeNull();
    expect(buildLocalGraph).not.toHaveBeenCalled();
  });

  it("does fall back to disk on page ONE when GBrain reports having nothing", async () => {
    withGbrain(vi.fn(async () => []));
    buildLocalGraph.mockResolvedValue({
      nodes: [{ slug: "concepts/from-disk", title: "From Disk", type: "concept" }],
      edges: [],
      pagesScanned: 1,
      truncated: false,
    });

    const body = await (await request()).json();

    expect(body.source).toBe("local");
    expect(body.pages).toHaveLength(1);
  });
});
