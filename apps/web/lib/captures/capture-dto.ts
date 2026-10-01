// SPDX-License-Identifier: MIT
/**
 * Capture transport DTO — the ONE canonical JSON shape for a capture on the
 * wire, for clients that are not the web UI (today: the native mobile app).
 *
 * Why a mapper instead of serializing `CaptureSummary` directly:
 *
 *   - `CaptureSummary.proposal` carries the worker-written `nexalog.proposal`
 *     block **verbatim**, and `parseCapture` casts it through unvalidated
 *     (`packages/core/src/contracts/frontmatter.ts`). Sending that raw block to
 *     a client would push a second copy of the untrusted-shape tolerance into
 *     that client — exactly the drift this module exists to prevent. The block
 *     is normalized HERE, once, by the same `describeProposal` the web surface
 *     renders through, so every consumer sees the same shape.
 *   - Field names and types are stable and explicit. Per
 *     `.agents/rules/api-design.md` ("One canonical shape per entity"), a field
 *     is never renamed or retyped between endpoints.
 *
 * Pure functions only — no DB, no fs, no React — so the mapping is
 * unit-testable and `web-lib-no-ui` keeps holding.
 */

import type { CaptureSummary } from "@nexalog/core";
import { describeProposal } from "./proposal";

/** One proposal page, normalized from whatever the worker wrote. */
export interface CapturePageDto {
  /** Normalized brain slug, e.g. `people/jane-doe`. */
  slug: string;
  /** Leading path segment of the slug (`people`, `companies`, …); "" if none. */
  dir: string;
  /** Human label — the worker's title if it wrote one, else the de-slugged tail. */
  label: string;
  /** Garden page type, or null when unknown. */
  type: string | null;
  /** Chip text for the page kind, e.g. "Person". Null for untyped pages. */
  typeLabel: string | null;
  /** Web-surface path for the page (`/app/graph?slug=…`), or null when unlinkable. */
  href: string | null;
}

/** A link the worker proposed, as its two normalized endpoints. */
export interface CaptureLinkDto {
  from: CapturePageDto;
  to: CapturePageDto;
}

/**
 * The worker's proposal, normalized. Absent/empty blocks are reported as
 * `null` on the capture rather than as an empty object — absent versus empty
 * stays unambiguous (`api-design.md`).
 */
export interface CaptureProposalDto {
  summary: string | null;
  /** Worker confidence clamped to 0..1, or null when absent/non-numeric. */
  confidence: number | null;
  pages: CapturePageDto[];
  links: CaptureLinkDto[];
}

/** The wire shape of one capture. */
export interface CaptureDto {
  id: string;
  title: string;
  status: string;
  kind: string;
  source: string;
  /** ISO-8601 instant, always UTC — never a naive local time. */
  capturedAt: string;
  hasAttachments: boolean;
  proposal: CaptureProposalDto | null;
}

function toPageDto(page: {
  slug: string;
  dir: string;
  label: string;
  type: string | null;
  typeLabel: string | null;
  href: string | null;
}): CapturePageDto {
  return {
    slug: page.slug,
    dir: page.dir,
    label: page.label,
    type: page.type,
    typeLabel: page.typeLabel,
    href: page.href,
  };
}

/**
 * Project one `CaptureSummary` onto the wire shape. Never throws: an
 * unrenderable proposal becomes `null`, and the capture row survives — a
 * malformed block must not take the list down.
 */
export function toCaptureDto(summary: CaptureSummary): CaptureDto {
  const proposal = describeProposal(summary.proposal);
  return {
    id: summary.id,
    title: summary.title,
    status: summary.status,
    kind: summary.kind,
    source: summary.source,
    capturedAt: summary.capturedAt,
    hasAttachments: summary.hasAttachments,
    proposal: proposal.hasContent
      ? {
          summary: proposal.summary,
          confidence: proposal.confidence,
          pages: proposal.pages.map(toPageDto),
          links: proposal.links.map((link) => ({
            from: toPageDto(link.from),
            to: toPageDto(link.to),
          })),
        }
      : null,
  };
}
