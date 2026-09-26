/**
 * DrizzleAppStateRepo — Postgres implementation of AppStateRepo (app state
 * only: derived capture index, api tokens, read state). Body CONTENT never
 * lands here — the index stores the frontmatter projection plus a body
 * sha256; bearer tokens are stored as hex sha256 only.
 *
 * Reindex helper: rebuildCaptureIndex() runs truncate + bulk insert inside a
 * single transaction guarded by pg_advisory_xact_lock (two concurrent
 * rebuilders serialize instead of interleaving).
 */

import crypto from "node:crypto";
import { and, desc, eq, inArray, isNull, sql as pgSql } from "drizzle-orm";
import {
  PostgresJsDatabase,
  drizzle,
} from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { apiTokens, captureIndex, readState } from "./schema";
import * as schema from "./schema";

import {
  ApiTokenCreated,
  ApiTokenView,
  AppStateRepo,
  CaptureIndexRow,
  CaptureStatus,
  InboxIndexFilter,
  InboxIndexPage,
  Ulid,
} from "@nexalog/core";

const TOKEN_BYTES = 32; // 256-bit bearer tokens
const TOKEN_PREFIX_LEN = 8; // display prefix
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 500;

/** sha256 of a UTF-8 string as lowercase hex. */
export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

/** Constant-time equality on equal-length hex strings. */
function timingSafeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length || ab.length === 0) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export interface DrizzleAppStateRepoOptions {
  /** libpq-style URL, e.g. postgres://user:pass@host:5432/nexalog_v2 */
  databaseUrl: string;
  /**
   * Provide a pre-built drizzle instance (tests / shared pool). When omitted
   * one is created from `databaseUrl` with a lazily-reused postgres client.
   */
  db?: PostgresJsDatabase<typeof schema>;
}

export class DrizzleAppStateRepo implements AppStateRepo {
  private readonly db: PostgresJsDatabase<typeof schema>;

  constructor(opts: DrizzleAppStateRepoOptions) {
    if (opts.db) {
      this.db = opts.db;
    } else if (opts.databaseUrl) {
      const client = postgres(opts.databaseUrl);
      this.db = drizzle(client, { schema });
    } else {
      throw new Error("DrizzleAppStateRepo requires databaseUrl or db");
    }
  }

  // ── derived capture index ────────────────────────────────────────────────

  async upsertCaptureIndex(rows: CaptureIndexRow[]): Promise<void> {
    if (rows.length === 0) return;
    const values = rows.map(toDbRow);
    await this.db
      .insert(captureIndex)
      .values(values)
      .onConflictDoUpdate({
        target: captureIndex.ulid,
        set: {
          path: pgSql`excluded.path`,
          type: pgSql`excluded.type`,
          schemaVersion: pgSql`excluded.schema_version`,
          status: pgSql`excluded.status`,
          kind: pgSql`excluded.kind`,
          source: pgSql`excluded.source`,
          capturedAt: pgSql`excluded.captured_at`,
          processedAt: pgSql`excluded.processed_at`,
          claimedBy: pgSql`excluded.claimed_by`,
          attachments: pgSql`excluded.attachments`,
          originUrl: pgSql`excluded.origin_url`,
          hasProposal: pgSql`excluded.has_proposal`,
          title: pgSql`excluded.title`,
          bodySha256: pgSql`excluded.body_sha256`,
          reindexedAt: pgSql`excluded.reindexed_at`,
        },
      });
  }

  async listInboxIndex(filter: InboxIndexFilter = {}): Promise<InboxIndexPage> {
    const limit = Math.max(1, Math.min(filter.limit ?? DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT));
    const conditions = [];
    if (filter.status) conditions.push(eq(captureIndex.status, filter.status));
    if (filter.cursor) {
      // Keyset pager: cursor is one ulid; rows strictly after it in
      // captured_at DESC, ulid DESC order.
      conditions.push(
        pgSql`(${captureIndex.capturedAt}, ${captureIndex.ulid}) < (
          select captured_at, ulid from ${captureIndex} where ulid = ${filter.cursor}
        )`,
      );
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const found = await this.db
      .select()
      .from(captureIndex)
      .where(where)
      .orderBy(desc(captureIndex.capturedAt), desc(captureIndex.ulid))
      .limit(limit + 1);

    const hasMore = found.length > limit;
    const page = hasMore ? found.slice(0, limit) : found;
    return {
      rows: page.map(fromDbRow),
      nextCursor: hasMore ? page[page.length - 1].ulid : null,
    };
  }

  async deleteCaptureIndex(ulids: string[]): Promise<void> {
    if (ulids.length === 0) return;
    await this.db.delete(captureIndex).where(inArray(captureIndex.ulid, ulids));
  }

  async clearCaptureIndex(): Promise<void> {
    // Interpolating the drizzle table yields the schema-qualified name
    // ("nexalog"."capture_index"), independent of the client's search_path.
    await this.db.execute(pgSql`truncate table ${captureIndex}`);
  }

  async getCaptureIndexRow(ulid: string): Promise<CaptureIndexRow | null> {
    const rows = await this.db
      .select()
      .from(captureIndex)
      .where(eq(captureIndex.ulid, ulid))
      .limit(1);
    return rows.length > 0 ? fromDbRow(rows[0]) : null;
  }

  /**
   * TRUNCATE-and-rebuild inside ONE transaction, guarded by a transaction-
   * scoped advisory lock so two concurrent rebuilders serialize.
   */
  async rebuildCaptureIndex(
    rows: CaptureIndexRow[],
    lockKey = 728391,
  ): Promise<void> {
    const db = this.db;
    await db.transaction(async (tx) => {
      await tx.execute(pgSql`select pg_advisory_xact_lock(${lockKey})`);
      await tx.execute(pgSql`truncate table ${captureIndex}`);
      if (rows.length > 0) {
        await tx
          .insert(captureIndex)
          .values(rows.map(toDbRow))
          .onConflictDoUpdate({
            target: captureIndex.ulid,
            set: {
              path: pgSql`excluded.path`,
              status: pgSql`excluded.status`,
              title: pgSql`excluded.title`,
              reindexedAt: pgSql`excluded.reindexed_at`,
            },
          });
      }
    });
  }

  // ── read state ───────────────────────────────────────────────────────────

  async markRead(captureId: Ulid, readAt: Date, userId = "operator"): Promise<void> {
    await this.db
      .insert(readState)
      .values({ userId, itemPath: readStatePath(captureId), readAt })
      .onConflictDoNothing({
        target: [readState.userId, readState.itemPath],
      });
  }

  async isRead(captureId: Ulid, userId = "operator"): Promise<boolean> {
    const rows = await this.db
      .select({ id: readState.id })
      .from(readState)
      .where(
        and(eq(readState.userId, userId), eq(readState.itemPath, readStatePath(captureId))),
      )
      .limit(1);
    return rows.length > 0;
  }

  // ── api tokens ───────────────────────────────────────────────────────────

  async createApiToken(name: string): Promise<ApiTokenCreated> {
    // 32 random bytes → base64url; the plaintext token is returned exactly
    // once and only its sha256 hex reaches the database.
    const raw = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
    const token = `nex_${raw}`;
    const tokenHash = sha256Hex(token);
    const tokenPrefix = token.slice(0, TOKEN_PREFIX_LEN);

    const inserted = await this.db
      .insert(apiTokens)
      .values({ name, tokenHash, tokenPrefix })
      .onConflictDoUpdate({
        target: apiTokens.name,
        set: { tokenHash, tokenPrefix, revokedAt: null, lastUsedAt: null },
      })
      .returning({
        id: apiTokens.id,
        createdAt: apiTokens.createdAt,
      });

    return {
      id: inserted[0].id,
      name,
      tokenPrefix,
      token,
      tokenHash,
      createdAt: inserted[0].createdAt,
    };
  }

  async verifyApiToken(token: string): Promise<ApiTokenView | null> {
    const presented = sha256Hex(token);
    // Fetch active candidates and compare constant-time. The unique index on
    // token_hash means at most one row can match, but we avoid leaking which
    // row matched via early-exit timing on mis-hashed input.
    const candidates = await this.db
      .select()
      .from(apiTokens)
      .where(isNull(apiTokens.revokedAt));

    let match: (typeof candidates)[number] | null = null;
    for (const row of candidates) {
      if (timingSafeEqualHex(presented, row.tokenHash)) match = row;
    }
    if (!match) return null;

    const updated = await this.db
      .update(apiTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiTokens.id, match.id))
      .returning({
        id: apiTokens.id,
        name: apiTokens.name,
        tokenPrefix: apiTokens.tokenPrefix,
        createdAt: apiTokens.createdAt,
        lastUsedAt: apiTokens.lastUsedAt,
        revokedAt: apiTokens.revokedAt,
      });

    const r = updated[0];
    return {
      id: r.id,
      name: r.name,
      tokenPrefix: r.tokenPrefix,
      createdAt: r.createdAt,
      lastUsedAt: r.lastUsedAt,
      revokedAt: r.revokedAt,
    };
  }

  async revokeApiToken(name: string): Promise<void> {
    await this.db
      .update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(eq(apiTokens.name, name));
  }

  async listApiTokens(): Promise<ApiTokenView[]> {
    const rows = await this.db
      .select({
        id: apiTokens.id,
        name: apiTokens.name,
        tokenPrefix: apiTokens.tokenPrefix,
        createdAt: apiTokens.createdAt,
        lastUsedAt: apiTokens.lastUsedAt,
        revokedAt: apiTokens.revokedAt,
      })
      .from(apiTokens)
      .orderBy(desc(apiTokens.createdAt));
    return rows;
  }
}

// ── mapping helpers ─────────────────────────────────────────────────────────

type DbInsertRow = typeof captureIndex.$inferInsert;

function readStatePath(captureId: Ulid): string {
  return `inbox/${captureId.value}.md`;
}

function toDbRow(r: CaptureIndexRow): DbInsertRow {
  return {
    ulid: r.ulid,
    path: r.path,
    type: r.type,
    schemaVersion: r.schemaVersion,
    status: r.status,
    kind: r.kind,
    source: r.source,
    capturedAt: r.capturedAt,
    processedAt: r.processedAt,
    claimedBy: r.claimedBy,
    attachments: r.attachments,
    originUrl: r.originUrl,
    hasProposal: r.hasProposal,
    title: r.title,
    bodySha256: r.bodySha256,
    reindexedAt: r.reindexedAt,
  };
}

type DbSelectRow = typeof captureIndex.$inferSelect;

function fromDbRow(row: DbSelectRow): CaptureIndexRow {
  return {
    ulid: row.ulid,
    path: row.path,
    type: row.type,
    schemaVersion: row.schemaVersion,
    status: row.status as CaptureStatus,
    kind: row.kind,
    source: row.source,
    capturedAt: row.capturedAt,
    processedAt: row.processedAt ?? null,
    claimedBy: row.claimedBy ?? null,
    attachments: row.attachments ?? [],
    originUrl: row.originUrl ?? null,
    hasProposal: row.hasProposal,
    title: row.title,
    bodySha256: row.bodySha256 ?? null,
    reindexedAt: row.reindexedAt,
  };
}
