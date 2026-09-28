// SPDX-License-Identifier: MIT
/**
 * GBrainMcpClient.listPages — the `list_pages` half of the MCP adapter.
 *
 * The wire shape pinned here is the one the LIVE server returns (probed
 * 2026-09-28 against the deployment's own MCP endpoint): an SSE `data:` line
 * whose `result.content[0].text` is a JSON array of
 * `{slug, source_id, type, title, updated_at}` rows. A fake `fetch` is enough
 * because the adapter's job IS the translation — the transport is one
 * `fetch` call and the JSON-RPC envelope is the part that breaks silently.
 *
 * What matters and is asserted:
 *   - the tool name and arguments (`list_pages`, with limit/offset/type/sort
 *     passed only when asked for);
 *   - `slug` is REQUIRED per row (a row without one can be neither read nor
 *     linked to, so it is dropped rather than emitted as a broken page);
 *   - `source_id` / `updated_at` map to `sourceId` / `updatedAt`, null when
 *     the tool omits them;
 *   - a malformed / empty payload degrades to [] rather than throwing.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

import { GBrainMcpClient } from "../src/gbrain-mcp/gbrain-mcp-client";

const ROWS = [
  {
    slug: "concepts/litellm-gateway",
    source_id: "default",
    type: "concept",
    title: "LiteLLM Gateway",
    updated_at: "2026-09-23T05:47:55.889Z",
  },
  {
    slug: "people/example-person",
    source_id: "default",
    type: "person",
    title: "Example Person",
    updated_at: "2026-09-22T05:00:00.000Z",
  },
];

/** One SSE reply carrying `text` as the tool's content block. */
function sse(text: string): Response {
  const body = `event: message\ndata: ${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text }] },
  })}\n\n`;
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function stubFetch(payload: string) {
  const fetchMock = vi.fn(async () => sse(payload));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The `tools/call` params the client sent. */
function sentParams(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  const body = JSON.parse(String(init.body)) as { params: Record<string, unknown> };
  return body.params;
}

function client() {
  return new GBrainMcpClient({ url: "https://gbrain.example.test/mcp", apiKey: "test-key" });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GBrainMcpClient.listPages", () => {
  it("maps the live row shape, camelCasing the fields the port declares", async () => {
    stubFetch(JSON.stringify(ROWS));

    const pages = await client().listPages();

    expect(pages).toEqual([
      {
        slug: "concepts/litellm-gateway",
        title: "LiteLLM Gateway",
        type: "concept",
        sourceId: "default",
        updatedAt: "2026-09-23T05:47:55.889Z",
      },
      {
        slug: "people/example-person",
        title: "Example Person",
        type: "person",
        sourceId: "default",
        updatedAt: "2026-09-22T05:00:00.000Z",
      },
    ]);
    // No bodies cross this call — the index is a catalogue.
    for (const p of pages) expect(p).not.toHaveProperty("body");
  });

  it("calls the list_pages tool and forwards only the arguments it was given", async () => {
    const fetchMock = stubFetch(JSON.stringify(ROWS));

    await client().listPages();

    const params = sentParams(fetchMock);
    expect(params.name).toBe("list_pages");
    // Omitted options must not be sent as undefined keys.
    expect(params.arguments).toEqual({});
  });

  it("forwards limit, offset, type and sort when supplied", async () => {
    const fetchMock = stubFetch(JSON.stringify(ROWS));

    await client().listPages({ limit: 25, offset: 100, type: "concept", sort: "slug" });

    expect(sentParams(fetchMock).arguments).toEqual({
      limit: 25,
      offset: 100,
      type: "concept",
      sort: "slug",
    });
  });

  it("drops a row with no slug rather than emitting a page nothing can open", async () => {
    stubFetch(
      JSON.stringify([
        { source_id: "default", type: "concept", title: "No Slug", updated_at: null },
        ROWS[0],
      ]),
    );

    const pages = await client().listPages();

    expect(pages).toHaveLength(1);
    expect(pages[0].slug).toBe("concepts/litellm-gateway");
  });

  it("nulls sourceId/updatedAt when the tool omits them", async () => {
    stubFetch(JSON.stringify([{ slug: "concepts/bare", title: "Bare", type: "concept" }]));

    const [page] = await client().listPages();

    expect(page).toEqual({
      slug: "concepts/bare",
      title: "Bare",
      type: "concept",
      sourceId: null,
      updatedAt: null,
    });
  });

  it("degrades a malformed payload to an empty list instead of throwing", async () => {
    stubFetch("not json at all");

    await expect(client().listPages()).resolves.toEqual([]);
  });

  it("degrades a non-array JSON payload to an empty list", async () => {
    stubFetch(JSON.stringify({ unexpected: "object" }));

    await expect(client().listPages()).resolves.toEqual([]);
  });

  it("throws a typed transport error when the endpoint fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream down", { status: 503 })));

    await expect(client().listPages()).rejects.toThrow(/503/);
  });
});
