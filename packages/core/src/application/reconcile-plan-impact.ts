// SPDX-License-Identifier: MIT
/**
 * ReconcilePlanImpact — turn a new capture into ONE adjudicable plan change.
 *
 * WHAT THIS IS FOR
 * ----------------
 * Every other surface in this app answers "what did I save?" or "what does the
 * brain know?". Nothing answered "does this change what I am doing?" — a capture
 * that lands squarely inside an active project sat in the bookmark list while the
 * project's plan page went stale. This use case closes that loop: it looks at the
 * captures inside a window, asks the brain's OWN index which project each one is
 * relevant to, and proposes a plan change for a human to decide on.
 *
 * THE PROPOSAL IS THE OUTPUT. Nothing here writes a plan, edits a page, or takes a
 * take. It emits a `kind = 'plan_change'` row into gbrain's `take_proposals` — the
 * queue PR #21 built, one queue for both kinds — and stops. That is the whole
 * point: an automatically-edited plan is an unreviewable plan, and the reason the
 * 170-row take queue went unread was that it had no decision surface, not that it
 * lacked proposals.
 *
 * IDEMPOTENCY IS STRUCTURAL, NOT REMEMBERED
 * -----------------------------------------
 * The acceptance bar is "a new bookmark produces EXACTLY 1 pending plan_change, and
 * a re-run produces 0 more". This class does not keep a ledger of what it has
 * emitted (a ledger is a second source of truth, and it drifts). Instead every
 * field of the proposal that could vary run-to-run is derived deterministically
 * from the capture, and the queue's own unique index
 * `(source_id, page_slug, content_hash, prompt_version, md5(claim_text))` refuses
 * the second insert. A re-run builds a byte-identical tuple and the database says
 * "already there" — `created: false`, zero new rows. That property survives a
 * crash, a restart, two concurrent runs, and a run on a different machine with a
 * cold cache, none of which a memo would.
 *
 * WHAT IT HONESTLY DOES NOT DO
 * ----------------------------
 * It proposes `op: 'add'` and nothing else. A reconciler that cannot read and
 * INTERPRET the project's plan — and this one makes no model call, by the repo's
 * own boundary — has no business asserting that a milestone should be reprioritized,
 * modified or removed; guessing there would put a confident, wrong, one-click
 * "remove" in front of an operator. What it can state truthfully is "this capture is
 * relevant to this project's plan, here is the evidence, here is the measured
 * closeness" — so that is exactly what it proposes, with `current: null` and
 * `milestone_id: null` rather than invented values.
 */

import {
  PLAN_IMPACT_DOMAIN,
  PLAN_IMPACT_HOLDER,
  PLAN_IMPACT_MODEL_ID,
  PLAN_IMPACT_PROMPT_VERSION,
  PLAN_IMPACT_WAVE_VERSION,
  clipPlanField,
  confidenceFromCosine,
  pickPlanImpactProject,
  planChangeClaim,
  planImpactContentHash,
  planImpactRunId,
  toStoredPlanDiff,
  type ProjectCandidate,
} from "../domain/plan-impact";
import { ProposalQueue } from "../ports";

/** The lookback a caller with no stored cursor gets. */
export const DEFAULT_PLAN_IMPACT_WINDOW_HOURS = 24;

/** The most captures one run will consider. Bounded so a backfill cannot stampede. */
export const DEFAULT_PLAN_IMPACT_LIMIT = 25;

/** One capture as the reconciler sees it — plain data, no ORM row. */
export interface ReconciliationCapture {
  /** `nexalog.capture_sources.id` — the evidence id a proposal cites. */
  id: string;
  url: string | null;
  /** The display title. Never a raw URL (see the capture display rules). */
  title: string;
  summary: string | null;
  /** Reader/main body text, when enrichment has produced one. */
  excerpt: string | null;
}

/** Reads the capture store. Implemented against `nexalog.capture_sources`. */
export interface CaptureReconciliationReader {
  /**
   * Captures saved at or after `since`, newest first, capped at `limit`.
   *
   * "Saved at" is `COALESCE(bookmarked_at, created_at)` — the same effective date
   * the bookmark list sorts by — because an import can carry a save date older than
   * the row's insert time, and a window on `created_at` would then miss exactly the
   * imported captures (or re-include them forever).
   */
  listCapturesSince(input: { since: Date; limit: number }): Promise<ReconciliationCapture[]>;
}

/** The brain's own relevance index. Implemented over gbrain's search. */
export interface ProjectRelevanceIndex {
  /**
   * Project pages semantically near `text`, best first.
   *
   * Implementations MUST report `cosine` (or null) — the reconciler's floor is a
   * statement about semantic closeness, and an RRF-fused rank score cannot support
   * one. An implementation that cannot produce a cosine returns null and the
   * reconciler proposes nothing, which is the honest outcome.
   */
  findProjectCandidates(input: { text: string; limit: number }): Promise<ProjectCandidate[]>;
}

export interface ReconcilePlanImpactResult {
  /** How many captures the window returned. */
  scanned: number;
  /** How many of those produced a NEW proposal row. */
  created: number;
  /** How many were already proposed (a re-run over a decided or pending capture). */
  duplicate: number;
  /** How many had no project above the relevance floor. */
  noProject: number;
  /** How many were rejected as unusable input (empty evidence text). */
  skipped: number;
  /** The rows created this run, with the page and the score they were chosen on. */
  proposals: Array<{ id: number; pageSlug: string; captureId: string; cosine: number }>;
}

/** The window a caller with no stored cursor should use. Pure, so it is testable. */
export function defaultPlanImpactWindow(now: Date): Date {
  return new Date(now.getTime() - DEFAULT_PLAN_IMPACT_WINDOW_HOURS * 60 * 60 * 1000);
}

/** The text a capture is searched on: title + summary + a body slice. Pure. */
export function captureEvidenceText(capture: ReconciliationCapture): string {
  const parts: string[] = [];
  if (capture.title.trim()) parts.push(capture.title.trim());
  if (capture.summary?.trim()) parts.push(capture.summary.trim());
  // The body is capped because a 40 KB reader text is a worse query than its own
  // first paragraph and a much more expensive embedding round-trip.
  if (capture.excerpt?.trim()) parts.push(capture.excerpt.trim().slice(0, 1200));
  if (capture.url) parts.push(capture.url);
  return parts.join("\n\n");
}

/**
 * The rationale line an operator reads to judge the proposal.
 *
 * It states the BASIS rather than a conclusion: the measured cosine, the floor it
 * cleared, and where the number came from. "The brain thinks this matters" is not
 * reviewable; "0.72 cosine in the brain's own project index, floor 0.55" is.
 */
export function planImpactRationale(input: {
  capture: ReconciliationCapture;
  projectSlug: string;
  cosine: number;
}): string {
  const where = input.capture.url ? ` (${input.capture.url})` : "";
  return (
    `A capture saved to the brain is relevant to ${input.projectSlug}: ` +
    `"${input.capture.title}"${where} scored ${input.cosine.toFixed(2)} cosine against that ` +
    `project's page in the brain's own index, above the ${PLAN_IMPACT_COSINE_FLOOR_TEXT} floor. ` +
    `Proposed for a human decision — accepting adds the capture's evidence to the project's plan, ` +
    `it does not edit the plan page.`
  );
}

/** Kept as text so the rationale and the constant cannot drift apart silently. */
const PLAN_IMPACT_COSINE_FLOOR_TEXT = "0.55";

export interface ReconcilePlanImpactInput {
  /** Captures saved at or after this instant are considered. */
  since: Date;
  limit?: number;
  /** gbrain's source id (the brain's own namespace, normally `default`). */
  sourceId: string;
}

export class ReconcilePlanImpact {
  constructor(
    private readonly captures: CaptureReconciliationReader,
    private readonly projects: ProjectRelevanceIndex,
    private readonly queue: ProposalQueue,
  ) {}

  async execute(input: ReconcilePlanImpactInput): Promise<ReconcilePlanImpactResult> {
    const limit = input.limit ?? DEFAULT_PLAN_IMPACT_LIMIT;
    const captures = await this.captures.listCapturesSince({ since: input.since, limit });

    const result: ReconcilePlanImpactResult = {
      scanned: captures.length,
      created: 0,
      duplicate: 0,
      noProject: 0,
      skipped: 0,
      proposals: [],
    };

    for (const capture of captures) {
      const text = captureEvidenceText(capture);

      // No evidence text ⇒ no relevance claim is possible, and inventing one from
      // a URL alone is how a reconciler starts proposing noise. Counted, not thrown:
      // one unusable capture must not stop the run for the others.
      if (text.trim() === "") {
        result.skipped += 1;
        continue;
      }

      // One search per capture, not per candidate project: the project directory is
      // a bounded set of pages the brain already indexes, so the query goes to the
      // index rather than the index being scanned per project.
      const candidates = await this.projects.findProjectCandidates({ text, limit: 8 });
      const chosen = pickPlanImpactProject(candidates);
      if (!chosen || chosen.cosine === null) {
        result.noProject += 1;
        continue;
      }

      const confidence = confidenceFromCosine(chosen.cosine);
      const proposed = clipPlanField(capture.title) ?? `capture ${capture.id}`;

      const outcome = await this.queue.propose({
        sourceId: input.sourceId,
        pageSlug: chosen.slug,
        // The capture's id in the content-hash slot is what makes "the same capture,
        // against the same project, from the same version" a duplicate the database
        // refuses — see `planImpactContentHash`.
        contentHash: planImpactContentHash(capture.id),
        promptVersion: PLAN_IMPACT_PROMPT_VERSION,
        waveVersion: PLAN_IMPACT_WAVE_VERSION,
        runId: planImpactRunId(capture.id),
        claimText: planChangeClaim({
          op: "add",
          projectSlug: chosen.slug,
          proposed,
          evidenceCapture: capture.id,
        }),
        kind: PLAN_CHANGE_KIND,
        holder: PLAN_IMPACT_HOLDER,
        weight: confidence,
        domain: PLAN_IMPACT_DOMAIN,
        modelId: PLAN_IMPACT_MODEL_ID,
        planDiff: toStoredPlanDiff({
          op: "add",
          milestoneId: null,
          current: null,
          proposed,
          rationale: planImpactRationale({
            capture,
            projectSlug: chosen.slug,
            cosine: chosen.cosine,
          }),
          evidenceCapture: capture.id,
          confidence,
        }),
      });

      if (outcome.created) {
        result.created += 1;
        result.proposals.push({
          id: outcome.proposal.id,
          pageSlug: chosen.slug,
          captureId: capture.id,
          cosine: chosen.cosine,
        });
      } else {
        // Already proposed (pending, or already decided). Either way this run adds
        // nothing — which is the property the re-run test asserts.
        result.duplicate += 1;
      }
    }

    return result;
  }
}

/**
 * The queue's own `kind` value for these rows. Exported because the review surface
 * and the reconciler must agree on the spelling; a second literal is a typo away
 * from a proposal no card renders.
 */
export const PLAN_CHANGE_KIND = "plan_change";
