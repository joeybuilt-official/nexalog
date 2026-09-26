// SPDX-License-Identifier: MIT
/**
 * CaptureProposalBlock — renders the worker-written `nexalog.proposal` block
 * for one brain capture: the summary the Hermes worker wrote, the pages it
 * committed, and the links it drew between them.
 *
 * Data comes from `apps/web/lib/captures/proposal.ts` (normalized view model),
 * which the `/inbox` server component feeds from the composition-root
 * `ListInbox` read of `inbox/<ulid>.md`. No new data path, no LLM call —
 * Nexalog only surfaces what the worker already committed.
 *
 * Page paths link to the EXISTING Garden surface (`/app/graph?slug=…`), which
 * focuses the traversal on that page. Pages whose slug can't be normalized
 * render as plain chips rather than dead links.
 */

import Link from "next/link";
import type { PageType } from "@nexalog/core";
import type { ProposalPage, ProposalView } from "@/lib/captures/proposal";

const TYPE_DOT: Record<PageType, string> = {
  person: "bg-type-person",
  company: "bg-type-company",
  project: "bg-type-project",
  concept: "bg-type-concept",
  note: "bg-type-note",
  source: "bg-type-source",
  media: "bg-type-media",
};

const CHIP_BASE =
  "inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-xs";

function PageChip({ page }: { page: ProposalPage }) {
  const body = (
    <>
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          page.type ? TYPE_DOT[page.type] : "bg-muted-foreground"
        }`}
        aria-hidden
      />
      <span className="truncate">{page.label}</span>
      {page.typeLabel && (
        <span className="shrink-0 text-[10px] text-muted-foreground">{page.typeLabel}</span>
      )}
    </>
  );

  if (!page.href) {
    return (
      <span className={`${CHIP_BASE} text-foreground`} title={page.slug}>
        {body}
      </span>
    );
  }
  return (
    <Link
      href={page.href}
      title={page.slug}
      className={`${CHIP_BASE} text-foreground transition-colors hover:border-primary hover:text-primary`}
    >
      {body}
    </Link>
  );
}

export function CaptureProposalBlock({ proposal }: { proposal: ProposalView }) {
  if (!proposal.hasContent) return null;

  return (
    <div className="mt-2 rounded-md border border-border bg-surface-2 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Worker proposal
        </span>
        {proposal.confidence !== null && (
          <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
            confidence {proposal.confidence.toFixed(2)}
          </span>
        )}
        {proposal.summary && (
          <span className="text-xs text-muted-foreground">{proposal.summary}</span>
        )}
      </div>

      {proposal.pages.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {proposal.pages.map((page) => (
            <li key={page.slug} className="max-w-full">
              <PageChip page={page} />
            </li>
          ))}
        </ul>
      )}

      {proposal.links.length > 0 && (
        <ul className="mt-2 space-y-1">
          {proposal.links.map((link) => (
            <li
              key={`${link.from.slug}->${link.to.slug}`}
              className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
            >
              <PageChip page={link.from} />
              <span aria-hidden>→</span>
              <PageChip page={link.to} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
