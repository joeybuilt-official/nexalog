/**
 * ListInbox — list captures by status, most recent first.
 *
 * Thin read-only use case over `BrainStore.listCaptures`. Returns stable
 * summaries (no body) so the inbox list stays cheap even with large bodies.
 *
 * `proposal` is included because it is the one frontmatter field the operator
 * actually needs to see: the Hermes worker writes it when it processes a
 * capture, and the review surface renders it. It comes from frontmatter the
 * store has already parsed — no extra read, no body.
 */

import { CaptureState } from "../domain/capture";
import { CaptureStatus } from "../domain/capture-status";
import { BrainStore } from "../ports";

export interface ListInboxInput {
  status?: CaptureStatus;
  limit?: number;
}

/**
 * The `nexalog.proposal` block as the worker writes it, deliberately typed
 * loosely: the block is authored externally (the cron-driven Hermes inbox
 * worker), by convention rather than by this contract, and
 * `contracts/frontmatter.ts` casts it through unvalidated. Consumers must
 * normalize before rendering — see `describeProposal` in `apps/web`. Keeping
 * it permissive here is honest about what is actually on disk.
 */
export type CaptureProposalBlock = Record<string, unknown>;

export interface CaptureSummary {
  id: string;
  title: string;
  status: CaptureStatus;
  kind: CaptureState["kind"];
  source: CaptureState["source"];
  capturedAt: string; // ISO
  hasAttachments: boolean;
  /** Raw worker proposal block, or null when the capture has none. */
  proposal: CaptureProposalBlock | null;
}

export class ListInbox {
  constructor(private readonly store: BrainStore) {}

  async execute(input: ListInboxInput = {}): Promise<CaptureSummary[]> {
    const captures = await this.store.listCaptures(
      input.status ? { status: input.status } : undefined,
    );
    const sorted = [...captures].sort(
      (a, b) => b.capturedAt.getTime() - a.capturedAt.getTime(),
    );
    const limited = input.limit ? sorted.slice(0, input.limit) : sorted;
    return limited.map((c) => ({
      id: c.id.value,
      title: c.title,
      status: c.status,
      kind: c.kind,
      source: c.source,
      capturedAt: c.capturedAt.toISOString(),
      hasAttachments: c.attachments.length > 0,
      proposal: (c.proposal as CaptureProposalBlock | null) ?? null,
    }));
  }
}
