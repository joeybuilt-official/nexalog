-- 0018 — Offline-sync surface (ADR-0001/0002/0003).
-- Additive + idempotent: delta-cursor (updated_at) + soft-delete tombstone
-- (deleted_at) on the synced entities that lack them, plus an opId idempotency
-- ledger for POST /api/sync/mutations. Safe to re-run on prod.

ALTER TABLE "nexalog"."capture_sources"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;

ALTER TABLE "nexalog"."bookmark_collections"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;

ALTER TABLE "nexalog"."journal_entries"
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;

-- Backfill: seed updated_at from created_at on pre-existing rows so a first
-- delta pull with since=0 returns everything once, then stays incremental.
UPDATE "nexalog"."capture_sources"     SET "updated_at" = "created_at" WHERE "updated_at" < "created_at";
UPDATE "nexalog"."bookmark_collections" SET "updated_at" = "created_at" WHERE "updated_at" < "created_at";

CREATE TABLE IF NOT EXISTS "nexalog"."sync_mutation_log" (
  "op_id"      text PRIMARY KEY,
  "user_id"    text NOT NULL,
  "entity"     text NOT NULL,
  "op"         text NOT NULL,
  "target_id"  text,
  "applied_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "sync_mutation_log_user_id_idx"
  ON "nexalog"."sync_mutation_log" ("user_id");
