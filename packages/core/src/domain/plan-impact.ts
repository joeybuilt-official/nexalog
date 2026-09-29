// SPDX-License-Identifier: MIT
/**
 * PlanImpact — the domain rules for a PLAN-CHANGE proposal.
 *
 * THE ONE-STEP-UP IDEA
 * --------------------
 * gbrain's take queue answers "should this claim be believed?". A plan change asks
 * a different question: "does this new thing I just saved change what I am doing on
 * project X?". Both are decisions an operator makes in the same place, so they ride
 * the SAME queue (`take_proposals`, `kind = 'plan_change'`) rather than a second
 * queue with its own table, its own surface and its own way of being unreachable.
 * The queue PR #21 built is the mechanism; this module adds the plan-shaped payload.
 *
 * Everything here is PURE — no IO, no SQL, no transport, no model call. The rules an
 * operator's adjudication actually depends on (which project a capture is relevant
 * to, what the diff says, how the claim reads as a fence cell) are the part worth
 * testing, so they live in `core` where a test needs no database.
 *
 * WHY RELEVANCE IS NOT A NEW MODEL CALL
 * -------------------------------------
 * gbrain already owns embeddings (1024-dim) and a hybrid vector+keyword index over
 * the brain's own pages, and this app already calls it. `PLAN_IMPACT_COSINE_FLOOR`
 * is a threshold on THAT index's cosine — a signal that exists — instead of a new
 * similarity stack. Two things this deliberately does NOT do:
 *
 *   - it does not read `nexalog.capture_sources.embedding` (384-dim) to compare
 *     against brain pages. Those are different stores at different widths; putting
 *     them in one distance is the dimension conflation the schema warns about.
 *   - it does not compare a capture against a project by title keywords alone. A
 *     keyword rule ("slug appears in the URL") is the kind of thing that looks fine
 *     on the happy path and emits confident nonsense everywhere else.
 *
 * THE FLOOR IS MEASURED, NOT GUESSED
 * ----------------------------------
 * Probed against the live index (URL-only queries, i.e. the shape a fresh bookmark
 * has before enrichment lands): captures that are genuinely ABOUT a project scored
 * 0.65-0.78 cosine on their own project page, while captures unrelated to any
 * project topped out at 0.46. 0.55 sits inside that gap with ~0.09 of margin on
 * both sides. It is one constant in one place so it can be re-derived — and every
 * proposal carries the score it was chosen on, so an operator can see the basis
 * rather than trust the number.
 */

/** The four operations a plan change can propose. */
export const PLAN_OPS = ["add", "modify", "reprioritize", "remove"] as const;
export type PlanOp = (typeof PLAN_OPS)[number];

/**
 * The queue's own `kind` value for a plan-change proposal.
 *
 * It is NOT a member of `TAKE_KINDS` (`domain/take-proposal.ts`). That list mirrors
 * the set gbrain's extractor produces AND is the set a claim is coerced into when
 * it is promoted to a take — so adding a member there would make `plan_change` a
 * promotable take kind. The two lists answer different questions ("what does the
 * extractor write?" vs "what can this queue hold?").
 */
export const PLAN_CHANGE_KIND = "plan_change";

/**
 * The structured diff a `kind = 'plan_change'` proposal carries in `plan_diff`.
 *
 * `milestone_id` is a free-text handle rather than a foreign key on purpose: a
 * project's plan lives in its page's markdown (there is no milestone table to point
 * at), so the id is whatever the page calls the thing — a heading slug, a numbered
 * step, or null when the change is to the plan as a whole. A foreign key here would
 * be a schema claim the brain repo cannot honour.
 *
 * `evidence_capture` is the `nexalog.capture_sources` id this change is motivated
 * by — the field the acceptance bar names ("exactly one pending plan_change citing
 * it"). It is duplicated into the claim text as well, so the citation survives a
 * reader that does not understand `plan_diff`.
 */
export interface PlanDiff {
  op: PlanOp;
  milestoneId: string | null;
  current: string | null;
  proposed: string;
  rationale: string;
  evidenceCapture: string;
  /** 0..1. Also written to the proposal's own `weight`, so the UI can sort on it. */
  confidence: number;
}

/** The stored (snake_case) shape of the `plan_diff` column. */
export interface StoredPlanDiff {
  op: string;
  milestone_id: string | null;
  current: string | null;
  proposed: string;
  rationale: string;
  evidence_capture: string;
  confidence: number;
}

/**
 * The cosine floor below which a search hit is NOT a relevance claim.
 * See the measurement note in this file's header.
 */
export const PLAN_IMPACT_COSINE_FLOOR = 0.55;

/** The brain's project directory. `gbrain.yml` → `storage.db_tracked` lists `projects/`. */
export const PROJECT_SLUG_PREFIX = "projects/";

/**
 * The `prompt_version` this reconciler writes. It is part of the queue's own
 * idempotency key `(source_id, page_slug, content_hash, prompt_version, md5(claim_text))`,
 * so bumping it is what deliberately re-opens the door to re-proposing a capture
 * that was already decided — a version change is a new proposal, a re-run is not.
 */
export const PLAN_IMPACT_PROMPT_VERSION = "plan-impact-v1";

/** `model_id` for these rows: no model is involved, and the queue UI prints this. */
export const PLAN_IMPACT_MODEL_ID = "nexalog:plan-impact-reconciler@1";

/** `wave_version` — explicitly ours, never gbrain's default extractor wave. */
export const PLAN_IMPACT_WAVE_VERSION = "nexalog-plan-impact-v1";

/** The holder these proposals carry — the same one gbrain's extractor writes. */
export const PLAN_IMPACT_HOLDER = "brain";

/** `domain` on these rows — the queue surfaces this as a pill. */
export const PLAN_IMPACT_DOMAIN = "project";

/**
 * One search hit that could be the project a capture is about. Plain data: the
 * caller maps whatever its search returned into this, so the RULE below can be
 * tested without a client, a network, or an embedding.
 */
export interface ProjectCandidate {
  slug: string;
  title: string;
  /** Cosine similarity (0..1, higher = closer), or null when the search omitted it. */
  cosine: number | null;
}

/**
 * Pick the ONE project a capture's relevance claim is against, or null when
 * nothing clears the floor.
 *
 * Returns the single best hit rather than every hit above the floor, because the
 * acceptance bar is "exactly ONE pending plan_change per relevant capture". A rule
 * that emitted one proposal per similar project would be defensible in the abstract
 * and would put four near-identical decisions in front of the operator for one
 * bookmark — which is how a queue teaches people to stop reading it.
 *
 * A candidate with no cosine is rejected rather than assumed: "the search did not
 * say how close this is" and "this is close" are different statements, and only a
 * number can support the proposal's own stated confidence.
 */
export function pickPlanImpactProject(
  candidates: readonly ProjectCandidate[],
): ProjectCandidate | null {
  let best: ProjectCandidate | null = null;
  for (const candidate of candidates) {
    if (!candidate.slug.startsWith(PROJECT_SLUG_PREFIX)) continue;
    if (candidate.cosine === null || !Number.isFinite(candidate.cosine)) continue;
    if (candidate.cosine < PLAN_IMPACT_COSINE_FLOOR) continue;
    if (!best || candidate.cosine > (best.cosine ?? 0)) best = candidate;
  }
  return best;
}

/**
 * The confidence recorded on a proposal, derived from the relevance rather than
 * asserted. A hit exactly at the floor is 0.5 (a coin-flip worth showing an
 * operator); a perfect-cosine hit approaches 1. Clamped into [0, 1] because the
 * proposal's `weight` column is validated against that range on the accept path.
 */
export function confidenceFromCosine(cosine: number): number {
  if (!Number.isFinite(cosine)) return 0;
  const span = 1 - PLAN_IMPACT_COSINE_FLOOR;
  const raised = (cosine - PLAN_IMPACT_COSINE_FLOOR) / span;
  const half = 0.5 + 0.5 * Math.min(1, Math.max(0, raised));
  return Math.round(half * 100) / 100;
}

/**
 * The `content_hash` a plan-change proposal carries.
 *
 * It is the CAPTURE's id, because the idempotency key the queue already enforces
 * is `(source_id, page_slug, content_hash, prompt_version, md5(claim_text))` — with
 * the capture's id in this slot, "the same capture, against the same project, from
 * the same reconciler version" is exactly what a duplicate looks like, and the
 * database refuses it. Nothing here needs a memo of past runs: the second run
 * produces a byte-identical tuple and the existing unique index does the work.
 *
 * Not a content digest of the capture's text: a capture's title or summary can be
 * re-enriched (og metadata lands minutes after the save, reader text later), so a
 * text digest would make the SAME capture look like a NEW one after enrichment and
 * emit the duplicate this function exists to prevent.
 */
export function planImpactContentHash(captureId: string): string {
  return `plan-impact:${captureId}`;
}

/**
 * The claim text — what the operator reads first, and a fence cell on accept.
 *
 * Two jobs, in this order: say WHAT is proposed, and cite WHICH capture says so.
 * The `[capture <id>]` marker mirrors the inbox worker's `[inbox-triage]` citation
 * convention and is what makes the row greppable against the capture store by eye,
 * with no join and no JSON parsing.
 *
 * It must stay a SAFE fence cell (gbrain refuses a claim carrying newlines, control
 * characters or the takes marker), so it is built from single-line fields only —
 * `unsafeFenceCellReason` is the gate, and `planChangeClaim` never introduces one.
 */
export function planChangeClaim(input: {
  op: PlanOp;
  projectSlug: string;
  proposed: string;
  evidenceCapture: string;
}): string {
  return `Plan change on ${input.projectSlug} — ${input.op}: ${input.proposed} [capture ${input.evidenceCapture}]`;
}

/** The proposal_run_id these rows carry. Stable per capture, so it names the run in logs. */
export function planImpactRunId(captureId: string): string {
  return `nexalog-plan-impact:${captureId}`;
}

/**
 * Parse the `plan_diff` column into the domain shape, or null when it is not one.
 *
 * A DEFENSIVE read, deliberately: `plan_diff` is a jsonb column on a live table
 * that gbrain also writes to and that a human with psql can hand-edit. An operator's
 * review surface must degrade to "this is a plan_change whose diff I cannot render"
 * rather than throwing inside a list render — so an unrecognised `op`, a missing
 * `proposed`, or a non-object lands as null and the card falls back to the claim
 * text it already shows for every other kind.
 *
 * `confidence` is coerced with a default rather than trusted: the column is
 * unconstrained (adding a CHECK would constrain gbrain's own future writes).
 */
export function parsePlanDiff(raw: unknown): PlanDiff | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const op = r.op;
  if (typeof op !== "string" || !(PLAN_OPS as readonly string[]).includes(op)) return null;

  const proposed = r.proposed;
  if (typeof proposed !== "string" || proposed.trim() === "") return null;

  const confidence = typeof r.confidence === "number" && Number.isFinite(r.confidence)
    ? Math.min(1, Math.max(0, r.confidence))
    : 0;

  return {
    op: op as PlanOp,
    milestoneId: strOrNull(r.milestone_id),
    current: strOrNull(r.current),
    proposed,
    rationale: typeof r.rationale === "string" ? r.rationale : "",
    evidenceCapture: typeof r.evidence_capture === "string" ? r.evidence_capture : "",
    confidence,
  };
}

/** The column shape for a diff built in this process. */
export function toStoredPlanDiff(diff: PlanDiff): StoredPlanDiff {
  return {
    op: diff.op,
    milestone_id: diff.milestoneId,
    current: diff.current,
    proposed: diff.proposed,
    rationale: diff.rationale,
    evidence_capture: diff.evidenceCapture,
    confidence: diff.confidence,
  };
}

/**
 * How long a line of the diff can be before it stops being legible in a queue card.
 * The proposal's claim_text is a markdown fence cell upstream — a paragraph-length
 * "proposed" would make the take it promotes unreadable in the brain page.
 */
export const PLAN_DIFF_FIELD_MAX = 400;

/** Trim a single-line field to a legible length; null passes through. */
export function clipPlanField(value: string | null): string | null {
  if (value === null) return null;
  const oneLine = value.replace(/\s+/g, " ").trim();
  if (oneLine === "") return null;
  return oneLine.length <= PLAN_DIFF_FIELD_MAX
    ? oneLine
    : `${oneLine.slice(0, PLAN_DIFF_FIELD_MAX - 1)}…`;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}
