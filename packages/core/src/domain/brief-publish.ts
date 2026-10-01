// SPDX-License-Identifier: MIT
/**
 * BriefPublish — the domain rules for putting a project's BRIEF into the brain.
 *
 * THE ONE DECISION THIS FILE EXISTS FOR
 * -------------------------------------
 * A project's brief has two states: `synthesized` (a model read the project's own
 * data and wrote a summary) and `fallback` (no model answered, so the reader gets
 * a clearly-labelled mechanical digest). Only the FIRST is a claim about the
 * project. Publishing a fallback would put `## Current state` bullet counts into
 * the brain's proposal queue and, on an accept, append them as a take — a
 * "claim" nobody made, in the operator's own brain, indistinguishable afterwards
 * from a real one. So a fallback is REFUSED with a reason code, never skipped
 * quietly and never published.
 *
 * WHY THE PUBLISHED ROW IS NOT A TAKE
 * -----------------------------------
 * It rides gbrain's EXISTING proposal queue (`take_proposals`) and nothing else:
 * a `kind = 'brief'` row the operator sees in `/app/proposals` beside every other
 * proposal. Publishing is a PROPOSAL, not a write to the brain — the operator
 * still decides. No new table, no new credential, no second integration.
 *
 * PROVENANCE IS NOT OPTIONAL, AND IT IS NOT THE OPERATOR'S VOICE
 * --------------------------------------------------------------
 * A brief is generated at an instant by a specific model. Six weeks later an
 * un-attributed summary in the queue is unusable — nobody can tell what it
 * described or whether anything has changed since. Every published value
 * therefore carries the project it came from, the model that produced it and the
 * instant it was generated, in a form any reader of the raw row can parse (a
 * `brief/1` typed block in `planDiff`) and in a form a human reads (the claim
 * and the rationale). The claim never implies the operator wrote it: it is
 * labelled `nexalog brief` and cites the model.
 *
 * IDEMPOTENCY: THE CONTENT DIGEST, NOT A LEDGER
 * ---------------------------------------------
 * The queue already refuses a second row with the same
 * `(source_id, page_slug, content_hash, prompt_version, md5(claim_text))`.
 * `content_hash` here is a digest of the BRIEF ITSELF (project, model, generated
 * instant and markdown), so:
 *
 *   - publishing the SAME brief twice is a no-op — the digest is byte-identical
 *     and the database refuses the second insert (`created: false`);
 *   - re-synthesizing the brief later produces DIFFERENT markdown (or at least a
 *     new `generatedAt`), so the NEWER brief is a genuinely new proposal. That is
 *     correct: it describes a project that has changed, and suppressing it would
 *     silently lose the update. The digest is what makes "the same" and "newer"
 *     distinguishable without either a memo or a timestamp comparison.
 *
 * Pure: no IO, no SQL, no clock, no model. The adapter carries these rules out.
 */

import { BRIEF_DIFF_TYPE, type BriefDiff } from "./plan-impact";
import { unsafeFenceCellReason } from "./take-proposal";

/**
 * The queue's `kind` for a published brief. NOT a member of `TAKE_KINDS`: that
 * list mirrors what gbrain's extractor produces AND is the set a claim is coerced
 * into when promoted, so adding this there would make a brief a promotable take
 * kind. The two lists answer different questions (what the extractor writes, what
 * this queue can hold).
 */
export const BRIEF_PROPOSAL_KIND = "brief";

/** The `prompt_version` these rows carry — part of the queue's idempotency key. */
export const BRIEF_PUBLISH_PROMPT_VERSION = "nexalog-brief-v1";

/** `wave_version` — explicitly ours, never gbrain's extractor wave. */
export const BRIEF_PUBLISH_WAVE_VERSION = "nexalog-brief-publish-v1";

/** The holder these proposals carry — the same one gbrain's extractor writes. */
export const BRIEF_PUBLISH_HOLDER = "brain";

/** `domain` on these rows — what the queue surfaces as a pill. */
export const BRIEF_PUBLISH_DOMAIN = "project";

/** How much of the brief's markdown a claim/rationale line may quote. */
export const BRIEF_PUBLISH_EXCERPT_CHARS = 160;

/** How much of the project NAME the claim may carry. */
export const BRIEF_PUBLISH_TITLE_CHARS = 80;

/** How many linked-note titles a published brief cites as its evidence. */
export const BRIEF_DIFF_EVIDENCE_MAX = 8;

/** The gbrain source a published brief is addressed to when none is named. */
export const DEFAULT_BRIEF_SOURCE_ID = "default";

/** Every reason a brief may not be published. Stable codes; clients branch on these. */
export const BRIEF_PUBLISH_REFUSALS = [
  "not_synthesized",
  "missing_project",
  "unsafe_claim",
  "empty_brief",
] as const;
export type BriefPublishRefusal = (typeof BRIEF_PUBLISH_REFUSALS)[number];

/**
 * A refusal as a THROWABLE, so the rule can live in the domain while the HTTP
 * mapping stays at the route. `code` is stable; `message` is for a human.
 */
export class BriefPublishError extends Error {
  readonly code: BriefPublishRefusal;
  /** True when the brief exists and is a mechanical digest — the 409 case. */
  readonly notSynthesized: boolean;

  constructor(input: { code: BriefPublishRefusal; message: string }) {
    super(input.message);
    this.name = "BriefPublishError";
    this.code = input.code;
    this.notSynthesized = input.code === "not_synthesized";
  }
}

// ---- the inputs, as plain data ---------------------------------------------

/**
 * One project brief, as the publish path reads it. It is deliberately a NARROW
 * structural type rather than an import of the web layer's `ProjectBrief`: the
 * web type can grow without this rule silently inheriting a field it does not
 * understand, and a test can build one literal.
 */
export interface PublishableBrief {
  /** `synthesized` is the only publishable state. */
  state: string;
  markdown: string;
  /** The model that answered, or null. A synthesized brief always carries one. */
  model: string | null;
  /** When the brief was generated, ISO-8601, or null when no clock was supplied. */
  generatedAt: string | null;
  promptVersion: string;
}

/** Which project the brief describes, and where it is addressed in the brain. */
export interface PublishableProject {
  /** `nexalog.projects.id` — the citation, so the row is greppable by eye. */
  id: string;
  name: string;
  /** The brain page slug this project IS (`projects/<slug>`). */
  pageSlug: string;
  /** Which gbrain source that page belongs to. */
  sourceId: string;
}

/**
 * The stored payload of a published brief.
 *
 * It is stored in the queue's existing `plan_diff` jsonb column, under a `type`
 * marker, rather than in a column added to a table gbrain owns. Why that is the
 * right trade: `take_proposals` is gbrain's table, and a column we add to it is a
 * constraint on gbrain's own future INSERTs (the same reasoning
 * `0001_take_proposals_plan_diff.sql` records). A typed block in an existing
 * column is additive, needs no DDL, and `parseBriefDiff` refuses anything that is
 * not one — a foreign or hand-edited value degrades to `null` instead of
 * reaching a render.
 */
/**
 * The `brief/1` payload's shape. Both the marker and the interface are declared in
 * `./plan-impact` (the leaf) and re-exported here, because the two parsers must
 * agree on the marker and neither may import the other at runtime.
 */
export type { BriefDiff } from "./plan-impact";
export { BRIEF_DIFF_TYPE } from "./plan-impact";

/** The stored (snake_case) shape of the `plan_diff` column for a brief. */
export interface StoredBriefDiff {
  type: typeof BRIEF_DIFF_TYPE;
  project_id: string;
  page_slug: string;
  generated_at: string;
  model_id: string;
  prompt_version: string;
  markdown: string;
  evidence_note_titles: string[];
}

// ---- small helpers ----------------------------------------------------------

function trimmed(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/**
 * Collapse to ONE line and cap at a CODE POINT boundary (a UTF-16 slice leaves
 * half an emoji). Fence cells are single-line by contract — a newline in one lets
 * a claim mint extra markdown table rows — so this runs before the safety guard,
 * and the guard is still the thing that decides whether the result is usable.
 */
export function singleLineExcerpt(source: string, max: number): string {
  const flat = source.replace(/\s+/g, " ").trim();
  const points = [...flat];
  if (points.length <= max) return flat;
  return `${points.slice(0, max).join("").trimEnd()}…`;
}

/** The claim line an operator reads first. Labelled, single-line, fence-safe. */
export function briefProposalClaim(input: {
  projectName: string;
  modelId: string;
  excerpt: string;
}): string {
  const name = singleLineExcerpt(input.projectName, BRIEF_PUBLISH_TITLE_CHARS) || "Untitled";
  const excerpt = singleLineExcerpt(input.excerpt, BRIEF_PUBLISH_EXCERPT_CHARS);
  return (
    `Nexalog project brief for ${name} — synthesized by ${input.modelId}` +
    (excerpt ? `: “${excerpt}”` : ".")
  );
}

/**
 * The rationale line: the provenance, stated rather than implied.
 *
 * It says WHO wrote it, WHEN, from WHAT, and that it is a proposal — because the
 * failure this guards against is a reader taking a synthesized summary for the
 * operator's own words or for a current state of affairs.
 */
export function briefPublishRationale(input: {
  projectId: string;
  pageSlug: string;
  modelId: string;
  generatedAt: string;
  evidenceNoteTitles?: readonly string[];
}): string {
  const evidence = (input.evidenceNoteTitles ?? []).slice(0, BRIEF_DIFF_EVIDENCE_MAX);
  const cited =
    evidence.length === 0
      ? "no linked notes were readable at that time"
      : `${evidence.length} linked note${evidence.length === 1 ? "" : "s"} ` +
        `(${evidence.map((title) => `“${singleLineExcerpt(title, 60)}”`).join(", ")})`;

  return (
    `A synthesized brief of project ${input.pageSlug} (${input.projectId}), written by ` +
    `${input.modelId} at ${input.generatedAt} from that project's own record, ${cited}, its ` +
    `sub-projects and its matched themes. The text is the model's summary, not the operator's ` +
    `own words; accepting promotes it as a take on ${input.pageSlug}.`
  );
}

/** The one-line preview the proposal card and the claim both read. */
export function briefPreview(markdown: string): string {
  return singleLineExcerpt(
    markdown
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/[*_`>]/g, ""),
    BRIEF_PUBLISH_EXCERPT_CHARS,
  );
}

/**
 * The content hash the queue's unique index keys on, so the SAME brief cannot be
 * proposed twice. Deterministic over the brief's identity AND its text: see the
 * header for why a newer synthesis is intentionally a new proposal.
 *
 * The character counts are in the digest because a length-prefixed join is
 * unambiguous — `["ab","c"]` and `["a","bc"]` must not collide.
 */
export function briefContentHash(input: {
  projectId: string;
  modelId: string;
  generatedAt: string;
  markdown: string;
}): string {
  const parts = [input.projectId, input.modelId, input.generatedAt, input.markdown];
  const body = parts.map((part) => `${part.length}:${part}`).join("|");
  return `brief:${fnv1a64(body)}`;
}

/**
 * FNV-1a/64 over UTF-16 code units, hex-encoded — a small, dependency-free
 * digest. `packages/core` is zero-runtime-dependency by locked decision and has
 * no `crypto`, so this is the hash that can live here; it is a COLLISION-RESISTANT
 * key for "is this the same brief", never a security primitive, and it is stored
 * in a `content_hash` column whose whole job is equality.
 */
export function fnv1a64(value: string): string {
  // 0xcbf29ce484222325 and 0x100000001b3 in BigInt, because 64-bit FNV needs
  // more than a JS number can hold exactly.
  const OFFSET = 0xcbf29ce484222325n;
  const PRIME = 0x100000001b3n;
  const MASK = 0xffffffffffffffffn;
  let hash = OFFSET;
  for (let i = 0; i < value.length; i++) {
    hash ^= BigInt(value.charCodeAt(i));
    hash = (hash * PRIME) & MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

/** The `proposal_run_id` these rows carry. Names the run in a log or a grep. */
export function briefPublishRunId(projectId: string): string {
  return `nexalog-brief:${projectId}`;
}

// ---- the eligibility rule ---------------------------------------------------

/**
 * Refuse anything that is not a synthesized brief, and refuse an unusable claim
 * BEFORE the row is written — so a hostile project name can never become a
 * pending proposal the operator has to adjudicate (or worse, a promoted fence
 * cell).
 *
 * Returns the reason, or null when the brief may be published. A predicate rather
 * than a throw so a caller can report exactly what it refused; `assertPublishable`
 * is the throwing form the route uses.
 */
export function briefPublishRefusal(input: {
  brief: PublishableBrief;
  project: PublishableProject | null;
  claim: string;
}): { code: BriefPublishRefusal; message: string } | null {
  if (!input.project) {
    return {
      code: "missing_project",
      message: "This project has no brain page to address a brief to.",
    };
  }
  if (input.brief.state !== "synthesized") {
    return {
      code: "not_synthesized",
      message:
        "This brief is a mechanical digest of the project's own data rather than a synthesis " +
        "(or it has no state at all), so it is not published to the brain.",
    };
  }
  if (!trimmed(input.brief.markdown)) {
    return { code: "empty_brief", message: "This brief has no text to publish." };
  }
  const unsafe = unsafeFenceCellReason(input.claim);
  if (unsafe) {
    return {
      code: "unsafe_claim",
      message: `The claim this brief would publish is unusable: it ${unsafe}.`,
    };
  }
  return null;
}

/** The throwing form, for a route that maps one refusal code to one status. */
export function assertPublishable(input: {
  brief: PublishableBrief;
  project: PublishableProject | null;
  claim: string;
}): PublishableProject {
  const refusal = briefPublishRefusal(input);
  if (refusal) throw new BriefPublishError(refusal);
  return input.project as PublishableProject;
}

// ---- building the row --------------------------------------------------------

export interface BriefPublishRow {
  sourceId: string;
  pageSlug: string;
  contentHash: string;
  promptVersion: string;
  waveVersion: string;
  runId: string;
  claimText: string;
  kind: string;
  holder: string;
  weight: number;
  domain: string;
  modelId: string;
  briefDiff: StoredBriefDiff;
}

/** The `model_id` a brief row carries. A synthesized brief always names its model. */
export function briefModelId(brief: PublishableBrief): string {
  return trimmed(brief.model) || "unknown";
}

/**
 * Everything one publish call needs, assembled deterministically — the whole
 * point being that a second call for the SAME brief produces a byte-identical
 * tuple and the queue's own unique index refuses it.
 */
export function toStoredBriefDiff(diff: BriefDiff): StoredBriefDiff {
  return {
    type: BRIEF_DIFF_TYPE,
    project_id: diff.projectId,
    page_slug: diff.pageSlug,
    generated_at: diff.generatedAt,
    model_id: diff.modelId,
    prompt_version: diff.promptVersion,
    markdown: diff.markdown,
    // Single-lined like every other stored field: this block is rendered as text
    // in a queue card, and a title carrying a newline would break the line it
    // sits on. Bounded so a pathological project cannot inflate the row.
    evidence_note_titles: diff.evidenceNoteTitles
      .slice(0, BRIEF_DIFF_EVIDENCE_MAX)
      .map((title) => singleLineExcerpt(title, 120))
      .filter((title) => title !== ""),
  };
}

/**
 * Build the complete proposal row, or throw with the reason it may not exist.
 *
 * Refusing here rather than at the adapter is deliberate: the adapter's job is
 * SQL, and "is this a synthesis?" is a business rule.
 */
export function buildBriefPublishRow(input: {
  brief: PublishableBrief;
  /** Null is a real answer: the project did not resolve for the caller. */
  project: PublishableProject | null;
  /** Defaults to `DEFAULT_BRIEF_SOURCE_ID`. */
  sourceId?: string;
  /** Titles (never bodies) of the notes the brief was built from. */
  evidenceNoteTitles?: readonly string[];
}): BriefPublishRow {
  const { brief } = input;

  // The project is checked FIRST, before any field is read off it: "there is no
  // page to address" is a typed refusal, and a caller passing null must get that
  // rather than a TypeError from a property access.
  if (!input.project) {
    throw new BriefPublishError({
      code: "missing_project",
      message: "This project has no brain page to address a brief to.",
    });
  }
  const project = input.project;

  const modelId = briefModelId(brief);
  const generatedAt = trimmed(brief.generatedAt) || "unknown";

  const claimText = briefProposalClaim({
    projectName: project.name,
    modelId,
    excerpt: briefPreview(brief.markdown),
  });

  assertPublishable({ brief, project, claim: claimText });

  const sourceId = trimmed(input.sourceId) || DEFAULT_BRIEF_SOURCE_ID;

  return {
    sourceId,
    pageSlug: project.pageSlug,
    contentHash: briefContentHash({
      projectId: project.id,
      modelId,
      generatedAt,
      markdown: brief.markdown,
    }),
    promptVersion: BRIEF_PUBLISH_PROMPT_VERSION,
    waveVersion: BRIEF_PUBLISH_WAVE_VERSION,
    runId: briefPublishRunId(project.id),
    claimText,
    kind: BRIEF_PROPOSAL_KIND,
    holder: BRIEF_PUBLISH_HOLDER,
    // A brief is not a confidence claim about a project; 1 is "this row is
    // exactly what it says it is", which is what the queue's weight column means
    // for a non-inferential producer.
    weight: 1,
    domain: BRIEF_PUBLISH_DOMAIN,
    modelId,
    briefDiff: toStoredBriefDiff({
      type: BRIEF_DIFF_TYPE,
      projectId: project.id,
      pageSlug: project.pageSlug,
      generatedAt,
      modelId,
      promptVersion: brief.promptVersion,
      markdown: brief.markdown,
      evidenceNoteTitles: [...(input.evidenceNoteTitles ?? [])],
    }),
  };
}
