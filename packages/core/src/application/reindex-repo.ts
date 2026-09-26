/**
 * ReindexRepo — rebuild the derived capture index from the source of truth.
 *
 * The brain git repo (markdown frontmatter, contract nexalog.schema=1) is the
 * system of record; `capture_index` is only a derived cache. This use case
 * implements TRUNCATE-and-rebuild semantics purely over ports:
 *
 *   1. `clearCaptureIndex()`   — wipe the derived table (adapter may wrap this
 *                                + the insert in one transaction with a
 *                                pg_advisory_xact_lock); the use case itself
 *                                is db-free and just orchestrates ports.
 *   2. list all captures       — via BrainStore.listCaptures (no filter).
 *   3. upsert one batch        — derived rows, newest-information wins.
 *
 * Rows whose source files disappeared are simply absent from the rebuild, so
 * a truncate-then-upsert is a full reconciliation (orphans cannot survive a
 * fresh index).
 */

import { CaptureState } from "../domain/capture";
import { CAPTURE_SCHEMA_VERSION } from "../contracts/frontmatter";
import { BrainStore, CaptureIndexRow, Clock, AppStateRepo } from "../ports";

export interface ReindexRepoResult {
  /** Number of index rows written. */
  indexed: number;
  /** Instant the rebuild ran (stamp on every row). */
  reindexedAt: Date;
  /** Ulids found live in the repo (for the caller's diagnostics). */
  ulids: string[];
}

/**
 * Hash helper port: produces the body digest stored in the index. Provided by
 * the caller so this use case stays dependency-free — the adapter/wiring layer
 * supplies a Web-Crypto or node-crypto sha256 hex implementation.
 */
export type BodyHasher = (body: string) => string;

export class ReindexRepo {
  constructor(
    private readonly store: BrainStore,
    private readonly appState: AppStateRepo,
    private readonly clock: Clock,
    private readonly hasher: BodyHasher,
  ) {}

  async execute(): Promise<ReindexRepoResult> {
    const reindexedAt = this.clock.now();

    // 1. Wipe the derived table. Rebuild semantics: whatever is not re-upserted
    //    below is gone, so orphans self-heal.
    await this.appState.clearCaptureIndex();

    // 2. Read captures from the system of record — unfiltered.
    const captures = await this.store.listCaptures();

    // 3. Derive rows and upsert.
    const rows = captures.map((c) => toIndexRow(c, reindexedAt, this.hasher));
    if (rows.length > 0) {
      await this.appState.upsertCaptureIndex(rows);
    }

    return { indexed: rows.length, reindexedAt, ulids: rows.map((r) => r.ulid) };
  }
}

/** Map a CaptureState onto a derived-index row. Public for tests/reuse. */
export function toIndexRow(
  state: CaptureState,
  reindexedAt: Date,
  hasher: BodyHasher,
): CaptureIndexRow {
  return {
    ulid: state.id.value,
    path: `inbox/${state.id.value}.md`,
    type: state.type,
    schemaVersion: CAPTURE_SCHEMA_VERSION,
    status: state.status,
    kind: state.kind,
    source: state.source,
    capturedAt: state.capturedAt,
    processedAt: state.status === "processed" ? reindexedAt : null,
    claimedBy: state.claimedBy,
    attachments: state.attachments.map((a) => a.path),
    originUrl: state.originUrl,
    hasProposal: state.proposal !== null,
    title: state.title,
    bodySha256: state.body ? hasher(state.body) : null,
    reindexedAt,
  };
}
