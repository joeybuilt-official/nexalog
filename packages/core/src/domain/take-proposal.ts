// SPDX-License-Identifier: MIT
/**
 * TakeProposal — the domain rules for adjudicating gbrain's LLM take queue.
 *
 * gbrain's `propose_takes` cycle phase scans brain pages and writes candidate
 * claims into its own `take_proposals` table. Nothing in gbrain's HTTP/MCP
 * surface can adjudicate them (`takes_*` ops are read + add/update/resolve; the
 * `takes propose` CLI is local-only), and Nexalog had neither a surface nor a
 * write path — so 170 proposals sat pending, 92 were rejected, and zero had
 * ever been promoted into a real `take`. That is the dead queue this module
 * exists to drain.
 *
 * Everything here is PURE: no IO, no SQL, no transport. The decisions an
 * operator's accept/reject actually makes are the part worth testing, so they
 * live in `core` where a test needs no database — the adapter
 * (`GbrainProposalQueue`) only carries these rules out.
 *
 * The rules MIRROR gbrain's own accept path (`src/core/take-proposals.ts`,
 * `addTakeToPage`) rather than inventing a second semantics:
 *
 *   - only a `pending` row can be acted on; the row that claimed the pending
 *     state is the one that may promote it (CAS, not check-then-write);
 *   - a new take APPENDS — its row number is (max existing on that page) + 1,
 *     because gbrain's markdown fences are append-only and `slug#N` references
 *     stay valid forever;
 *   - the claim text is a fence cell, so it is validated with the same guards
 *     gbrain applies before it will let a writer touch a page.
 */

/**
 * `PlanDiff` and `PLAN_CHANGE_KIND` live in `./plan-impact` (the module that owns
 * the plan-change rules); they are re-exported through this one so a reader asking
 * "what can a proposal be?" finds the whole shape here.
 *
 * `plan_change` is deliberately NOT a member of `TAKE_KINDS` below. That list
 * mirrors the set gbrain's extractor produces AND is the set a claim is coerced
 * into when promoted to a take — widening it would make `plan_change` a promotable
 * take kind. The two lists answer different questions: what the extractor writes,
 * versus what this queue can hold.
 */
import type { PlanDiff } from "./plan-impact";
export type { PlanDiff };
export { PLAN_CHANGE_KIND } from "./plan-impact";

/** The four canonical kinds gbrain's extractor emits. */
export const TAKE_KINDS = ["fact", "take", "bet", "hunch"] as const;
export type TakeKind = (typeof TAKE_KINDS)[number];

/** Every state a proposal row can be in (gbrain's `status` check constraint). */
export const PROPOSAL_STATUSES = ["pending", "accepted", "rejected", "superseded"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/**
 * One row of gbrain's proposal queue, as the review surface needs it.
 * Plain data — the wire shape is built in the web layer, never here.
 */
export interface TakeProposal {
  id: number;
  sourceId: string;
  pageSlug: string;
  claimText: string;
  kind: string;
  holder: string;
  weight: number;
  domain: string | null;
  status: ProposalStatus;
  proposedAt: Date;
  modelId: string;
  promotedRowNum: number | null;
  actedAt: Date | null;
  actedBy: string | null;
  /**
   * The structured payload of a `kind = 'plan_change'` proposal; null on every
   * other kind (and on every row written before the column existed). Parsed
   * defensively — see `parsePlanDiff` — so a hand-edited or foreign-written value
   * degrades to null rather than reaching a render.
   */
  planDiff: PlanDiff | null;
}

/** Counts per status over the WHOLE queue, not just the returned page. */
export interface ProposalStatusCounts {
  pending: number;
  accepted: number;
  rejected: number;
  superseded: number;
}

/** A page number and the take row an accept produced. */
export interface PromotedTake {
  pageSlug: string;
  rowNum: number;
}

/**
 * The producer only ever writes the four canonical kinds, but the column is
 * free TEXT — a legacy or hand-inserted row must not crash the promote path.
 * `prediction` is the raw extractor-prompt spelling of `bet`; anything else
 * unrecognized collapses to `take` (the safe, unfalsifiable kind).
 *
 * Deliberately identical to gbrain's `coerceProposalKind`, so a proposal
 * accepted here and one accepted by `gbrain takes propose --accept` produce the
 * same row.
 */
export function coerceProposalKind(raw: string): TakeKind {
  if ((TAKE_KINDS as readonly string[]).includes(raw)) return raw as TakeKind;
  if (raw === "prediction") return "bet";
  return "take";
}

/**
 * The next row number for a take appended to a page: (max existing) + 1, or 1
 * on a page with no takes yet. Exported because the append-only invariant is
 * what keeps `slug#N` references valid — a caller that renumbers instead of
 * appending breaks every cross-page reference silently.
 */
export function nextTakeRowNum(existingRowNums: readonly number[]): number {
  let max = 0;
  for (const n of existingRowNums) if (Number.isFinite(n) && n > max) max = n;
  return max + 1;
}

/**
 * Fence-injection guard, mirroring gbrain's `assertSafeCellText`.
 *
 * Every one of these strings can end up in a markdown fence cell. A newline
 * would let one cell mint extra table rows; the literal `gbrain:takes` is the
 * tightest common substring of the fence markers, so a cell carrying it could
 * close the fence early (or open a second one) and rewrite rows the operator
 * never touched. A wholly-strikethrough value round-trips as `active: false`,
 * which would silently mark the promoted take inactive on the next parse.
 *
 * Returns the reason it is unsafe, or null when the value is safe — a pure
 * predicate rather than a throw, so a route can report WHICH proposal is
 * unpromotable without unwinding a transaction to find out.
 */
export function unsafeFenceCellReason(value: string): string | null {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\n\r\t]/.test(value)) {
    return "contains control characters (newlines included) — fence cells are single-line";
  }
  if (value.includes("gbrain:takes")) {
    return "contains the takes fence marker text";
  }
  if (/^~~[\s\S]*~~$/.test(value.trim())) {
    return "is wholly strikethrough-wrapped, which marks a take inactive on the next parse";
  }
  return null;
}

/** Why a stored proposal cannot be promoted, or null when it can. */
export function unpromotableReason(proposal: Pick<TakeProposal, "claimText" | "weight">): string | null {
  if (proposal.claimText.trim() === "") return "has an empty claim";
  const unsafe = unsafeFenceCellReason(proposal.claimText);
  if (unsafe) return unsafe;
  if (!Number.isFinite(proposal.weight) || proposal.weight < 0 || proposal.weight > 1) {
    return `has a weight outside [0, 1] (${proposal.weight})`;
  }
  return null;
}

/** The provenance string an accepted proposal's take carries into `takes.source`. */
export function promotionSource(proposalId: number): string {
  return `nexalog:proposal#${proposalId}`;
}
