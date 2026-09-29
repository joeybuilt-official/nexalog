// SPDX-License-Identifier: MIT
/**
 * AdjudicateProposal — the operator's accept/reject over gbrain's take queue.
 *
 * This is the missing decision path. Before it, `take_proposals` was write-only:
 * the propose_takes cycle phase filled it, the `status` column carried a `pending`
 * value nothing ever changed, and the `acted_at` / `acted_by` / `promoted_row_num`
 * columns existed but were null on every row — 170 pending, 92 rejected, zero
 * ever promoted.
 *
 * The ORDER of writes is the load-bearing decision, and it is the opposite of
 * the obvious one:
 *
 *   1. CLAIM the row first — a guarded `pending → accepted` UPDATE (or
 *      `→ rejected`), whose affected-row count is CHECKED. Exactly one caller
 *      can win a pending row.
 *   2. Only then PROMOTE (accept) — append the take to the page.
 *   3. Stamp `promoted_row_num` with the row the append produced.
 *
 * Writing the take first and flipping the status after would let two concurrent
 * accepts both pass a pending check and both append — the loser's no-op UPDATE
 * would report success anyway. Claiming first makes the loser fail loudly.
 *
 * A failure AFTER a successful claim is compensated: the claim is released so
 * the row stays actionable. If that release itself fails (or the process dies
 * between the two), the row is left `accepted` with no `promoted_row_num` —
 * `describeStrandedProposal` names that repairable shape rather than hiding it.
 */

import {
  PromotedTake,
  TakeProposal,
} from "../domain/take-proposal";
import { ProposalQueue, ProposalQueueError } from "../ports";

export interface AdjudicateProposalInput {
  proposalId: number;
  accept: boolean;
  /** Recorded verbatim in `acted_by` — the operator identity the caller resolved. */
  actedBy: string;
}

export interface AdjudicateProposalResult {
  proposal: TakeProposal;
  /** The appended take on accept; null on reject. */
  promoted: PromotedTake | null;
}

export class AdjudicateProposal {
  constructor(private readonly queue: ProposalQueue) {}

  async execute(input: AdjudicateProposalInput): Promise<AdjudicateProposalResult> {
    if (!Number.isInteger(input.proposalId) || input.proposalId <= 0) {
      throw new ProposalQueueError({
        code: "not_found",
        proposalId: input.proposalId,
        message: `Proposal id must be a positive integer (got ${input.proposalId}).`,
      });
    }

    const result = await this.queue.act({
      proposalId: input.proposalId,
      accept: input.accept,
      actedBy: input.actedBy,
    });

    // An ACCEPT that produced no take is a contradiction: the row now says a
    // human promoted it and nothing exists to show for it. Refusing here keeps
    // the promise the review UI makes ("accepting creates a take") rather than
    // reporting success for a write that did not happen.
    if (input.accept && !result.promoted) {
      throw new Error(
        `Proposal #${input.proposalId} was claimed as accepted but no take row was promoted.`,
      );
    }

    return result;
  }
}

/**
 * The repairable shape a crash between claim and promote leaves behind, named
 * for the operator (and reused in the error the adapter raises on a retry).
 * Returns null for every other status, including healthy ones.
 */
export function describeStrandedProposal(proposal: TakeProposal): string | null {
  if (proposal.status === "accepted" && proposal.promotedRowNum === null) {
    return (
      `Proposal #${proposal.id} is stranded: it is marked accepted but no take was promoted ` +
      `(a crash between the claim and the page write, or an accept still in flight). ` +
      `If no accept is running, repair it with: ` +
      `UPDATE take_proposals SET status='pending', acted_at=NULL, acted_by=NULL WHERE id=${proposal.id} AND status='accepted';`
    );
  }
  return null;
}
