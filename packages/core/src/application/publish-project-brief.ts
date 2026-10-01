// SPDX-License-Identifier: MIT
/**
 * PublishProjectBrief — put one project's synthesized brief into gbrain's
 * proposal queue.
 *
 * WHY THIS IS A USE CASE AND NOT A ROUTE BODY
 * -------------------------------------------
 * Three separate things have to be true for a publish to be honest: the brief must
 * be a SYNTHESIS (not a mechanical digest), the row must carry its provenance, and
 * a second publish of the same brief must not spam the operator's queue. All three
 * are rules, and rules live in `core` where a test needs no database, no model and
 * no framework. The route below it does auth, validates, calls this, and maps one
 * typed outcome to one status.
 *
 * WHY THE BRIEF IS INJECTED RATHER THAN RE-SYNTHESIZED
 * ----------------------------------------------------
 * "Publish this brief" and "publish some brief" are different verbs, and only the
 * first one is a decision a human made. The caller hands over the exact brief it
 * is looking at; this class never calls a model, so pressing Publish twice on one
 * page cannot publish two different texts.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not promote anything. It emits a `kind = 'brief'` proposal into the same
 * queue every other proposal rides, and the operator decides. Publishing is a
 * proposal, never a write to the brain.
 */

import {
  BRIEF_PROPOSAL_KIND,
  BriefPublishError,
  buildBriefPublishRow,
  type PublishableBrief,
  type PublishableProject,
} from "../domain/brief-publish";
import type { ProposeOutcome, ProposalQueue } from "../ports";

export interface PublishProjectBriefInput {
  brief: PublishableBrief;
  /** Null when the project does not resolve for the caller (or has no brain page). */
  project: PublishableProject | null;
  /** Overrides the gbrain source the proposal is addressed to. */
  sourceId?: string;
  /** Titles (never bodies) of the linked notes the brief was built from. */
  evidenceNoteTitles?: readonly string[];
}

export interface PublishProjectBriefResult {
  /** True when this call inserted the row; false when the SAME brief was already proposed. */
  created: boolean;
  /** The row either way — a duplicate returns the one already in the queue. */
  proposalId: number;
  pageSlug: string;
  /** The content hash the queue keyed on. Reported so a caller can be verified. */
  contentHash: string;
  /** The provenance that was written, echoed for the response. */
  modelId: string;
  generatedAt: string;
}

export class PublishProjectBrief {
  constructor(private readonly queue: ProposalQueue) {}

  async execute(input: PublishProjectBriefInput): Promise<PublishProjectBriefResult> {
    // `buildBriefPublishRow` is also the guard: it refuses a fallback, a missing
    // project, an empty brief and an unpublishable claim, each with a typed code.
    const row = buildBriefPublishRow({
      brief: input.brief,
      project: input.project as PublishableProject,
      ...(input.sourceId ? { sourceId: input.sourceId } : {}),
      ...(input.evidenceNoteTitles ? { evidenceNoteTitles: input.evidenceNoteTitles } : {}),
    });

    // The publisher's own kind, asserted here so a future edit to the builder
    // cannot quietly publish a brief as a take.
    if (row.kind !== BRIEF_PROPOSAL_KIND) {
      throw new BriefPublishError({
        code: "empty_brief",
        message: "The brief publish row was built with the wrong kind.",
      });
    }

    const outcome: ProposeOutcome = await this.queue.propose({
      sourceId: row.sourceId,
      pageSlug: row.pageSlug,
      contentHash: row.contentHash,
      promptVersion: row.promptVersion,
      waveVersion: row.waveVersion,
      runId: row.runId,
      claimText: row.claimText,
      kind: row.kind,
      holder: row.holder,
      weight: row.weight,
      domain: row.domain,
      modelId: row.modelId,
      planDiff: row.briefDiff,
    });

    return {
      created: outcome.created,
      proposalId: outcome.proposal.id,
      pageSlug: row.pageSlug,
      contentHash: row.contentHash,
      modelId: row.modelId,
      generatedAt: row.briefDiff.generated_at,
    };
  }
}
