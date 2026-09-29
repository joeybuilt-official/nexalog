// SPDX-License-Identifier: MIT
/**
 * ProposalCard — one pending proposal, with the decision it exists for.
 *
 * The card leads with the CLAIM, because that is what is being judged: a claim
 * the operator either wants in the brain or does not. Everything around it is
 * evidence for that judgement — where it came from, who holds it, how confident
 * the extractor was, and which model proposed it.
 *
 * TWO KINDS SHARE THIS CARD, AND THAT IS THE POINT
 * -----------------------------------------------
 * `kind = 'take'`-and-friends come from the brain's extractor; `kind = 'plan_change'`
 * comes from the plan-impact reconciler and carries a `planDiff` — an operation, the
 * milestone, current vs proposed, and the capture that is the evidence. A plan change
 * gets ONE extra block below the claim (the diff), not a second card component: two
 * renderers for one queue drift, and the decision surface (accept/reject, the same
 * route, the same 409 handling) is identical for both.
 *
 * What the plan block adds is exactly what a reader needs to judge it: WHAT is
 * proposed, on WHOM, and WHY — plus a link to the evidence capture, so the claim can
 * be checked against its source instead of taken on faith. It deliberately does NOT
 * print a confidence number as if it were a probability of being right: the number
 * comes from a cosine floor, and the rationale line spells out the basis.
 *
 * The accept/reject controls follow the house rules the capture review surface
 * established (`app/inbox/review-actions.tsx`): accept is primary, reject is
 * TWO-STEP (no single-click destructive action anywhere in this app), both carry
 * pending labels, and a failure renders in place with the server's own reason.
 * A 409 means the row moved under the operator, so the list refetches to show
 * what actually happened instead of leaving a stale card.
 *
 * The endpoint is built by an exported function so a render test can assert the
 * button is wired to THIS proposal's route — a control pointing at a path no
 * route serves is exactly the defect this whole change exists to fix, and it is
 * invisible in a markup-only assertion.
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Brain, ExternalLink, FileText } from "lucide-react";

import { evidenceCaptureHref } from "@/lib/proposals/dto";

export interface ProposalCardItem {
  id: number;
  sourceId: string;
  pageSlug: string;
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
  /** Present only for a `plan_change`; null for every claim-shaped kind. */
  planDiff: {
    op: string;
    milestoneId: string | null;
    current: string | null;
    proposed: string;
    rationale: string;
    evidenceCapture: string;
    confidence: number;
  } | null;
}

/** The endpoint this card drives. Exported so the wiring itself is testable. */
export function proposalActEndpoint(proposalId: number): string {
  return `/api/proposals/${proposalId}/act`;
}

/** How long ago the extractor proposed it, for the card's provenance line. */
function proposeAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

export function ProposalCard({
  proposal,
  onDecided,
}: {
  proposal: ProposalCardItem;
  /** Called after a successful write so the list can drop the row. */
  onDecided: (id: number) => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"accept" | "reject" | null>(null);
  const [rejectArmed, setRejectArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(accept: boolean) {
    setPending(accept ? "accept" : "reject");
    setError(null);
    setRejectArmed(false);
    try {
      const response = await fetch(proposalActEndpoint(proposal.id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept }),
      });
      if (!response.ok) {
        const detail = await response
          .json()
          .then((data: { error?: string; message?: string; hint?: string }) => ({
            code: data.error,
            message: data.message ?? data.error,
            hint: data.hint,
          }))
          .catch(() => null);
        setError(
          detail?.code === "not_pending"
            ? `${detail.message ?? "This proposal was already decided."} Refreshing…`
            : (detail?.message ?? `Request failed (${response.status})`),
        );
        if (detail?.code === "not_pending" || detail?.code === "not_found") {
          // The row moved under this operator (another tab, another operator).
          // Refetch so the list shows reality rather than this stale card.
          router.refresh();
          onDecided(proposal.id);
        }
        return;
      }
      onDecided(proposal.id);
      // The pending count is server-rendered from the queue's own counts, so a
      // refresh is what makes the header agree with the database again.
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <article
      data-proposal-id={proposal.id}
      data-act-endpoint={proposalActEndpoint(proposal.id)}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
          {proposal.kind}
        </span>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
          holder {proposal.holder}
        </span>
        <span
          className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground tabular-nums"
          title="The extractor's stated confidence in this claim"
        >
          weight {proposal.weight.toFixed(2)}
        </span>
        {proposal.domain ? (
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
            {proposal.domain}
          </span>
        ) : null}
        <span className="ml-auto text-xs text-muted-foreground" title={proposal.proposedAt}>
          #{proposal.id} · {proposeAge(proposal.proposedAt)}
        </span>
      </div>

      <p className="text-sm leading-relaxed text-foreground">{proposal.claimText}</p>

      {proposal.planDiff ? <PlanDiffBlock diff={proposal.planDiff} /> : null}

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <a
          href={proposal.pageHref}
          className="inline-flex items-center gap-1.5 underline-offset-2 hover:text-foreground hover:underline"
          title="Open the brain page this claim was extracted from"
        >
          <Brain className="h-3.5 w-3.5" aria-hidden />
          <span className="font-mono">{proposal.pageSlug}</span>
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
        <span aria-hidden>·</span>
        <span title="How a promoted take records where it came from">
          proposed by {proposal.modelId}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {rejectArmed ? (
          <>
            <Button size="sm" variant="destructive" disabled={pending !== null} onClick={() => decide(false)}>
              {pending === "reject" ? "Rejecting…" : "Confirm reject"}
            </Button>
            <Button size="sm" variant="ghost" disabled={pending !== null} onClick={() => setRejectArmed(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="default" disabled={pending !== null} onClick={() => decide(true)}>
              {pending === "accept" ? "Accepting…" : "Accept"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending !== null}
              onClick={() => setRejectArmed(true)}
            >
              Reject
            </Button>
          </>
        )}
        <span className="text-xs text-muted-foreground">
          {proposal.planDiff
            ? "Accepting records this plan change as a take on the project page; it does not edit the plan itself."
            : "Accepting appends the claim to the page's takes and records the row it landed on."}
        </span>
      </div>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </article>
  );
}

/**
 * The plan-change block: what is proposed, on what, from what, and on which
 * evidence.
 *
 * Rendered as a definition list rather than prose so each part is separately
 * readable — an operator scanning the queue needs to see "add" and the project and
 * the evidence link without reading a paragraph, and the rationale comes last
 * because it is the support, not the decision.
 *
 * `op` gets its own attribute (`data-plan-op`) so a verification can assert the
 * operation that was emitted actually reaches the DOM, and the evidence line is a
 * LINK when the id produces a route — a capture id rendered as a dead link is the
 * class of defect this repo has already shipped once.
 */
function PlanDiffBlock({ diff }: { diff: NonNullable<ProposalCardItem["planDiff"]> }) {
  const captureHref = evidenceCaptureHref(diff.evidenceCapture);
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-xs"
      data-plan-diff="true"
      data-plan-op={diff.op}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[11px] text-foreground">
          plan change · {diff.op}
        </span>
        {diff.milestoneId ? (
          <span className="text-muted-foreground">
            milestone <span className="font-mono">{diff.milestoneId}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">whole plan</span>
        )}
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {diff.current ? (
          <>
            <dt className="text-muted-foreground">Current</dt>
            <dd className="text-foreground/70 line-through">{diff.current}</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">Proposed</dt>
        <dd className="text-foreground">{diff.proposed}</dd>
      </dl>

      {diff.rationale ? (
        <p className="text-muted-foreground" data-plan-rationale="true">
          {diff.rationale}
        </p>
      ) : null}

      <p className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
        <FileText className="h-3 w-3 shrink-0" aria-hidden />
        <span>Evidence capture</span>
        {captureHref ? (
          <a
            href={captureHref}
            className="font-mono underline-offset-2 hover:text-foreground hover:underline"
            title="Open the capture this plan change cites"
            data-evidence-capture={diff.evidenceCapture}
          >
            {diff.evidenceCapture}
          </a>
        ) : (
          <span className="font-mono" data-evidence-capture="">
            (none cited)
          </span>
        )}
      </p>
    </div>
  );
}
