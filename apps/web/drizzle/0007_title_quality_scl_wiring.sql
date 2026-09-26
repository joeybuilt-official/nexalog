-- SPDX-License-Identifier: MIT
-- Title quality + SCL/knowledge-graph wiring on top of 0006_enrichment_pipeline.
--
-- Adds:
--   - capture_sources.derived_title         — LLM-rescued title cache
--   - capture_sources.embedding_state       — pending|ready|failed|skipped
--   - capture_sources.embedded_at           — last successful embed timestamp
--   - capture_sources.embedding_dimensions  — vector size returned by Plexo
--   - capture_sources.last_clustered_at     — most recent inclusion in a cluster job
--   - nexalog.memory_themes                 — cluster results materialized per workspace
--
-- Idempotent. Apply locally:
--   pnpm db:migrate
--   # or, raw:
--   docker exec -i postgres psql -U postgres -d appdb \
--     -f - < drizzle/0007_title_quality_scl_wiring.sql

ALTER TABLE nexalog.capture_sources
  ADD COLUMN IF NOT EXISTS derived_title          text,
  ADD COLUMN IF NOT EXISTS embedding_state        text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS embedded_at            timestamptz,
  ADD COLUMN IF NOT EXISTS embedding_dimensions   integer,
  ADD COLUMN IF NOT EXISTS last_clustered_at      timestamptz;

-- Cheap "next batch" partial index for the embeddings worker.
CREATE INDEX IF NOT EXISTS capture_sources_embedding_state_pending_idx
  ON nexalog.capture_sources (embedding_state)
  WHERE embedding_state IN ('pending', 'failed');

-- Materialized cluster results — one row per (workspace_id, theme_id).
-- The cluster job replaces rows wholesale per workspace.
CREATE TABLE IF NOT EXISTS nexalog.memory_themes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL,
  theme_id        text NOT NULL,
  label           text NOT NULL,
  size            integer NOT NULL DEFAULT 0,
  centroid        jsonb,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, theme_id)
);

CREATE INDEX IF NOT EXISTS memory_themes_workspace_id_idx
  ON nexalog.memory_themes (workspace_id);

CREATE INDEX IF NOT EXISTS memory_themes_computed_at_idx
  ON nexalog.memory_themes (computed_at);

-- Backfill rows that already have a title + summary so the embeddings stage
-- can pick them up. Rows that were `enriched` but lack a summary stay
-- `pending` so the embed worker waits for the summary stage.
UPDATE nexalog.capture_sources
   SET embedding_state = 'pending'
 WHERE embedding_state = 'pending'
   AND metadata_state  = 'enriched'
   AND summary_state   = 'ready';

-- Rows that aren't url captures don't need embeddings.
UPDATE nexalog.capture_sources
   SET embedding_state = 'skipped'
 WHERE kind <> 'url'
   AND embedding_state = 'pending';
