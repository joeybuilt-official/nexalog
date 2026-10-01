// SPDX-License-Identifier: MIT
/**
 * The proposal wire shape — one mapper from the domain type to the DTO, so the
 * list route and the accept/reject route cannot describe the same row two ways.
 *
 * Dates go over the wire as ISO-8601 instants (`.claude/rules/api-design.md`:
 * "timestamps go over the wire as unambiguous instants in a single documented
 * format"), and every id stays a number — a proposal id is a bigint sequence,
 * not a uuid, and stringifying it here would hide that from the client that has
 * to put it back in a URL.
 *
 * TWO KINDS, ONE QUEUE, ONE DTO
 * ----------------------------
 * The queue holds the brain's extracted claims (`kind = 'take'` and friends) and,
 * since the plan-impact reconciler, proposed PLAN CHANGES (`kind = 'plan_change'`).
 * They are the same decision on the same table, so they are the same DTO with one
 * optional field — `planDiff`, populated only for a plan change. A second DTO and
 * a second card would be two renderers for one queue, and the two would drift:
 * this way a change to how a proposal is fetched, decided or counted applies to
 * both kinds by construction.
 */

import type { BriefDiff, PlanDiff, TakeProposal } from "@nexalog/core";

import { PROJECT_SLUG_PREFIX, parseBriefDiff, parsePlanDiff } from "@nexalog/core";

/**
 * The plan-change payload as the client sees it, or null.
 *
 * Its own interface rather than `PlanDiff` itself so the wire contract is stated
 * here (this file is the only place a UI learns a field's spelling) — and so a
 * future field on the domain type cannot silently appear in an API response.
 */
export interface PlanDiffDto {
  /** add | modify | reprioritize | remove. */
  op: string;
  milestoneId: string | null;
  current: string | null;
  proposed: string;
  rationale: string;
  /**
   * The `nexalog.capture_sources` id this change cites. Carried so the card can
   * link straight to the evidence rather than making the reader parse the claim
   * text for it.
   */
  evidenceCapture: string;
  confidence: number;
}

/**
 * A published BRIEF as the client sees it — the second kind of payload the same
 * queue holds, and the reason `planDiff` is a union rather than a plan shape.
 *
 * `projectHref` is resolved HERE, from the slug, exactly as `pageHref` is: the
 * card needs a link into this app, and re-deriving it in a component is the
 * duplicated-route defect this repo has already shipped once.
 */
export interface BriefDiffDto {
  type: string;
  projectId: string;
  projectHref: string | null;
  pageSlug: string;
  generatedAt: string;
  modelId: string;
  promptVersion: string;
  /** The brief's own text, so the card can show what would be promoted. */
  markdown: string;
  /** Titles only — never a note body, which can run past a million characters. */
  evidenceNoteTitles: string[];
}

export interface ProposalDto {
  id: number;
  /** Which gbrain source the claim belongs to (the page's source, not the caller's). */
  sourceId: string;
  pageSlug: string;
  /** The page's in-app route, resolved HERE where the slug is known. */
  pageHref: string;
  claimText: string;
  kind: string;
  holder: string;
  weight: number;
  domain: string | null;
  status: string;
  proposedAt: string;
  modelId: string;
  promotedRowNum: number | null;
  actedAt: string | null;
  actedBy: string | null;
  /**
   * The structured payload this proposal carries: a plan change, or a published
   * brief, or null for every claim-shaped kind. The two are discriminated by
   * `type` on the brief side (`brief/1`), so a renderer can never confuse them.
   */
  planDiff: PlanDiffDto | BriefDiffDto | null;
}

/**
 * A brain page's route. Slugs are paths, so each segment is encoded — the same
 * rule `brainPageHref` applies for search results. A slug rendered raw into a
 * URL would break on any segment that needs escaping.
 */
export function proposalPageHref(slug: string): string {
  const encoded = slug
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/app/brain/${encoded}`;
}

/**
 * The in-app route for the capture a plan change cites.
 *
 * `/app/bookmarks/<id>/reader` is the real route (`app/(app)/app/bookmarks/[id]/reader`)
 * and the id is the `capture_sources` uuid — the same link the bookmark list builds.
 * Returned as null rather than as a broken href when the id is absent, so the card
 * renders the id as text instead of a link into a 404 (the defect class this repo
 * has already shipped once).
 */
export function evidenceCaptureHref(captureId: string): string | null {
  const id = captureId.trim();
  if (id === "") return null;
  return `/app/bookmarks/${encodeURIComponent(id)}/reader`;
}

export function toProposalDto(row: TakeProposal): ProposalDto {
  return {
    id: row.id,
    sourceId: row.sourceId,
    pageSlug: row.pageSlug,
    pageHref: proposalPageHref(row.pageSlug),
    claimText: row.claimText,
    kind: row.kind,
    holder: row.holder,
    weight: row.weight,
    domain: row.domain,
    status: row.status,
    proposedAt: row.proposedAt.toISOString(),
    modelId: row.modelId,
    promotedRowNum: row.promotedRowNum,
    actedAt: row.actedAt ? row.actedAt.toISOString() : null,
    actedBy: row.actedBy,
    planDiff: toProposalDiffDto(row.planDiff),
  };
}

/**
 * ONE mapper for the union, dispatching on the parsed payload.
 *
 * It re-parses from the DOMAIN value rather than re-parsing the raw column: the
 * adapter already refused anything malformed, and parsing twice would let the two
 * readers disagree about what a row is.
 */
function toProposalDiffDto(diff: PlanDiff | BriefDiff | null): PlanDiffDto | BriefDiffDto | null {
  if (!diff) return null;
  if (isBriefDiff(diff)) return toBriefDiffDto(diff);
  return toPlanDiffDto(diff);
}

/**
 * The discriminator, written as a type guard so neither branch needs a cast: a
 * brief block ALWAYS carries `type` and a plan diff never does, which is the
 * same invariant `parsePlanDiff`/`parseBriefDiff` enforce on the way in.
 */
function isBriefDiff(diff: PlanDiff | BriefDiff): diff is BriefDiff {
  return (diff as { type?: unknown }).type === BRIEF_DIFF_TYPE_LOCAL;
}

const BRIEF_DIFF_TYPE_LOCAL = "brief/1";

function toBriefDiffDto(diff: BriefDiff): BriefDiffDto {
  return {
    type: diff.type,
    projectId: diff.projectId,
    projectHref: briefProjectHref(diff.projectId, diff.pageSlug),
    pageSlug: diff.pageSlug,
    generatedAt: diff.generatedAt,
    modelId: diff.modelId,
    promptVersion: diff.promptVersion,
    markdown: diff.markdown,
    evidenceNoteTitles: diff.evidenceNoteTitles,
  };
}

/**
 * The in-app route for the project a brief describes.
 *
 * `projects/<slug>` is a BRAIN page, not an app project: the `projects/` prefix
 * is therefore stripped rather than repeated, and the rest is encoded per
 * segment. A synthesized slug with no page behind it still yields a valid route
 * to the project's own page (`/app/projects/<projectId>`), because that is the
 * object the operator can act on.
 */
function briefProjectHref(projectId: string, pageSlug: string): string | null {
  const trimmed = (pageSlug ?? "").trim();
  const rest = trimmed.startsWith(PROJECT_SLUG_PREFIX)
    ? trimmed.slice(PROJECT_SLUG_PREFIX.length)
    : trimmed;
  if (rest !== "") {
    const encoded = rest
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    return `/app/projects/${encoded}`;
  }
  return projectId ? `/app/projects/${encodeURIComponent(projectId)}` : null;
}

// Re-exported so a consumer of this DTO can build a route without a second copy
// of the prefix rule.
export { parseBriefDiff, parsePlanDiff };

function toPlanDiffDto(diff: PlanDiff | null): PlanDiffDto | null {
  if (!diff) return null;
  return {
    op: diff.op,
    milestoneId: diff.milestoneId,
    current: diff.current,
    proposed: diff.proposed,
    rationale: diff.rationale,
    evidenceCapture: diff.evidenceCapture,
    confidence: diff.confidence,
  };
}
