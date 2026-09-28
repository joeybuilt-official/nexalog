// SPDX-License-Identifier: MIT
/**
 * GET /api/pages/[...slug] — one brain page.
 *
 * The contract /app/brain/<slug> renders from:
 *
 *   - a session is REQUIRED (401 without one, before any read);
 *   - `[...slug]` joins its segments — brain slugs ARE paths, so
 *     `concepts/litellm-gateway` arrives as two params and must become one
 *     slug, exactly what the single-segment route could never do;
 *   - the payload carries the page (title/type/BODY — the reader has nothing
 *     to render without it), its typed outbound links and its backlinks;
 *   - a slug that resolves nowhere is a 404 in the typed-error shape, NOT an
 *     empty 200 that renders a page which does not exist;
 *   - a GBrain outage degrades to the brain repo (200 + `source: "local"` +
 *     a `note`) instead of a 500;
 *   - one link read failing does not lose the page: the body still renders.
 *
 * Co-located with the route it covers, beside `route.ts`: a test that drives a
 * route handler imports from `app/`, which the `web-lib-no-ui` architecture
 * rule forbids from under `lib/`.
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

import { GET } from "@/app/api/pages/[...slug]/route";

const PAGE = {
  slug: "concepts/litellm-gateway",
  title: "LiteLLM Gateway",
  type: "concept",
  body: "# LiteLLM Gateway\n\nRoutes every model call. See [[company/joeybuilt]].",
};

const OUT_LINKS = [
  { fromSlug: "concepts/litellm-gateway", toSlug: "companies/joeybuilt", linkType: "mentions", context: "ctx", depth: 1 },
  { fromSlug: "concepts/litellm-gateway", toSlug: "concepts/docker-compose-stacks", linkType: "mentions", context: null, depth: 1 },
];

const BACKLINKS = [
  { fromSlug: "notes/gateway-notes", toSlug: "concepts/litellm-gateway", linkType: "mentions", context: null, depth: null },
];

function withGbrain(over: Partial<Record<"getPage" | "getBacklinks" | "traverseGraph", unknown>> = {}) {
  const client = {
    getPage: vi.fn(async () => PAGE),
    getBacklinks: vi.fn(async () => BACKLINKS),
    traverseGraph: vi.fn(async () => OUT_LINKS),
    ...over,
  };
  getComposition.mockReturnValue({ gbrain: client, brainStore: { getPage: vi.fn(async () => null) } });
  return client;
}

function request(...segments: string[]) {
  return GET(new Request("http://localhost/api/pages/x"), {
    params: Promise.resolve({ slug: segments }),
  });
}

beforeEach(() => {
  getAuthUser.mockReset();
  getAuthUser.mockResolvedValue({ id: "user-1" });
  logEvent.mockReset();
  getComposition.mockReset();
  buildLocalGraph.mockReset();
  buildLocalGraph.mockResolvedValue({ nodes: [], edges: [], pagesScanned: 0, truncated: false });
});

describe("GET /api/pages/[...slug]", () => {
  it("401s without a session and never reads a page", async () => {
    getAuthUser.mockResolvedValue(null);
    const client = withGbrain();

    const res = await request("concepts", "litellm-gateway");

    expect(res.status).toBe(401);
    expect(client.getPage).not.toHaveBeenCalled();
  });

  it("joins the catch-all segments into ONE slug and returns body + typed links", async () => {
    const client = withGbrain();

    const res = await request("concepts", "litellm-gateway");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(client.getPage).toHaveBeenCalledWith("concepts/litellm-gateway");
    expect(body.source).toBe("gbrain");
    expect(body.degraded).toBe(false);
    // The reader cannot render without the body.
    expect(body.page.body).toBe(PAGE.body);
    expect(body.page.title).toBe("LiteLLM Gateway");
    expect(body.page.type).toBe("concept");
    // Typed links OUT carry the far-side slug (never the page's own).
    expect(body.links).toEqual([
      { slug: "companies/joeybuilt", title: null, linkType: "mentions", context: "ctx" },
      { slug: "concepts/docker-compose-stacks", title: null, linkType: "mentions", context: null },
    ]);
    expect(body.backlinks).toEqual([
      { slug: "notes/gateway-notes", title: null, linkType: "mentions", context: null },
    ]);
  });

  it("404s a slug that resolves nowhere — never an empty 200", async () => {
    withGbrain({ getPage: vi.fn(async () => null) });

    const res = await request("concepts", "definitely-not-a-page");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "not_found",
      slug: "concepts/definitely-not-a-page",
    });
  });

  it("400s when the slug is empty", async () => {
    withGbrain();
    const res = await request();
    expect(res.status).toBe(400);
  });

  it("degrades to the brain repo when GBrain is unreachable", async () => {
    getComposition.mockReturnValue({
      gbrain: {
        getPage: vi.fn(async () => {
          throw new Error("GBrain MCP HTTP 503 (get_page)");
        }),
      },
      brainStore: {
        getPage: vi.fn(async () => ({
          slug: { value: "concepts/from-disk" },
          frontmatter: { title: "From Disk", type: "concept" },
          body: "# From Disk\n\nSee [[concepts/other]].",
        })),
      },
    });
    buildLocalGraph.mockResolvedValue({
      nodes: [
        { slug: "concepts/from-disk", title: "From Disk", type: "concept" },
        { slug: "concepts/other", title: "Other", type: "concept" },
      ],
      edges: [{ from: "concepts/from-disk", to: "concepts/other", linkType: "wikilink", context: null }],
      pagesScanned: 2,
      truncated: false,
    });

    const res = await request("concepts", "from-disk");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.source).toBe("local");
    expect(body.degraded).toBe(true);
    expect(body.note).toMatch(/unreachable/);
    expect(body.page.body).toContain("From Disk");
    expect(body.links).toEqual([
      { slug: "concepts/other", title: "Other", linkType: "wikilink", context: null },
    ]);
  });

  it("still renders the page when one link read fails", async () => {
    withGbrain({
      getBacklinks: vi.fn(async () => {
        throw new Error("GBrain MCP HTTP 500 (get_backlinks)");
      }),
    });

    const res = await request("concepts", "litellm-gateway");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.page.body).toBe(PAGE.body);
    // Outbound links survive; only the failed direction degrades to empty.
    expect(body.links).toHaveLength(2);
    expect(body.backlinks).toEqual([]);
    expect(logEvent).toHaveBeenCalledWith(
      "pages.gbrain.links.error",
      expect.objectContaining({ which: "backlinks" }),
    );
  });
});
