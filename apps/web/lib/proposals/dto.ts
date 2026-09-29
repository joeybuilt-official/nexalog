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
 */

import type { TakeProposal } from "@nexalog/core";

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
  };
}
