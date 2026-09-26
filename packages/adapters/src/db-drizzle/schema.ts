import { sql } from "drizzle-orm";
import {
  pgSchema,
  text,
  integer,
  boolean,
  uuid,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Nexalog v2 APP-STATE schema.
 *
 * Lives in dedicated database `nexalog_v2`, schema `nexalog`. Postgres is APP
 * STATE ONLY: no page text, no inbox bodies, no content ever lands here — the
 * brain repo (markdown + git) is the system of record. capture_index is DERIVED
 * (rebuildable from a frontmatter scan via ReindexRepo).
 *
 * Better Auth tables are deliberately NOT declared here: v2's Better Auth
 * instance points at the SHARED `auth` schema in the existing joeybuilt auth
 * database (single operator, registration disabled), so identity is not forked.
 */
export const nexalog = pgSchema("nexalog");

/** Derived index over the brain repo frontmatter (contract nexalog.schema=1).
 *  Keyed by repo-relative `path` (one row per markdown file); `ulid` is the
 *  capture identity shared with the file name. */
export const captureIndex = nexalog.table(
  "capture_index",
  {
    ulid: text("ulid").primaryKey(),
    path: text("path").notNull(), // relative to ${BRAIN_REPO}, e.g. 'inbox/01J8....md'
    type: text("type").notNull().default("note"), // gbrain-base-v2 type (top-level frontmatter)
    schemaVersion: integer("schema_version").notNull().default(1), // nexalog.schema
    status: text("status").notNull().default("inbox"), // inbox|processing|review|processed|rejected
    kind: text("kind").notNull().default("note"), // note|link|file|audio|image|doc
    source: text("source").notNull().default("pwa-share"), // pwa-share|web|bookmarklet|mcp|telegram
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    // nullable: a capture is only "processed" once it has been; matches the
    // port type (Date | null) and the bootstrap migration (processed_at timestamptz).
    processedAt: timestamp("processed_at", { withTimezone: true }),
    claimedBy: text("claimed_by"), // agent-primary | agent-secondary | null
    attachments: jsonb("attachments").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    originUrl: text("origin_url"),
    hasProposal: boolean("has_proposal").notNull().default(false),
    title: text("title").notNull().default(""),
    // sha256 of body markdown only — lets the index detect file changes without
    // storing any body text (keeps DB content-free)
    bodySha256: text("body_sha256"),
    reindexedAt: timestamp("reindexed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("capture_index_path_uq").on(t.path),
    index("capture_index_status_captured_idx").on(t.status, t.capturedAt.desc()),
    // hot path for /inbox + MCP nexalog_inbox_list: only unfinished captures
    index("capture_index_hot_idx")
      .on(t.capturedAt.desc())
      .where(sql`status in ('inbox', 'processing', 'review')`),
  ],
);

/** One token per agent (agent-primary, agent-secondary) for the v2 MCP server.
 *  Bearer auth; only the sha256 hash is stored, never plaintext. */
export const apiTokens = nexalog.table(
  "api_tokens",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(), // 'agent-primary' | 'agent-secondary'
    tokenHash: text("token_hash").notNull(), // hex sha256 of the bearer token
    tokenPrefix: text("token_prefix").notNull(), // first 8 chars, for display/rotation UX
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("api_tokens_token_hash_uq").on(t.tokenHash),
    uniqueIndex("api_tokens_name_uq").on(t.name),
  ],
);

/** Per-user unread markers for inbox items (read_state port).
 *  Interesting: (user_id, item_path) — one row per read item, insert-on-read. */
export const readState = nexalog.table(
  "read_state",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id").notNull(), // user.id from the SHARED `auth` schema (Better Auth)
    itemPath: text("item_path").notNull(), // brain-repo-relative inbox path
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("read_state_user_item_uq").on(t.userId, t.itemPath),
    index("read_state_user_idx").on(t.userId),
  ],
);
