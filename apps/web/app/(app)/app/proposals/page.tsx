// SPDX-License-Identifier: MIT
/**
 * /app/proposals — the take-proposal review queue.
 *
 * WHY THIS SURFACE EXISTS
 * -----------------------
 * gbrain's `propose_takes` cycle phase writes candidate claims into its
 * `take_proposals` table, and until this page there was nothing anywhere in the
 * product that could adjudicate them: no route, no component, no write path. The
 * queue had 170 rows pending, 92 rejected, and ZERO ever promoted — a queue with
 * no exit, which is indistinguishable from a queue nobody wants to drain.
 *
 * A SERVER component, unlike `/app/review` (the spaced-repetition session), for
 * one reason: the count has to be real. The header's number comes from a query
 * against the same database the queue lives in, executed on the server as this
 * page renders, so "172 pending" is a fact about the queue and not about what a
 * browser happened to have fetched. The list below it is the client component
 * that owns the per-row decisions and their failure states.
 *
 * Auth is the `(app)` layout's (a session, or a redirect to /login) plus an
 * explicit check here, because a server component can be reached through a path
 * that does not go through the layout.
 *
 * HONEST ABSENCE: when the deployment has no gbrain database the page says so in
 * one line and renders nothing else. It does not render an empty queue — that
 * would state, falsely, that there is nothing to review.
 */

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { Scale, ExternalLink } from "lucide-react";

import { getAuthUser } from "@/lib/auth/server";
import { logEvent } from "@/lib/logger";
import { getProposalQueue } from "@/lib/proposals/queue";
import { ProposalQueueList } from "@/components/proposals/proposal-queue-list";
import { ProposalCountBadge } from "./proposal-count-badge";

export default async function ProposalsPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const queue = getProposalQueue();

  // The count is read on the server so the number shown is the queue's own. On a
  // read failure the page still renders (the client list owns the retry), but it
  // must not print a count it could not read.
  let pending: number | null = null;
  if (queue) {
    try {
      const page = await queue.list({ limit: 1, offset: 0 });
      pending = page.counts.pending;
    } catch (err) {
      logEvent("proposals.page.count_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 py-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Scale className="h-5 w-5 text-muted-foreground" aria-hidden />
          <div>
            <h1 className="text-xl font-semibold">Proposals</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Claims the brain&apos;s extractor proposed from your pages. Accept one to promote it
              into a real take; reject it to dismiss it for good.
            </p>
          </div>
        </div>
        {pending !== null ? <ProposalCountBadge pending={pending} /> : null}
      </header>

      {queue === null ? (
        <div className="rounded-md border border-border bg-card/40 px-4 py-3 text-sm">
          <p className="text-foreground">This deployment cannot read the proposal queue.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Proposals live in the brain&apos;s own database, which this instance has not been
            pointed at (<code className="font-mono">GBRAIN_DATABASE_URL</code> is unset). Nothing
            has been lost — the queue simply has no path to a decision from here.
          </p>
        </div>
      ) : (
        <>
          <section className="rounded-lg border border-border bg-surface-2 px-4 py-3 text-xs text-muted-foreground">
            <p>
              <strong className="font-medium text-foreground">What accepting does.</strong> The
              claim becomes a take on{" "}
              <span className="font-mono">its page</span>, recorded with provenance
              <span className="font-mono"> nexalog:proposal#&lt;id&gt;</span> so where it came from
              is always followable. A take&apos;s markdown fence is the brain&apos;s source of
              truth; this promote writes the take so it is immediately queryable, and the fence is
              reconciled from it on the brain&apos;s next extraction pass.
            </p>
          </section>

          <ProposalQueueList />

          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ExternalLink className="h-3 w-3" aria-hidden />
            <span>
              A claim&apos;s page link opens the brain page it was extracted from, so you can judge
              it in context.
            </span>
          </p>
        </>
      )}
    </div>
  );
}
