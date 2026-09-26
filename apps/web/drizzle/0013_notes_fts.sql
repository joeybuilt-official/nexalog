-- SPDX-License-Identifier: MIT
-- Phase 1.1: full-text search parity for notes.
-- Weighted concat over title (A) and content (B). Generated stored column kept
-- fresh by Postgres so the lexical path can use real ts_rank_cd ranking,
-- mirroring drizzle/0003_capture_sources_fts.sql.

ALTER TABLE nexalog.notes
  ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')),   'A') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS notes_fts_idx
  ON nexalog.notes USING gin (fts);
