-- SPDX-License-Identifier: MIT
--
-- 0008 — bookmark date attribution.
--
-- Imports from Telegram saved-messages and Karakeep were stamping
-- `created_at = now()` instead of preserving the user's original
-- save date. We split timestamps into three explicit columns:
--
--   bookmarked_at  — when the user originally saved the URL (source-supplied)
--   imported_at    — when our import job ran (NULL for non-imported rows)
--   created_at     — row insert time (unchanged)
--
-- Read paths use COALESCE(bookmarked_at, created_at) so existing rows
-- keep working. import_source records the upstream so future backfills
-- can re-derive from source_payload (the raw record we now persist).

ALTER TABLE nexalog.capture_sources
  ADD COLUMN IF NOT EXISTS bookmarked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS imported_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS import_source TEXT,
  ADD COLUMN IF NOT EXISTS source_payload JSONB;

CREATE INDEX IF NOT EXISTS capture_sources_bookmarked_at_idx
  ON nexalog.capture_sources (workspace_id, bookmarked_at DESC NULLS LAST, created_at DESC);

CREATE INDEX IF NOT EXISTS capture_sources_import_source_idx
  ON nexalog.capture_sources (import_source)
  WHERE import_source IS NOT NULL;
