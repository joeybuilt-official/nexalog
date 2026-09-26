import { getComposition } from "@/composition";
import { CAPTURE_STATUSES, type CaptureStatus } from "@nexalog/core";
import { describeProposal } from "@/lib/captures/proposal";
import { CaptureProposalBlock } from "@/components/proposal-block";
import { ReviewActions } from "./review-actions";
import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * /inbox — the capture inbox, i.e. the review surface for what Hermes did.
 *
 * Reads through the composition root (`ListInbox` → `FsGitBrainStore`), which
 * is how this page has always loaded captures: the brain repo is the system of
 * record, so the list is the frontmatter projection of `inbox/<ulid>.md`.
 *
 * Two things the operator needs here, both from data the worker already
 * committed — Nexalog itself makes no LLM call:
 *   - the `nexalog.proposal` block (pages / links / summary) it wrote when it
 *     processed the capture, rendered inline per row;
 *   - `status: review` called out from `processed`, because review means the
 *     worker was UNSURE and is waiting on a human decision — and that decision
 *     (accept → processed, reject → rejected) is available on the row itself
 *     (`ReviewActions` → POST /api/captures/[id]/review).
 */

const STATUS_LABELS: Record<CaptureStatus, string> = {
  inbox: "Inbox",
  processing: "Processing",
  review: "Needs review",
  processed: "Processed",
  rejected: "Rejected",
};

const LIST_LIMIT = 500;

function isStatus(v: string | undefined): v is CaptureStatus {
  return v !== undefined && (CAPTURE_STATUSES as readonly string[]).includes(v);
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { listInbox } = getComposition();

  const { status } = await searchParams;
  const activeStatus = isStatus(status) ? status : undefined;

  // One store read: the inbox dir is small and filtering in memory keeps the
  // review count and the visible list from drifting apart.
  const all = await listInbox.execute({ limit: LIST_LIMIT });
  const captures = activeStatus ? all.filter((c) => c.status === activeStatus) : all;
  const reviewCount = all.filter((c) => c.status === "review").length;

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <Link
        href="/app/today"
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        ← Back to the app
      </Link>
      <header className="mt-3 flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Inbox</h1>
        <span className="text-sm text-muted-foreground">
          {captures.length} item{captures.length === 1 ? "" : "s"}
        </span>
      </header>

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href="/inbox"
          aria-current={!activeStatus ? "page" : undefined}
          className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
            !activeStatus
              ? "border-foreground bg-foreground text-background"
              : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
          }`}
        >
          All
        </Link>
        {CAPTURE_STATUSES.map((s) => {
          const active = s === activeStatus;
          const count = all.filter((c) => c.status === s).length;
          return (
            <Link
              key={s}
              href={`/inbox?status=${s}`}
              aria-current={active ? "page" : undefined}
              className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                active
                  ? "border-foreground bg-foreground text-background"
                  : s === "review" && count > 0
                    ? "border-primary text-primary hover:bg-surface-2"
                    : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
              }`}
            >
              {STATUS_LABELS[s]} ({count})
            </Link>
          );
        })}
      </div>

      {reviewCount > 0 && activeStatus !== "review" && (
        <p className="mb-4 rounded-md border border-primary bg-surface-2 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-primary">
            {reviewCount} capture{reviewCount === 1 ? "" : "s"} awaiting an operator decision.
          </span>{" "}
          The worker flagged {reviewCount === 1 ? "it" : "them"} as uncertain —{" "}
          <Link href="/inbox?status=review" className="text-primary underline underline-offset-2">
            review {reviewCount === 1 ? "it" : "them"}
          </Link>
          .
        </p>
      )}

      {captures.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-8 text-center text-muted-foreground">
          {activeStatus
            ? `Nothing in ${STATUS_LABELS[activeStatus].toLowerCase()}.`
            : "Nothing captured yet. Share a link, a voice note, or a thought — it lands here."}
        </div>
      ) : (
        <ul className="space-y-2">
          {captures.map((c) => {
            const proposal = describeProposal(c.proposal);
            const needsReview = c.status === "review";
            return (
              <li
                key={c.id}
                className={`rounded-lg border bg-surface px-4 py-3 ${
                  needsReview ? "border-primary" : "border-border"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-1.5 h-2.5 w-2.5 shrink-0 ${
                      needsReview ? "rounded-full bg-primary" : "rounded-sm bg-muted-foreground"
                    }`}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{c.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.kind} · {new Date(c.capturedAt).toLocaleString()}
                      {c.hasAttachments ? " · 📎" : ""}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs ${
                      needsReview
                        ? "border border-primary font-medium text-primary"
                        : "bg-surface-2 text-muted-foreground"
                    }`}
                  >
                    {STATUS_LABELS[c.status]}
                  </span>
                </div>

                {proposal.hasContent && <CaptureProposalBlock proposal={proposal} />}
                {needsReview && <ReviewActions captureId={c.id} />}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
