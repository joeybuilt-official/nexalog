-- Nexalog v2 app-state bootstrap (Phase 1)
-- Run via psql (prefer drizzle-kit for incremental migrations; this is bootstrap).

-- 1) As superuser on postgres:
CREATE DATABASE nexalog_v2;

-- 2) Reconnect: psql -d nexalog_v2
CREATE SCHEMA IF NOT EXISTS nexalog;
SET search_path TO nexalog;

-- NOTE: no `auth` schema is created here. v2's Better Auth points at the
-- SHARED `auth` schema in the existing Better Auth database (single identity).

CREATE TABLE capture_index (
  ulid             text PRIMARY KEY,
  path             text NOT NULL,
  type             text NOT NULL DEFAULT 'note',
  schema_version   integer NOT NULL DEFAULT 1,
  status           text NOT NULL DEFAULT 'inbox',
  kind             text NOT NULL DEFAULT 'note',
  source           text NOT NULL DEFAULT 'pwa-share',
  captured_at      timestamptz NOT NULL,
  processed_at     timestamptz,
  claimed_by       text,
  attachments      jsonb NOT NULL DEFAULT '[]'::jsonb,
  origin_url       text,
  has_proposal     boolean NOT NULL DEFAULT false,
  title            text NOT NULL DEFAULT '',
  body_sha256      text,
  reindexed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX capture_index_path_uq ON capture_index (path);
CREATE INDEX capture_index_status_captured_idx ON capture_index (status, captured_at DESC);
CREATE INDEX capture_index_hot_idx ON capture_index (captured_at DESC)
  WHERE status IN ('inbox', 'processing', 'review');

CREATE TABLE api_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  token_hash   text NOT NULL,
  token_prefix text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CREATE UNIQUE INDEX api_tokens_token_hash_uq ON api_tokens (token_hash);
CREATE UNIQUE INDEX api_tokens_name_uq ON api_tokens (name);

CREATE TABLE read_state (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   text NOT NULL,
  item_path text NOT NULL,
  read_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX read_state_user_item_uq ON read_state (user_id, item_path);
CREATE INDEX read_state_user_idx ON read_state (user_id);
