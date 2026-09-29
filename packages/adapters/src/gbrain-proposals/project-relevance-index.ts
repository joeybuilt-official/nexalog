// SPDX-License-Identifier: MIT
/**
 * GbrainProjectRelevanceIndex — "which project page is this capture about?" asked
 * of the brain's OWN index instead of a new similarity stack.
 *
 * THE SIGNAL, AND WHY IT IS THIS ONE
 * ----------------------------------
 * gbrain already embeds every page (1024-dim, qwen3 via the gateway) and serves a
 * hybrid vector+keyword search over them. The app already holds a client for that
 * (`GBrainClient`), so a plan-impact reconciler can ask a question the index is
 * built to answer and read the relevance off the response. Nothing here computes
 * an embedding, calls a model, or reads a second store: this adapter's entire job
 * is to narrow a generic search into "project pages, with their cosine".
 *
 * WHY `cosine` AND NOT `score`
 * ----------------------------
 * gbrain's `score` is the RRF-FUSED rank score. Measured on the live index: a
 * sourdough recipe scored 0.81 against `projects/panoply` because RRF folds in
 * backlink boosts and graph adjacency — every project page in this brain links to
 * every other one, so they all get a boost on every query. A threshold on `score`
 * would therefore emit a plan change for every bookmark ever saved. `score` also
 * moves with corpus size. `cosine` is a property of the query and the page alone,
 * and it separates cleanly on the same data (about-a-project: 0.65-0.78;
 * unrelated: ≤0.46). So the relevance claim is made on cosine or not at all.
 *
 * WHY THE QUERY IS BUILT FROM THE CAPTURE, NOT FROM THE PROJECT
 * ------------------------------------------------------------
 * The alternative — walk every project page and score the capture against each —
 * costs one search per project per capture and needs a cross-store comparison to
 * rank the results. Searching with the CAPTURE's own text asks the index the
 * question it is designed for ("what is near this?") and lets gbrain's own fusion
 * do the ranking; the filter to `type: project` is what narrows the answer set.
 * It is also one round trip per capture rather than N.
 *
 * A FAILED CALL IS NOT AN EMPTY RESULT
 * ------------------------------------
 * If gbrain is unreachable the reconciler must propose NOTHING and say why — never
 * treat "I could not ask" as "nothing is relevant", which is how a quiet surface
 * reads as a healthy one. The client contract already throws on transport failure,
 * so this adapter lets that propagate: the caller (the run script / worker) reports
 * it as a failed pass. The one case this adapter DOES swallow is a per-hit parsing
 * miss — a hit without a usable slug is dropped, because one malformed row must not
 * fail a whole run.
 */

import { type ProjectCandidate, type ProjectRelevanceIndex } from "@nexalog/core";

/**
 * The slice of `GBrainClient` this adapter needs. Narrowed deliberately (not the
 * whole client): the reconciler's dependency is "a thing that can search", and a
 * port that names only what it uses cannot silently grow into a second composition
 * root.
 */
export interface ProjectRelevanceClient {
  search(
    query: string,
    opts?: { limit?: number; types?: string[] },
  ): Promise<
    Array<{
      slug: string;
      title: string;
      type: string;
      score: number | null;
      cosine?: number | null;
    }>
  >;
}

export interface GbrainProjectRelevanceIndexOptions {
  client: ProjectRelevanceClient;
  /** The page type gbrain tags project pages with. */
  projectType?: string;
}

const DEFAULT_PROJECT_TYPE = "project";

export class GbrainProjectRelevanceIndex implements ProjectRelevanceIndex {
  private readonly client: ProjectRelevanceClient;
  private readonly projectType: string;

  constructor(opts: GbrainProjectRelevanceIndexOptions) {
    this.client = opts.client;
    this.projectType = opts.projectType ?? DEFAULT_PROJECT_TYPE;
  }

  async findProjectCandidates(input: {
    text: string;
    limit: number;
  }): Promise<ProjectCandidate[]> {
    const query = input.text.trim();
    if (query === "") return [];

    const hits = await this.client.search(query, {
      limit: Math.max(1, input.limit),
      // The type filter is pushed DOWN to the search, not applied after it: gbrain
      // ranks over the whole corpus, so a post-filter with `limit: 8` would return
      // the project pages that happened to survive eight slots shared with every
      // note and atom in the brain.
      types: [this.projectType],
    });

    const out: ProjectCandidate[] = [];
    for (const hit of hits) {
      if (!hit.slug || !hit.slug.trim()) continue;
      out.push({
        slug: hit.slug,
        title: hit.title ?? "",
        // Deliberately nullable: a server that does not report a cosine produces
        // no relevance claim downstream rather than a default that invents one.
        cosine: typeof hit.cosine === "number" && Number.isFinite(hit.cosine) ? hit.cosine : null,
      });
    }
    return out;
  }
}
