// SPDX-License-Identifier: MIT
/**
 * The per-status counts the proposals surface reads, declared once so the server
 * page and the client list cannot disagree about the shape.
 *
 * `pending` is the number that matters: it is the count over the WHOLE queue, read
 * from the database in the same request as the page of rows it accompanies, and
 * the review surface prints it verbatim. A pending count the UI computed from the
 * rows it happened to receive would drift the moment the queue outgrew one page —
 * which is exactly how a 170-row backlog went unnoticed.
 */

export interface ProposalCounts {
  pending: number;
  accepted: number;
  rejected: number;
  superseded: number;
}
