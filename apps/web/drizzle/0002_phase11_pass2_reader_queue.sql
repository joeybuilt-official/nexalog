-- Phase 11 pass 2: reader-mode extraction, theme cache, queue feedback.
-- Adds columns to capture_sources and a feedback_signals table for queue learning.

ALTER TABLE nexalog.capture_sources
  ADD COLUMN IF NOT EXISTS extracted_text text,
  ADD COLUMN IF NOT EXISTS extracted_at timestamptz,
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS paywalled boolean,
  ADD COLUMN IF NOT EXISTS read_minutes integer,
  ADD COLUMN IF NOT EXISTS watch_minutes integer,
  ADD COLUMN IF NOT EXISTS theme_id text,
  ADD COLUMN IF NOT EXISTS theme_label text,
  ADD COLUMN IF NOT EXISTS theme_region text,
  ADD COLUMN IF NOT EXISTS opened_at timestamptz;

CREATE INDEX IF NOT EXISTS capture_sources_theme_id_idx
  ON nexalog.capture_sources (theme_id);

CREATE INDEX IF NOT EXISTS capture_sources_theme_region_idx
  ON nexalog.capture_sources (theme_region);

CREATE INDEX IF NOT EXISTS capture_sources_opened_at_idx
  ON nexalog.capture_sources (opened_at);

-- Queue learning signals: every accept/dismiss/snooze on a queue card.
-- Phase 11 just persists; Phase 12 will regress weights.
CREATE TABLE IF NOT EXISTS nexalog.feedback_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  user_id text NOT NULL,
  capture_id uuid NOT NULL,
  action text NOT NULL,            -- 'accept' | 'dismiss' | 'snooze' | 'weekend'
  theme_id text,
  kind text,
  age_bucket text,                 -- '<7d' | '7-30d' | '30-90d' | '90d+'
  evergreen boolean,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feedback_signals_workspace_id_idx
  ON nexalog.feedback_signals (workspace_id);
CREATE INDEX IF NOT EXISTS feedback_signals_capture_id_idx
  ON nexalog.feedback_signals (capture_id);
CREATE INDEX IF NOT EXISTS feedback_signals_created_at_idx
  ON nexalog.feedback_signals (created_at);
