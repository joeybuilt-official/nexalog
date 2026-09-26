-- Phase 1 video transcription — Supadata sourcing (ADR-0007).
--
-- New columns on capture_sources for transcript text + state, a long-form
-- structured summary distinct from the existing 2-sentence card preview,
-- and a videoId→transcript cache so re-bookmarking the same video costs
-- zero Supadata credits.

ALTER TABLE nexalog.capture_sources
  ADD COLUMN IF NOT EXISTS transcript             text,
  ADD COLUMN IF NOT EXISTS transcript_state       text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS transcript_source      text,
  ADD COLUMN IF NOT EXISTS transcript_language    text,
  ADD COLUMN IF NOT EXISTS transcript_chars       integer,
  ADD COLUMN IF NOT EXISTS transcript_fetched_at  timestamptz,
  ADD COLUMN IF NOT EXISTS transcript_attempts    smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transcript_last_error  text,
  ADD COLUMN IF NOT EXISTS long_summary           text,
  ADD COLUMN IF NOT EXISTS long_summary_state     text NOT NULL DEFAULT 'pending';

-- Worker picks here. Partial index keeps it tiny.
CREATE INDEX IF NOT EXISTS capture_sources_transcript_state_pending_idx
  ON nexalog.capture_sources (transcript_state)
  WHERE transcript_state IN ('pending','failed');

CREATE INDEX IF NOT EXISTS capture_sources_long_summary_state_pending_idx
  ON nexalog.capture_sources (long_summary_state)
  WHERE long_summary_state IN ('pending','failed');

-- Cross-bookmark cache. Keyed by YouTube videoId (or future platform-prefixed
-- id like "tt:<id>" for TikTok). Worker checks here before paying Supadata.
CREATE TABLE IF NOT EXISTS nexalog.supadata_cache (
  video_id       text PRIMARY KEY,
  transcript     text NOT NULL,
  language       text,
  source         text NOT NULL,
  chars          integer NOT NULL,
  request_id     text,
  fetched_at     timestamptz NOT NULL DEFAULT now()
);

-- Backfill: rows that are not video, or are videos with no videoId, can never
-- be transcribed. Mark them 'skipped' so the worker never sweeps them.
UPDATE nexalog.capture_sources
   SET transcript_state = 'skipped'
 WHERE transcript_state = 'pending'
   AND (kind_classified IS DISTINCT FROM 'video' OR video_id IS NULL);

UPDATE nexalog.capture_sources
   SET long_summary_state = 'skipped'
 WHERE long_summary_state = 'pending'
   AND (kind_classified IS DISTINCT FROM 'video' OR video_id IS NULL);
