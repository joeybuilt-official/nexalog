"use client";

/**
 * ReviewActions — the operator's accept/reject control for a `status: review`
 * capture, rendered inside the proposal block on the capture inbox.
 *
 * The decision is the whole point of the review state, so the buttons are
 * always visible on a review row: one click, no hidden menu. Accept is the
 * primary action (it keeps the pages the worker already committed); reject is
 * the destructive one and is therefore two-step — the house rule across every
 * Joeybuilt app is that a destructive action never fires on a single click, so
 * this follows the same arming pattern as `ConfirmButton`.
 *
 * Failure handling (`error-handling.md`, "Never fail silently"): if the request
 * fails the row says so, in place, with the server's reason; the optimistic
 * "handled" state is only entered once the write actually succeeded. A 409
 * means the row moved under the operator (another tab, or the worker resolved
 * it) and the refresh below shows the real status.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Terminal statuses a resolved capture can carry; drives the handled label. */
type ResolvedStatus = "processed" | "rejected";

/**
 * The endpoint this control drives. Exported so the wiring itself is testable:
 * a UI button pointing at a path no route serves is exactly the defect this
 * change exists to fix, and it is invisible in a render-only assertion.
 */
export function reviewEndpoint(captureId: string): string {
  return `/api/captures/${encodeURIComponent(captureId)}/review`;
}

const BUTTON =
  "rounded border px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none";

export function ReviewActions({ captureId }: { captureId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<"accept" | "reject" | null>(null);
  const [rejectArmed, setRejectArmed] = useState(false);
  const [resolved, setResolved] = useState<ResolvedStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(accept: boolean) {
    const decision = accept ? "accept" : "reject";
    setPending(decision);
    setError(null);
    setRejectArmed(false);
    try {
      const response = await fetch(reviewEndpoint(captureId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept }),
      });
      if (!response.ok) {
        const detail = await response
          .json()
          .then((data: { error?: string; message?: string }) => data.message ?? data.error)
          .catch(() => null);
        setError(detail ? `${detail}` : `Request failed (${response.status})`);
        return;
      }
      setResolved(accept ? "processed" : "rejected");
      // The row's status badge is server-rendered from the frontmatter the
      // write just changed — refresh so the list shows the new status.
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div
      data-review-endpoint={reviewEndpoint(captureId)}
      className="mt-2 flex flex-wrap items-center gap-2"
    >
      {resolved ? (
        <span className="text-xs text-muted-foreground">
          {resolved === "processed" ? "Accepted — marked processed." : "Rejected."}
        </span>
      ) : (
        <>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Decide
          </span>
          <button
            type="button"
            onClick={() => decide(true)}
            disabled={pending !== null}
            className={`${BUTTON} border-primary bg-primary/10 text-primary hover:bg-primary/20`}
          >
            {pending === "accept" ? "Accepting…" : "Accept"}
          </button>
          <button
            type="button"
            onClick={() => (rejectArmed ? decide(false) : setRejectArmed(true))}
            onMouseLeave={() => setRejectArmed(false)}
            disabled={pending !== null}
            className={`${BUTTON} ${
              rejectArmed
                ? "border-destructive bg-destructive/10 text-destructive"
                : "border-border text-muted-foreground hover:border-destructive hover:text-destructive"
            }`}
          >
            {pending === "reject" ? "Rejecting…" : rejectArmed ? "Click again to reject" : "Reject"}
          </button>
        </>
      )}
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
