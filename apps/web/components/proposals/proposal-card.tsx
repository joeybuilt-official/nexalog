// SPDX-License-Identifier: MIT
/**
 * ProposalCard — one pending take proposal, with the decision it exists for.
 *
 * The card leads with the CLAIM, because that is what is being judged: a claim
 * the operator either wants in the brain or does not. Everything around it is
 * evidence for that judgement — where it came from, who holds it, how confident
 * the extractor was, and which model proposed it.
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
import { Brain, ExternalLink } from "lucide-react";

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
          Accepting appends the claim to the page&apos;s takes and records the row it landed on.
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
