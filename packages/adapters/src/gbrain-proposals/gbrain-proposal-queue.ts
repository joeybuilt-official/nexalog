// SPDX-License-Identifier: MIT
/**
 * GbrainProposalQueue — the `ProposalQueue` port against gbrain's own tables.
 *
 * WHY A DIRECT READ/WRITE, AND WHY THAT IS NOT A SHORTCUT
 * ------------------------------------------------------
 * gbrain owns `take_proposals` and `takes`, and it has an accept path — but
 * neither is reachable from this app:
 *
 *   - its MCP surface (the only gbrain endpoint Nexalog calls) exposes no
 *     adjudication verb. `takes_add` / `takes_update` / `takes_resolve` are
 *     ordinary take mutations, and the holder allow-list on a remote token
 *     refuses the `brain` holder that 169 of the 170 pending rows carry;
 *   - `gbrain takes propose --accept` exists, but only as a LOCAL CLI inside the
 *     gbrain container — there is no HTTP route to it.
 *
 * So the operator's decision has no remote path but this one. The port keeps the
 * fact contained: `core` states the rules, this file states the SQL.
 *
 * WHAT AN ACCEPT ACTUALLY WRITES
 * ------------------------------
 * One transaction, in gbrain's database:
 *
 *   1. claim the pending row (`pending → accepted`, rowcount CHECKED) — the CAS;
 *   2. append the take to the page's take list — `row_num` = (max on that page)
 *      + 1, because gbrain's fences are append-only and `slug#N` references stay
 *      valid forever;
 *   3. stamp `promoted_row_num` with the row the append produced.
 *
 * gbrain's own accept does (1) and (2) as two steps with a best-effort
 * compensation between them, because its step (2) is a FILESYSTEM write that
 * cannot join a DB transaction. Here both are SQL in the same database, so the
 * claim and the promote are ONE atomic unit: a failure anywhere rolls the claim
 * back, and there is no window in which a row is marked accepted with nothing to
 * show for it. That is strictly stronger than the compensation path, and it is
 * why the ordering here does not need one.
 *
 * MD IS CANONICAL, AND THIS WRITES THE DB PLANE
 * ---------------------------------------------
 * gbrain's markdown takes fence is the source of truth; `takes` is its derived
 * index, reconciled FROM markdown. A row that exists only in the database is
 * therefore at risk of being dropped by a fence-driven rebuild for that page —
 * so every promoted row is stamped with provenance
 * (`takes.source = 'nexalog:proposal#<id>'`) and that risk is stated in the
 * review UI's own copy and in the PR that shipped this, rather than left for
 * someone to discover as missing data. Nexalog cannot write the fence itself:
 * the brain repo is bind-mounted read-only to the web container's user, and
 * writing it directly would bypass gbrain's page lock and writer protocol — the
 * exact class of write gbrain's own guards exist to refuse. Closing that gap is
 * a gbrain-side change (`gbrain extract takes` after a fence write), not
 * something to fake here.
 *
 * The `gbrain.write_sources` GUC is set inside the transaction because gbrain
 * enforces its managed-writer protocol with a row trigger on `takes`: with the
 * persistence coordinator enabled, an INSERT whose page belongs to a source the
 * caller has not declared raises `writer_coordinator_required`. Declaring the
 * source being written is what that protocol asks for — it is the same context
 * gbrain's own writes establish, not a bypass of it.
 */

import type { Sql } from "postgres";
import postgres from "postgres";

import {
  ProposalQueue,
  ProposalQueueError,
  ProposalStatusCounts,
  parsePlanDiff,
  parseBriefDiff,
  type ProposeInput,
  type ProposeOutcome,
  type PromotedTake,
  type ProposalPage,
  type ProposalStatus,
  type TakeProposal,
} from "@nexalog/core";

import { nextTakeRowNum, promotionSource, unpromotableReason } from "@nexalog/core";

/** Columns the review surface needs — never `SELECT *` on a table we do not own. */
const PROPOSAL_COLUMNS =
  "id, source_id, page_slug, claim_text, kind, holder, weight, domain, status, proposed_at, model_id, promoted_row_num, acted_at, acted_by, plan_diff";

/** Raw column shape as the driver returns it (bigint/real arrive as strings). */
interface ProposalRow {
  id: number | string;
  source_id: string;
  page_slug: string;
  claim_text: string;
  kind: string;
  holder: string;
  weight: number | string;
  domain: string | null;
  status: string;
  proposed_at: Date | string;
  model_id: string;
  promoted_row_num: number | string | null;
  acted_at: Date | string | null;
  acted_by: string | null;
  /**
   * The plan-change payload, nullable because every non-plan_change row on this
   * shared table carries NULL. jsonb arrives already parsed by the driver.
   */
  plan_diff: unknown;
}

/**
 * Normalize driver values to the port's contract. `bigint` and `real` come back
 * as strings from postgres.js (its default is to avoid precision loss), so every
 * numeric field is widened explicitly here — a coercion left to the caller is a
 * coercion that eventually lands in a `Number(x)` somewhere with no comment.
 */
function toProposal(row: ProposalRow): TakeProposal {
  return {
    id: Number(row.id),
    sourceId: row.source_id,
    pageSlug: row.page_slug,
    claimText: row.claim_text,
    kind: row.kind,
    holder: row.holder,
    weight: Number(row.weight),
    domain: row.domain,
    status: row.status as ProposalStatus,
    proposedAt: new Date(row.proposed_at),
    modelId: row.model_id,
    promotedRowNum: row.promoted_row_num === null ? null : Number(row.promoted_row_num),
    actedAt: row.acted_at === null ? null : new Date(row.acted_at),
    actedBy: row.acted_by,
    // `parsePlanDiff` / `parseBriefDiff` rather than a cast: the column is
    // unconstrained jsonb on a table gbrain and psql also write to, so a
    // malformed value must degrade to "not a plan diff" / "not a published brief"
    // (the card falls back to the claim) instead of throwing inside a list render.
    // Each parser refuses the other's block on the `type` marker.
    planDiff: parsePlanDiff(row.plan_diff) ?? parseBriefDiff(row.plan_diff),
  };
}

const EMPTY_COUNTS: ProposalStatusCounts = {
  pending: 0,
  accepted: 0,
  rejected: 0,
  superseded: 0,
};

export interface GbrainProposalQueueOptions {
  /** libpq-style URL for the gbrain database (NOT the app database). */
  databaseUrl: string;
  /** Inject a client (tests). When omitted one is created from `databaseUrl`. */
  sql?: Sql;
}

export class GbrainProposalQueue implements ProposalQueue {
  private readonly query: Sql;

  constructor(opts: GbrainProposalQueueOptions) {
    this.query =
      opts.sql ??
      postgres(opts.databaseUrl, {
        // gbrain's trigger consults `current_setting`, which is per-session —
        // a prepared statement would be fine, but `prepare: false` matches the
        // app's own client and keeps this connection interchangeable with it.
        prepare: false,
        max: 4,
        idle_timeout: 20,
      });
  }

  async list(input: { limit: number; offset: number }): Promise<ProposalPage> {
    const limit = Math.max(1, Math.min(500, input.limit));
    const offset = Math.max(0, input.offset);

    // Both reads describe the SAME queue, so they are issued together rather
    // than sequentially — the count is over the whole table (never the page),
    // because a badge that under-reports the backlog is how 170 pending rows
    // went unnoticed in the first place.
    const [rows, countRows] = await Promise.all([
      this.query<ProposalRow[]>`
        SELECT ${this.query.unsafe(PROPOSAL_COLUMNS)}
          FROM take_proposals
         WHERE status = 'pending'
         ORDER BY proposed_at DESC, id DESC
         LIMIT ${limit} OFFSET ${offset}`,
      this.query<Array<Record<string, number | string>>>`
        SELECT status, count(*)::int AS n FROM take_proposals GROUP BY status`,
    ]);

    const counts: ProposalStatusCounts = { ...EMPTY_COUNTS };
    for (const r of countRows) {
      const status = String(r.status) as ProposalStatus;
      if (status in counts) counts[status] = Number(r.n);
    }

    const proposals = rows.map(toProposal);
    const nextOffset = proposals.length === limit ? offset + limit : null;
    return { proposals, counts, nextOffset };
  }

  async act(input: {
    proposalId: number;
    accept: boolean;
    actedBy: string;
  }): Promise<{ proposal: TakeProposal; promoted: PromotedTake | null }> {
    const existing = await this.loadProposal(input.proposalId);
    if (!existing) {
      throw new ProposalQueueError({
        code: "not_found",
        proposalId: input.proposalId,
        message: `No take proposal #${input.proposalId}.`,
      });
    }
    if (existing.status !== "pending") {
      throw new ProposalQueueError({
        code: "not_pending",
        proposalId: input.proposalId,
        message: this.notPendingMessage(existing),
        ...(existing.status === "accepted" && existing.promotedRowNum === null
          ? { hint: "repair_then_retry" }
          : {}),
      });
    }

    // Refuse an unpromotable row BEFORE claiming it, so a hostile or garbled
    // claim never becomes an `accepted` row with no take behind it. (gbrain's
    // own writer would refuse the same cells; refusing here means the operator
    // gets a reason instead of an unwound transaction.)
    if (input.accept) {
      const reason = unpromotableReason(existing);
      if (reason) {
        throw new ProposalQueueError({
          code: "not_pending",
          proposalId: input.proposalId,
          message: `Proposal #${input.proposalId} cannot be promoted: the claim ${reason}.`,
          hint: "invalid_claim",
        });
      }
    }

    return this.query.begin(async (tx) => {
      // ── 1. Claim (CAS). The rowcount is the whole point: exactly one caller
      //       can move a row out of `pending`, and the loser finds out here.
      const claimed = await tx<Array<{ id: number | string }>>`
        UPDATE take_proposals
           SET status = ${input.accept ? "accepted" : "rejected"},
               acted_at = now(),
               acted_by = ${input.actedBy}
         WHERE id = ${input.proposalId} AND status = 'pending'
         RETURNING id`;

      if (claimed.length === 0) {
        throw new ProposalQueueError({
          code: "not_pending",
          proposalId: input.proposalId,
          message: `Proposal #${input.proposalId} was acted on concurrently — only one accept or reject can win a pending row.`,
        });
      }

      const proposal: TakeProposal = {
        ...existing,
        status: input.accept ? "accepted" : "rejected",
        actedAt: new Date(),
        actedBy: input.actedBy,
      };

      if (!input.accept) return { proposal, promoted: null };

      // ── 2. Promote. The page must exist: a take with no page has no row
      //       numbering and no owner, and gbrain's own accept refuses it too.
      const pages = await tx<Array<{ id: number | string }>>`
        SELECT id FROM pages
         WHERE slug = ${existing.pageSlug} AND source_id = ${existing.sourceId}
           AND deleted_at IS NULL
         LIMIT 1`;
      if (pages.length === 0) {
        throw new ProposalQueueError({
          code: "not_found",
          proposalId: input.proposalId,
          message: `Proposal #${input.proposalId} points at page '${existing.pageSlug}', which is not in the brain (or is soft-deleted).`,
        });
      }
      const pageId = Number(pages[0].id);

      const rowNum = nextTakeRowNum(
        (
          await tx<Array<{ row_num: number | string }>>`
            SELECT row_num FROM takes WHERE page_id = ${pageId}`
        ).map((r) => Number(r.row_num)),
      );

      // Declare the write source for gbrain's managed-writer trigger. SET LOCAL
      // is transaction-scoped, so it cannot leak into another request on this
      // pooled connection. It goes through `set_config(…, true)` rather than
      // `SET LOCAL … = $1` because Postgres does not accept a PARAMETER in a SET
      // statement — it requires a literal, and the placeholder is a syntax error
      // at the server (caught by the live proof, not by a unit test).
      await tx`SELECT set_config('gbrain.write_sources', ${JSON.stringify([existing.sourceId])}, true)`;

      await tx`
        INSERT INTO takes (page_id, row_num, claim, kind, holder, weight, source, active)
        VALUES (
          ${pageId},
          ${rowNum},
          ${existing.claimText},
          ${existing.kind},
          ${existing.holder},
          ${existing.weight},
          ${promotionSource(existing.id)},
          true
        )`;

      // ── 3. Record which row the promote produced, so the provenance chain
      //       queue row → take row is followable in both directions.
      await tx`
        UPDATE take_proposals SET promoted_row_num = ${rowNum} WHERE id = ${input.proposalId}`;

      return {
        proposal: { ...proposal, promotedRowNum: rowNum },
        promoted: { pageSlug: existing.pageSlug, rowNum },
      };
    });
  }

  /**
   * Emit one proposal, or report that an identical one already exists.
   *
   * IDEMPOTENCY IS THE DATABASE'S JOB HERE, and that is the whole design. The
   * table already carries a unique index on
   * `(source_id, page_slug, content_hash, prompt_version, md5(claim_text))` —
   * gbrain's own guard against re-proposing the same claim from the same run — so
   * this is `INSERT … ON CONFLICT DO NOTHING` plus a read-back of whichever row
   * holds the key. A check-then-write would be strictly worse: two concurrent
   * runs would both read "absent" and both insert, and the second insert would
   * then fail as an unhandled unique violation instead of a reported duplicate.
   *
   * `ON CONFLICT DO NOTHING` returns zero rows on a conflict, which is why the
   * read-back is a SEPARATE statement rather than a `RETURNING` clause: with
   * `DO NOTHING`, `RETURNING` yields nothing on the conflict path and there would
   * be no row to hand back. The read-back is safe — nothing else can move a
   * `pending` row into existence and out again inside the window that matters —
   * and it is scoped to the exact key so it can only ever return OUR row.
   *
   * No `gbrain.write_sources` GUC is set: that protocol is enforced by the
   * `managed_writer_guard` trigger, which fires on `facts`, `pages`, `takes` and
   * `timeline_entries` only (verified against the live catalog). `take_proposals`
   * is outside the fence — it IS the proposal channel, which is precisely why a
   * second writer may emit into it without coordinating a page write.
   */
  async propose(input: ProposeInput): Promise<ProposeOutcome> {
    const inserted = await this.query<ProposalRow[]>`
      INSERT INTO take_proposals (
        source_id, page_slug, content_hash, prompt_version, wave_version,
        proposal_run_id, claim_text, kind, holder, weight, domain, model_id, plan_diff
      )
      VALUES (
        ${input.sourceId},
        ${input.pageSlug},
        ${input.contentHash},
        ${input.promptVersion},
        ${input.waveVersion},
        ${input.runId},
        ${input.claimText},
        ${input.kind},
        ${input.holder},
        ${input.weight},
        ${input.domain},
        ${input.modelId},
        ${input.planDiff ? this.query.json(input.planDiff as never) : null}
      )
      ON CONFLICT (source_id, page_slug, content_hash, prompt_version, md5(claim_text))
      DO NOTHING
      RETURNING ${this.query.unsafe(PROPOSAL_COLUMNS)}`;

    if (inserted.length > 0) {
      return { created: true, proposal: toProposal(inserted[0]) };
    }

    // The conflict path: a row with this exact key exists (pending, accepted,
    // rejected — all four statuses collide, because re-proposing a claim the
    // operator already rejected is not a new decision to put in front of them).
    const existing = await this.query<ProposalRow[]>`
      SELECT ${this.query.unsafe(PROPOSAL_COLUMNS)}
        FROM take_proposals
       WHERE source_id = ${input.sourceId}
         AND page_slug = ${input.pageSlug}
         AND content_hash = ${input.contentHash}
         AND prompt_version = ${input.promptVersion}
         AND md5(claim_text) = md5(${input.claimText})
       LIMIT 1`;

    if (existing.length === 0) {
      // Reachable only under a concurrent DELETE of the row between the insert and
      // this read. Reported rather than papered over: silently returning a
      // fabricated proposal would tell the caller it produced a row it did not.
      throw new ProposalQueueError({
        code: "not_found",
        proposalId: 0,
        message:
          `Proposal for page '${input.pageSlug}' conflicted on insert but is no longer present — ` +
          `it was deleted concurrently. Re-run the reconcile pass.`,
      });
    }

    return { created: false, proposal: toProposal(existing[0]) };
  }

  private async loadProposal(id: number): Promise<TakeProposal | null> {
    const rows = await this.query<ProposalRow[]>`
      SELECT ${this.query.unsafe(PROPOSAL_COLUMNS)} FROM take_proposals WHERE id = ${id} LIMIT 1`;
    return rows.length > 0 ? toProposal(rows[0]) : null;
  }

  /**
   * The stranded shape is called out by name because it is REPAIRABLE and
   * otherwise invisible: `accepted` with no `promoted_row_num` means a crash
   * (or an accept still running) between the claim and the promote — the row is
   * gone from the pending list, so nothing else would ever surface it.
   */
  private notPendingMessage(proposal: TakeProposal): string {
    if (proposal.status === "accepted" && proposal.promotedRowNum === null) {
      return (
        `Proposal #${proposal.id} is stranded: marked accepted but no take was promoted ` +
        `(an accept still in flight, or a crashed one). If no accept is running, repair with: ` +
        `UPDATE take_proposals SET status='pending', acted_at=NULL, acted_by=NULL WHERE id=${proposal.id} AND status='accepted';`
      );
    }
    return `Proposal #${proposal.id} is already '${proposal.status}' — only pending proposals can be accepted or rejected.`;
  }
}
