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

import type { PlanDiff, TakeProposal } from "@nexalog/core";

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
  /** The plan change this proposal describes; null for every claim-shaped kind. */
  planDiff: PlanDiffDto | null;
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
    planDiff: toPlanDiffDto(row.planDiff),
  };
}

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
