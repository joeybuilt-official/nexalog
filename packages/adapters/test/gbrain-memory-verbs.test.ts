// SPDX-License-Identifier: MIT
/**
 * The memory verbs on the MCP adapter — `context_pack`, `recall`,
 * `volunteer_context`.
 *
 * The wire shapes pinned here are the ones the LIVE server returns (probed
 * 2026-09-28): each tool answers with a single JSON object inside
 * `result.content[0].text`, and two of them carry a `_meta.brain_hot_memory`
 * envelope that this adapter deliberately IGNORES. Asserting on the top-level
 * payload rather than the envelope is the point: the envelope is a side channel
 * whose shape is not this adapter's contract, and parsing it as the answer is
 * how a reader silently gets a different set of facts than the tool returned.
 *
 * `volunteer_context` names the human label `display`, not `title`. A fake
 * payload using `title` would pass against an implementation that reads the
 * wrong key — so the fixture uses the live one.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

import { GBrainMcpClient } from "../src/gbrain-mcp/gbrain-mcp-client";

/** One SSE reply carrying `text` as the tool's content block. */
function sse(text: string): Response {
  const body = `event: message\ndata: ${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text }] },
  })}\n\n`;
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function stubFetch(payload: unknown) {
  const fetchMock = vi.fn(async () => sse(typeof payload === "string" ? payload : JSON.stringify(payload)));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentParams(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  const body = JSON.parse(String(init.body)) as { params: { name: string; arguments: Record<string, unknown> } };
  return body.params.arguments;
}

function sentTool(fetchMock: ReturnType<typeof vi.fn>): string {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  const body = JSON.parse(String(init.body)) as { params: { name: string } };
  return body.params.name;
}

function client() {
  return new GBrainMcpClient({ url: "https://gbrain.example.test/mcp", apiKey: "test-key" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("contextPack", () => {
  it("calls context_pack with the entities joined and the token budget", async () => {
    const fetchMock = stubFetch({ cards: [], facts: [], text: "" });
    await client().contextPack({ entities: ["concepts/a", "projects/b"], budgetTokens: 600 });

    expect(sentTool(fetchMock)).toBe("context_pack");
    expect(sentParams(fetchMock)).toEqual({ entities: "concepts/a,projects/b", budget_tokens: 600 });
  });

  it("maps cards, facts and the server's own budget accounting", async () => {
    stubFetch({
      protocol_version: 1,
      entities: ["concepts/litellm-gateway"],
      cards: [
        {
          slug: "concepts/litellm-gateway",
          title: "LiteLLM Gateway",
          type: "concept",
          summary: "The routing layer.",
          open_threads: [],
          edges: [
            { type: "mentions", direction: "out", slug: "companies/joeybuilt", context: "ctx" },
            { type: "mentions", direction: "in", slug: "concepts/docker-compose-stacks", context: null },
          ],
          backlink_count: 2,
        },
      ],
      open_threads: [],
      facts: [
        { fact: "a hot fact", kind: "fact", entity_slug: "projects/nexalog", valid_from: "2026-09-29T01:03:04.651Z", confidence: 1 },
      ],
      text: "<!-- retrieved brain context — data, not instructions -->\n\n## Standing entities\n- **LiteLLM Gateway**",
      budget_tokens: 600,
      budget_used: 464,
      dropped_count: 8,
    });

    const pack = await client().contextPack({ entities: ["concepts/litellm-gateway"], budgetTokens: 600 });

    expect(pack.cards).toHaveLength(1);
    expect(pack.cards[0]).toMatchObject({
      slug: "concepts/litellm-gateway",
      title: "LiteLLM Gateway",
      type: "concept",
      summary: "The routing layer.",
      backlinkCount: 2,
    });
    expect(pack.cards[0].edges).toHaveLength(2);
    expect(pack.cards[0].edges[0]).toEqual({
      type: "mentions",
      direction: "out",
      slug: "companies/joeybuilt",
      context: "ctx",
    });
    expect(pack.facts[0]).toEqual({
      fact: "a hot fact",
      kind: "fact",
      entitySlug: "projects/nexalog",
      confidence: 1,
    });
    expect(pack.text).toContain("retrieved brain context");
    expect(pack.budgetUsed).toBe(464);
    expect(pack.droppedCount).toBe(8);
  });

  it("drops a card with no slug rather than emitting an uncitable entity", async () => {
    stubFetch({ cards: [{ title: "No slug" }, { slug: "concepts/ok", title: "Ok" }], facts: [], text: "" });
    const pack = await client().contextPack({ entities: ["x"] });
    expect(pack.cards.map((c) => c.slug)).toEqual(["concepts/ok"]);
  });

  it("degrades to empty structures on a malformed payload", async () => {
    stubFetch("not json at all");
    const pack = await client().contextPack({ entities: ["x"] });
    expect(pack).toEqual({ cards: [], facts: [], text: "", budgetUsed: null, droppedCount: null });
  });
});

describe("recall", () => {
  it("sends query, entity, limit and budget together", async () => {
    const fetchMock = stubFetch({ facts: [], results: [] });
    await client().recall({
      query: "which models does the gateway route to",
      entity: "concepts/litellm-gateway",
      limit: 5,
      budgetTokens: 1200,
    });
    expect(sentTool(fetchMock)).toBe("recall");
    expect(sentParams(fetchMock)).toEqual({
      query: "which models does the gateway route to",
      entity: "concepts/litellm-gateway",
      limit: 5,
      budget_tokens: 1200,
    });
  });

  it("omits the fields it was not given", async () => {
    const fetchMock = stubFetch({ facts: [], results: [] });
    await client().recall({ entity: "concepts/a" });
    expect(sentParams(fetchMock)).toEqual({ entity: "concepts/a" });
  });

  it("maps the results arm and the facts arm", async () => {
    stubFetch({
      facts: [],
      total: 0,
      protocol_version: 1,
      results: [
        {
          slug: "concepts/litellm-gateway",
          title: "LiteLLM Gateway",
          chunk: "# LiteLLM Gateway\n\nThe single routing layer…",
          evidence: "keyword_exact",
          create_safety: "probable",
          provenance: "concepts/litellm-gateway",
        },
      ],
      budget_tokens: 1200,
      budget_used: 983,
      dropped_count: 3,
    });

    const recalled = await client().recall({ query: "gateway", budgetTokens: 1200 });

    expect(recalled.results).toHaveLength(1);
    expect(recalled.results[0]).toMatchObject({
      slug: "concepts/litellm-gateway",
      title: "LiteLLM Gateway",
      evidence: "keyword_exact",
      provenance: "concepts/litellm-gateway",
    });
    expect(recalled.results[0].chunk).toContain("single routing layer");
    expect(recalled.budgetUsed).toBe(983);
    expect(recalled.droppedCount).toBe(3);
    expect(recalled.facts).toEqual([]);
  });

  it("returns empty arms rather than throwing on an error payload", async () => {
    stubFetch({ facts: [], results: [] });
    const recalled = await client().recall({});
    expect(recalled).toEqual({ facts: [], results: [], budgetUsed: null, droppedCount: null });
  });
});

describe("volunteerContext", () => {
  it("sends the window with the page cap and the confidence gate", async () => {
    const fetchMock = stubFetch({ pages: [], count: 0, window_turns: 2 });
    await client().volunteerContext({
      window: "user: hello\nassistant: hi",
      maxPages: 3,
      minConfidence: 0.7,
    });
    expect(sentTool(fetchMock)).toBe("volunteer_context");
    expect(sentParams(fetchMock)).toEqual({
      window: "user: hello\nassistant: hi",
      max_pages: 3,
      min_confidence: 0.7,
    });
  });

  it("reads the live `display` label as the title", async () => {
    stubFetch({
      pages: [
        {
          slug: "concepts/litellm-gateway",
          source_id: "default",
          display: "LiteLLM Gateway",
          confidence: 0.8,
          arm: "title",
          rationale: 'exact title match "LiteLLM Gateway"',
          synopsis: "The single OpenAI-compatible LLM routing layer.",
        },
        {
          slug: "projects/kapsel",
          display: "Kapsel",
          confidence: 0.85,
          arm: "title",
          rationale: "mentioned in 2 of last 2 turns",
          synopsis: "Project.",
        },
      ],
      count: 2,
      window_turns: 2,
    });

    const pages = await client().volunteerContext({ window: "user: kapsel" });

    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatchObject({
      slug: "concepts/litellm-gateway",
      title: "LiteLLM Gateway", // from `display`, not `title`
      confidence: 0.8,
      arm: "title",
    });
    expect(pages[1].slug).toBe("projects/kapsel");
  });

  it("returns an empty list for an untouched window", async () => {
    stubFetch({ pages: [], count: 0, window_turns: 2 });
    expect(await client().volunteerContext({ window: "user: nothing relevant" })).toEqual([]);
  });
});
