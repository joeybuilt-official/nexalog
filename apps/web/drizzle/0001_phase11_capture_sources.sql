-- Phase 11: capture_sources classification + staleness
-- Operator refinement applied: homepage kind + evergreen flag + reference-doesn't-age rule

ALTER TABLE nexalog.capture_sources
  ADD COLUMN IF NOT EXISTS kind_classified text,
  ADD COLUMN IF NOT EXISTS url_host text,
  ADD COLUMN IF NOT EXISTS url_path text,
  ADD COLUMN IF NOT EXISTS og_title text,
  ADD COLUMN IF NOT EXISTS og_type text,
  ADD COLUMN IF NOT EXISTS last_visited_at timestamptz,
  ADD COLUMN IF NOT EXISTS staleness_score real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS staleness_reasons jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS evergreen boolean,
  ADD COLUMN IF NOT EXISTS current_checked_at timestamptz;

CREATE INDEX IF NOT EXISTS capture_sources_kind_classified_idx
  ON nexalog.capture_sources (kind_classified);

CREATE INDEX IF NOT EXISTS capture_sources_url_host_idx
  ON nexalog.capture_sources (url_host);

CREATE INDEX IF NOT EXISTS capture_sources_staleness_idx
  ON nexalog.capture_sources (staleness_score);
