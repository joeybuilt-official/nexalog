-- SPDX-License-Identifier: MIT
-- V1 enrichment pipeline — full metadata + reader-mode + summary state machine.
--
-- Adds the columns the enrichment worker (lib/enrichment/{metadata,reader,summary}.ts)
-- and the display helpers (lib/captures/display.ts) need to operate idempotently.
--
-- State machine per row:
--   metadata_state : pending → enriching → enriched | failed
--   reader_state   : pending → extracting → ready | failed | skipped
--   summary_state  : pending → generating → ready | failed | skipped
--
-- Partial indexes give the worker a cheap "next batch" scan.
--
-- Apply locally:
--   pnpm db:migrate                            # via drizzle-kit (preferred)
--   # or, raw:
--   docker exec -i postgres psql -U postgres -d appdb \
--     -f - < drizzle/0006_enrichment_pipeline.sql

ALTER TABLE nexalog.capture_sources
  -- Dedicated enrichment OG/twitter fields. Existing `og_title`,
  -- `og_description`, `og_image`, `favicon_url` columns are kept verbatim;
  -- the new fields are populated by the enrichment worker without
  -- clobbering the legacy capture-time path.
  ADD COLUMN IF NOT EXISTS og_description_enriched text,
  ADD COLUMN IF NOT EXISTS og_image_url            text,
  ADD COLUMN IF NOT EXISTS og_site_name            text,
  ADD COLUMN IF NOT EXISTS canonical_url           text,
  ADD COLUMN IF NOT EXISTS summary_state           text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS metadata_state          text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS metadata_fetched_at     timestamptz,
  ADD COLUMN IF NOT EXISTS metadata_attempts       smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metadata_last_error     text,
  ADD COLUMN IF NOT EXISTS reader_html             text,
  ADD COLUMN IF NOT EXISTS reader_text             text,
  ADD COLUMN IF NOT EXISTS reader_state            text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reader_fetched_at       timestamptz,
  ADD COLUMN IF NOT EXISTS video_id                text,
  ADD COLUMN IF NOT EXISTS video_thumbnail_url     text,
  ADD COLUMN IF NOT EXISTS video_duration_seconds  integer;

-- Partial indexes — the worker scans pending/failed rows only. Cheap.
CREATE INDEX IF NOT EXISTS capture_sources_metadata_state_pending_idx
  ON nexalog.capture_sources (metadata_state)
  WHERE metadata_state IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS capture_sources_reader_state_pending_idx
  ON nexalog.capture_sources (reader_state)
  WHERE reader_state IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS capture_sources_summary_state_pending_idx
  ON nexalog.capture_sources (summary_state)
  WHERE summary_state IN ('pending', 'failed');

-- Backfill: existing rows whose extraction already ran reach a terminal state
-- so the worker doesn't re-process them. (Idempotent — safe to re-run.)
UPDATE nexalog.capture_sources
   SET metadata_state = 'enriched',
       metadata_fetched_at = COALESCE(metadata_fetched_at, classified_at, created_at)
 WHERE metadata_state = 'pending'
   AND og_title IS NOT NULL
   AND og_image IS NOT NULL;

UPDATE nexalog.capture_sources
   SET reader_state = 'ready',
       reader_text = COALESCE(reader_text, extracted_text),
       reader_fetched_at = COALESCE(reader_fetched_at, extracted_at)
 WHERE reader_state = 'pending'
   AND extracted_text IS NOT NULL
   AND length(extracted_text) >= 200;

UPDATE nexalog.capture_sources
   SET summary_state = 'ready'
 WHERE summary_state = 'pending'
   AND summary IS NOT NULL
   AND length(summary) > 0;

-- Rows that aren't URL captures shouldn't sit in enrichment queues.
UPDATE nexalog.capture_sources
   SET metadata_state = 'skipped',
       reader_state   = 'skipped',
       summary_state  = 'skipped'
 WHERE kind <> 'url'
   AND (metadata_state = 'pending' OR reader_state = 'pending' OR summary_state = 'pending');
