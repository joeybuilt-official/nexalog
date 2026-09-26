-- SPDX-License-Identifier: MIT
-- Phase 11 — Team Hotel — capture lifecycle: classification, open tracking,
-- staleness scoring, smart archive.
--
-- Adds the columns the content-type hoppers (/app/watch, /app/reading,
-- /app/reference) and the nightly stale-archive cron need to operate on
-- top of the existing capture_sources rows.
--
-- Apply via:
--   docker exec -i postgres psql -U postgres -d appdb \
--     -f - < lib/db/migrations/0001_capture_lifecycle.sql

ALTER TABLE nexalog.capture_sources
  ADD COLUMN IF NOT EXISTS kind_classified   text,
  ADD COLUMN IF NOT EXISTS classified_at     timestamptz,
  ADD COLUMN IF NOT EXISTS last_opened_at    timestamptz,
  ADD COLUMN IF NOT EXISTS open_count        int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_checked_at   timestamptz,
  ADD COLUMN IF NOT EXISTS http_status       int,
  ADD COLUMN IF NOT EXISTS staleness_score   real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS staleness_reason  text,
  ADD COLUMN IF NOT EXISTS smart_archived_at timestamptz;

CREATE INDEX IF NOT EXISTS capture_sources_kind_idx
  ON nexalog.capture_sources (workspace_id, kind_classified);

CREATE INDEX IF NOT EXISTS capture_sources_staleness_idx
  ON nexalog.capture_sources (workspace_id, staleness_score DESC)
  WHERE smart_archived_at IS NULL;

CREATE INDEX IF NOT EXISTS capture_sources_last_opened_idx
  ON nexalog.capture_sources (workspace_id, last_opened_at);
