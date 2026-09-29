// SPDX-License-Identifier: MIT
/**
 * AssembleTurnContext — one turn's grounding, read from gbrain in the measured
 * order. Lives in core so the ORDER, the budgets and the failure behaviour are
 * the domain's, not a route's; the only thing it touches is the `GBrainClient`
 * port, so it runs against a fake in tests and against the MCP adapter in prod.
 *
 * THE ORDER (and why it is this order)
 * ------------------------------------
 *   context_pack (600) → recall (1200) → [graph walk, relationship turns only]
 *   → search | query → expand the top hits with get_page → volunteer_context
 *
 * `context_pack` and `recall` come first because they are the cheap, zero-LLM,
 * server-packed reads: a turn that can be answered from the page's own standing
 * context should not pay for retrieval. The graph walk is conditional because
 * the live brain's typed links are sparse. `volunteer_context` runs LAST and is
 * a net, not a source: it matches pages the recent WINDOW names, so it is the
 * right way to catch something the current question's phrasing lost.
 *
 * EVERY READ IS INDEPENDENTLY DEGRADABLE. gbrain being slow or down on one tool
 * must not cost the turn its other grounding, and it must never throw into the
 * chat stream — a turn answered with less context is normal; a turn that fails
 * because the graph was empty is not. Each failure is recorded by NAME in
 * `degradedReads` so the surface can state it rather than pretend it ran.
 *
 * What is NOT here, on purpose: no provider call (this is retrieval only), no
 * `synthesize`/`think` (expensive, background-only), and no second embedding
 * path — every read goes through the existing MCP client.
 */

import type {
  GBrainClient,
  GBrainContextCard,
  GBrainRecallResult,
  GBrainSearchHit,
} from "../ports";
import {
  assembleContextPlan,
  dedupeHits,
  expansionTargets,
  type AssembledContext,
  type ExpandedPage,
  type TurnHit,
} from "./assemble-context";

export interface AssembleTurnContextInput {
  /** The user's turn, verbatim. */
  message: string;
  /** The brain page the surface is scoped to, or null for a bare session. */
  scope: string | null;
  /** Recent turns, oldest → newest, for the volunteer window. */
  window: string;
}

export interface AssembleTurnContextResult {
  context: AssembledContext;
  /** The plan that was executed — carried so the surface can state its budget. */
  plan: ReturnType<typeof assembleContextPlan>;
}

export class AssembleTurnContext {
  constructor(private readonly gbrain: GBrainClient) {}

  async execute(input: AssembleTurnContextInput): Promise<AssembleTurnContextResult> {
    const plan = assembleContextPlan({ message: input.message, scope: input.scope });
    const degraded: string[] = [];

    const pack = plan.entities.length
      ? await this.read("context_pack", degraded, async () =>
          this.gbrain.contextPack({
            entities: plan.entities,
            budgetTokens: plan.contextPackTokens,
          }),
        )
      : null;

    const recall = await this.read("recall", degraded, async () =>
      this.gbrain.recall({
        query: input.message,
        ...(input.scope ? { entity: input.scope } : {}),
        budgetTokens: plan.recallTokens,
      }),
    );

    // A relationship question walks the graph FIRST — for those, the edge is
    // the answer and a text hit is the fallback, not the other way round.
    const graphNeighbours = plan.walkGraph && input.scope
      ? await this.walk(input.scope, degraded)
      : [];

    // The retrieval leg: `query` (expansion, concept questions) or `search`
    // (exact tokens). Both take the same shape, so the branch is one call.
    const searched = await this.read(plan.expanded ? "query" : "search", degraded, async () =>
      plan.expanded
        ? this.gbrain.query(input.message, { limit: 10 })
        : this.gbrain.search(input.message, { limit: 10 }),
    );

    const hits = dedupeHits([
      ...(recall?.results ?? []).map(fromRecall),
      ...(searched ?? []).map(fromSearchHit),
    ]);

    const targets = expansionTargets(hits, plan.maxExpand);
    const expanded = await this.expand(targets, degraded);

    const volunteered = await this.read("volunteer_context", degraded, async () =>
      this.gbrain.volunteerContext({
        window: input.window,
        maxPages: plan.volunteerMaxPages,
        minConfidence: plan.volunteerMinConfidence,
      }),
    );

    const known = new Set([...expanded.map((p) => p.slug), ...hits.map((h) => h.slug)]);
    const freshVolunteered = (volunteered ?? [])
      .filter((v) => !known.has(v.slug))
      .map((v) => ({ slug: v.slug, title: v.title, rationale: v.rationale }));

    return {
      plan,
      context: {
        packText: pack?.text ?? "",
        cards: (pack?.cards ?? []).map(toCardSummary),
        facts: dedupe([...(pack?.facts ?? []).map((f) => f.fact), ...(recall?.facts ?? []).map((f) => f.fact)]),
        hits,
        expanded,
        volunteered: freshVolunteered,
        graphNeighbours,
        degradedReads: degraded,
      },
    };
  }

  /**
   * Expand the top hits into full pages. A page that fails to read is dropped
   * from `expanded` but stays in `hits` — the citation can still point at the
   * slug, because gbrain DID return it as a match.
   */
  private async expand(slugs: string[], degraded: string[]): Promise<ExpandedPage[]> {
    const out: ExpandedPage[] = [];
    for (const slug of slugs) {
      const page = await this.read(`get_page:${slug}`, degraded, () => this.gbrain.getPage(slug));
      if (page) out.push({ slug: page.slug, title: page.title, type: page.type, body: page.body });
    }
    return out;
  }

  /** One graph walk, deduped to the far-side slugs, bounded. */
  private async walk(slug: string, degraded: string[]): Promise<string[]> {
    const links = await this.read("traverse_graph", degraded, () =>
      this.gbrain.traverseGraph(slug, { depth: 1, direction: "both" }),
    );
    if (!links) return [];
    const seen = new Set<string>();
    for (const l of links) {
      const far = l.fromSlug === slug ? l.toSlug : l.fromSlug;
      if (far && far !== slug) seen.add(far);
    }
    return [...seen].slice(0, 10);
  }

  /**
   * Run one read, recording its failure by name instead of throwing. The ONLY
   * contract this use case owes the caller is a context object: gbrain being
   * down is information the turn reports, not an error it dies of.
   */
  private async read<T>(
    name: string,
    degraded: string[],
    run: () => Promise<T>,
  ): Promise<T | null> {
    try {
      return await run();
    } catch {
      degraded.push(name);
      return null;
    }
  }
}

function toCardSummary(card: GBrainContextCard): {
  slug: string;
  title: string;
  summary: string;
} {
  return { slug: card.slug, title: card.title, summary: card.summary };
}

function fromRecall(r: GBrainRecallResult): TurnHit {
  return {
    slug: r.slug,
    title: r.title,
    type: "",
    chunk: r.chunk,
    evidence: r.evidence,
  };
}

function fromSearchHit(h: GBrainSearchHit): TurnHit {
  return {
    slug: h.slug,
    title: h.title,
    type: h.type,
    chunk: h.chunkText,
    evidence: null,
  };
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter((v) => v.trim().length > 0))];
}
