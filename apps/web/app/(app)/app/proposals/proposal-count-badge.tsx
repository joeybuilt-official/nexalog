// SPDX-License-Identifier: MIT
/**
 * ProposalCountBadge — the pending count, as a server-rendered fragment.
 *
 * Kept in its own file (and as a plain function, not a component with state) so
 * the number is rendered by the page's own read rather than copied through client
 * state. The equality that matters — what the UI prints equals what the database
 * holds — is only checkable if the UI prints the server's value and nothing else.
 *
 * `data-pending-count` is the hook the verification reads: it is the literal
 * number the surface displays, which is what gets compared against a direct SQL
 * count of `take_proposals where status = 'pending'`.
 */

export function ProposalCountBadge({ pending }: { pending: number }) {
  return (
    <span
      data-pending-count={pending}
      className="rounded-full border border-border bg-card px-3 py-1 text-sm tabular-nums text-foreground"
      title="Pending proposals in the brain's queue, counted over the whole queue"
    >
      {pending.toLocaleString("en-US")} pending
    </span>
  );
}
