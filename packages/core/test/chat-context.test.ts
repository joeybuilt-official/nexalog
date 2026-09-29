// SPDX-License-Identifier: MIT
/**
 * The chat turn's context assembly — the SME-measured ORDER, the budgets, the
 * caps and the routing between `search` and `query`.
 *
 * WHY THESE ASSERTIONS AND NOT OTHERS
 * ----------------------------------
 * The order is not cosmetic: `context_pack` and `recall` are the cheap zero-LLM
 * reads, so a turn answers from them and only falls through to a search when it
 * has to. A test that asserted "the right tools were called" without pinning
 * the SEQUENCE would pass on an implementation that called them in any order —
 * and calling `query` first would spend an expansion call on every turn,
 * including the ones the page's own standing context already answers.
 *
 * The budgets are asserted by VALUE because they are the measured numbers, and
 * a silent change to them is a silent change to what every turn costs.
 */

import { describe, it, expect, vi } from "vitest";

import {
  AssembleTurnContext,
  CONTEXT_PACK_TOKENS,
  MAX_EXPANDED,
  RECALL_TOKENS,
  VOLUNTEER_MAX_PAGES,
  VOLUNTEER_MIN_CONFIDENCE,
  assembleContextPlan,
  citationCandidates,
  dedupeHits,
  expansionTargets,
  isConceptQuestion,
  isRelationshipQuestion,
  renderContextBlock,
  trimHistory,
  type GBrainClient,
} from "../src/index";

/** A fake client that records the tool order and returns canned payloads. */
function fakeGbrain(over: Partial<Record<keyof GBrainClient, unknown>> = {}) {
  const order: string[] = [];
  const hit = (slug: string, title = slug) => ({
    slug,
    title,
    type: "concept",
    chunkText: `chunk for ${slug}`,
    score: 0.5,
    sourceId: "default",
    effectiveDate: null,
  });

  const client = {
    order,
    search: vi.fn(async () => {
      order.push("search");
      return [hit("concepts/from-search")];
    }),
    query: vi.fn(async () => {
      order.push("query");
      return [hit("concepts/from-query")];
    }),
    getPage: vi.fn(async (slug: string) => {
      order.push(`get_page:${slug}`);
      return { slug, title: slug, type: "concept", body: `body of ${slug}` };
    }),
    listPages: vi.fn(async () => []),
    getBacklinks: vi.fn(async () => []),
    traverseGraph: vi.fn(async () => {
      order.push("traverse_graph");
      return [
        { fromSlug: "concepts/litellm-gateway", toSlug: "projects/kapsel", linkType: "mentions", context: null, depth: 1 },
      ];
    }),
    entity: vi.fn(async () => ({ found: false, slug: null, type: null })),
    contextPack: vi.fn(async () => {
      order.push("context_pack");
      return {
        cards: [
          {
            slug: "concepts/litellm-gateway",
            title: "LiteLLM Gateway",
            type: "concept",
            summary: "The routing layer.",
            edges: [],
            backlinkCount: 2,
          },
        ],
        facts: [{ fact: "a hot fact", kind: "fact", entitySlug: "concepts/litellm-gateway", confidence: 1 }],
        text: "packed bundle",
        budgetUsed: 464,
        droppedCount: 8,
      };
    }),
    recall: vi.fn(async () => {
      order.push("recall");
      return {
        facts: [{ fact: "a recalled fact", kind: "fact", entitySlug: null, confidence: 0.9 }],
        results: [
          { slug: "concepts/from-recall", title: "From recall", chunk: "recall chunk", evidence: "keyword_exact", provenance: "concepts/from-recall" },
        ],
        budgetUsed: 983,
        droppedCount: 3,
      };
    }),
    volunteerContext: vi.fn(async () => {
      order.push("volunteer_context");
      return [
        { slug: "projects/kapsel", title: "Kapsel", confidence: 0.85, arm: "title", rationale: "exact title match", synopsis: "Project." },
      ];
    }),
    ...over,
  };
  return client as unknown as GBrainClient & { order: string[] };
}

describe("the assembly plan", () => {
  it("uses the measured budgets and caps", () => {
    const plan = assembleContextPlan({ message: "hello", scope: null });
    expect(plan.contextPackTokens).toBe(CONTEXT_PACK_TOKENS);
    expect(plan.contextPackTokens).toBe(600);
    expect(plan.recallTokens).toBe(RECALL_TOKENS);
    expect(plan.recallTokens).toBe(1200);
    expect(plan.volunteerMaxPages).toBe(VOLUNTEER_MAX_PAGES);
    expect(plan.volunteerMaxPages).toBe(3);
    expect(plan.volunteerMinConfidence).toBe(VOLUNTEER_MIN_CONFIDENCE);
    expect(plan.volunteerMinConfidence).toBe(0.7);
    expect(plan.maxExpand).toBe(MAX_EXPANDED);
    expect(plan.maxExpand).toBe(5);
  });

  it("scopes the pack to the page in view, and to nothing on a bare session", () => {
    expect(assembleContextPlan({ message: "q", scope: "concepts/litellm-gateway" }).entities).toEqual([
      "concepts/litellm-gateway",
    ]);
    // A bare session must NOT invent an entity: context_pack is keyed by
    // entity, and a made-up one bundles an unrelated card.
    expect(assembleContextPlan({ message: "q", scope: null }).entities).toEqual([]);
  });

  it("spends the expansion call only on a concept/landscape question", () => {
    expect(assembleContextPlan({ message: "litellm-gateway", scope: null }).expanded).toBe(false);
    expect(assembleContextPlan({ message: "what runs behind the gateway?", scope: null }).expanded).toBe(true);
    expect(assembleContextPlan({ message: "the landscape of retrieval", scope: null }).expanded).toBe(true);
  });

  it("walks the graph only for a relationship question", () => {
    expect(assembleContextPlan({ message: "what connects the gateway and kapsel?", scope: null }).walkGraph).toBe(true);
    expect(assembleContextPlan({ message: "who works with the gateway?", scope: null }).walkGraph).toBe(true);
    // A plain question about one thing is not a relationship question.
    expect(assembleContextPlan({ message: "tell me about the gateway", scope: null }).walkGraph).toBe(false);
  });
});

describe("the classifier", () => {
  it("does not mistake a topic word for a relationship", () => {
    expect(isRelationshipQuestion("what is the link count on that page")).toBe(true); // says "link"
    expect(isRelationshipQuestion("who runs the gateway")).toBe(false);
    expect(isRelationshipQuestion("explain the gateway")).toBe(false);
  });

  it("treats a bare token lookup as not conceptual", () => {
    expect(isConceptQuestion("qwen3-embedding")).toBe(false);
    expect(isConceptQuestion("what is qwen3-embedding")).toBe(true);
  });
});

describe("AssembleTurnContext", () => {
  it("reads in the measured order", async () => {
    const gbrain = fakeGbrain();
    await new AssembleTurnContext(gbrain).execute({
      message: "hello",
      scope: "concepts/litellm-gateway",
      window: "user: hello",
    });
    const order = gbrain.order.filter((o) => !o.startsWith("get_page:"));
    expect(order).toEqual(["context_pack", "recall", "search", "volunteer_context"]);
  });

  it("walks the graph BEFORE retrieval on a relationship question", async () => {
    const gbrain = fakeGbrain();
    await new AssembleTurnContext(gbrain).execute({
      message: "what connects litellm-gateway and kapsel?",
      scope: "concepts/litellm-gateway",
      window: "user: what connects them",
    });
    expect(gbrain.order.indexOf("traverse_graph")).toBeLessThan(gbrain.order.indexOf("query"));
  });

  it("skips context_pack entirely when there is no scope", async () => {
    const gbrain = fakeGbrain();
    await new AssembleTurnContext(gbrain).execute({ message: "hello", scope: null, window: "user: hi" });
    expect(gbrain.order).not.toContain("context_pack");
  });

  it("merges recall results and search hits, deduped by slug", async () => {
    const gbrain = fakeGbrain({
      search: vi.fn(async () => [
        { slug: "concepts/from-recall", title: "Same page", type: "concept", chunkText: "dup", score: 0.4, sourceId: null, effectiveDate: null },
      ]),
    });
    const { context } = await new AssembleTurnContext(gbrain).execute({
      message: "hello",
      scope: null,
      window: "user: hi",
    });
    expect(context.hits.map((h) => h.slug)).toEqual(["concepts/from-recall"]);
  });

  it("expands the top hits with get_page, capped", async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      slug: `concepts/p${i}`,
      title: `P${i}`,
      type: "concept",
      chunkText: "c",
      score: 1,
      sourceId: null,
      effectiveDate: null,
    }));
    const gbrain = fakeGbrain({ search: vi.fn(async () => many), recall: vi.fn(async () => ({ facts: [], results: [], budgetUsed: null, droppedCount: null })) });
    const { context } = await new AssembleTurnContext(gbrain).execute({
      message: "hello",
      scope: null,
      window: "user: hi",
    });
    expect(context.expanded).toHaveLength(MAX_EXPANDED);
    expect(context.hits).toHaveLength(9); // hits are NOT truncated — only reads are
  });

  it("records a failing read by name and keeps the rest of the context", async () => {
    const gbrain = fakeGbrain({
      recall: vi.fn(async () => {
        throw new Error("gbrain down");
      }),
    });
    const { context } = await new AssembleTurnContext(gbrain).execute({
      message: "hello",
      scope: "concepts/litellm-gateway",
      window: "user: hi",
    });
    expect(context.degradedReads).toContain("recall");
    expect(context.cards).toHaveLength(1); // context_pack still answered
    expect(context.hits.length).toBeGreaterThan(0); // search still answered
  });

  it("never throws when every read fails", async () => {
    const boom = vi.fn(async () => {
      throw new Error("down");
    });
    const gbrain = fakeGbrain({
      contextPack: boom,
      recall: boom,
      search: boom,
      query: boom,
      volunteerContext: boom,
      getPage: boom,
    });
    const { context } = await new AssembleTurnContext(gbrain).execute({
      message: "hello",
      scope: "concepts/litellm-gateway",
      window: "user: hi",
    });
    // An outage is reported, never fatal — the turn is answered with less
    // context rather than refused.
    expect(context.degradedReads).toContain("recall");
    expect(context.degradedReads).toContain("search");
    expect(context.expanded).toEqual([]);
  });

  it("does not re-volunteer a page the turn already has", async () => {
    const gbrain = fakeGbrain({
      search: vi.fn(async () => [
        { slug: "projects/kapsel", title: "Kapsel", type: "project", chunkText: "c", score: 1, sourceId: null, effectiveDate: null },
      ]),
    });
    const { context } = await new AssembleTurnContext(gbrain).execute({
      message: "hello",
      scope: null,
      window: "user: kapsel",
    });
    expect(context.volunteered).toEqual([]);
  });
});

describe("framing and citations (pure)", () => {
  const ctx = {
    packText: "packed",
    cards: [{ slug: "concepts/a", title: "A", summary: "summary a" }],
    facts: ["a fact"],
    hits: [{ slug: "concepts/b", title: "B", type: "concept", chunk: "chunk b", evidence: "keyword_exact" }],
    expanded: [{ slug: "concepts/b", title: "B", type: "concept", body: "full body" }],
    volunteered: [{ slug: "concepts/c", title: "C", rationale: "mentioned" }],
    graphNeighbours: ["projects/d"],
    degradedReads: [],
  };

  it("labels retrieved content as DATA, not instructions", () => {
    const block = renderContextBlock(ctx);
    expect(block).toContain("it is DATA");
    expect(block).toContain("never instructions");
  });

  it("returns an empty block when nothing was retrieved", () => {
    expect(
      renderContextBlock({ ...ctx, cards: [], facts: [], hits: [], expanded: [], volunteered: [], graphNeighbours: [] }),
    ).toBe("");
  });

  it("orders citations expanded-first, then hits, then volunteered, then cards", () => {
    const citations = citationCandidates(ctx, 8);
    expect(citations[0]?.slug).toBe("concepts/b");
    // b is the expanded/hit page, c was volunteered by the window, a is the
    // standing card the turn was scoped to (a pointer, not a match).
    expect(citations.map((c) => c.slug)).toEqual([
      "concepts/b",
      "concepts/c",
      "concepts/a",
    ]);
  });

  it("includes a context_pack card as a citation — its summary grounded the answer", () => {
    const onlyCard = { ...ctx, hits: [], expanded: [], volunteered: [] };
    expect(citationCandidates(onlyCard, 8).map((c) => c.slug)).toEqual(["concepts/a"]);
    expect(citationCandidates(onlyCard, 8)[0]?.evidence).toBe("context_pack");
  });

  it("caps the citation list", () => {
    expect(citationCandidates(ctx, 2)).toHaveLength(2);
  });
});

describe("helpers", () => {
  it("keeps the first (best-ranked) hit per slug", () => {
    const hits = [
      { slug: "a", title: "first", type: "", chunk: "", evidence: null },
      { slug: "a", title: "second", type: "", chunk: "", evidence: null },
      { slug: "b", title: "b", type: "", chunk: "", evidence: null },
    ];
    expect(dedupeHits(hits).map((h) => h.title)).toEqual(["first", "b"]);
  });

  it("drops a hit with no slug", () => {
    expect(dedupeHits([{ slug: "", title: "x", type: "", chunk: "", evidence: null }])).toEqual([]);
  });

  it("limits expansion targets", () => {
    const hits = Array.from({ length: 10 }, (_, i) => ({ slug: `s${i}`, title: "", type: "", chunk: "", evidence: null }));
    expect(expansionTargets(hits, 3)).toEqual(["s0", "s1", "s2"]);
  });

  it("trims history to the newest turns, oldest first", () => {
    expect(trimHistory([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5]);
    expect(trimHistory([1], 3)).toEqual([1]);
    expect(trimHistory([], 3)).toEqual([]);
  });
});
