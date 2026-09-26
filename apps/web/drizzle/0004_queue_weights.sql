-- Phase 12 — capture_sources.metadata jsonb (free_versions cache, near-duplicate refs)
ALTER TABLE nexalog.capture_sources
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS capture_sources_metadata_gin_idx
  ON nexalog.capture_sources USING GIN (metadata);

-- Phase 12 — learned per-workspace queue weights.
-- Persists the IRLS-fitted logistic regression coefficients used by
-- lib/queue/scoring.ts. Falls back to compile-time defaults when a row
-- is missing or the workspace has < 50 feedback signals.

CREATE TABLE IF NOT EXISTS nexalog.queue_weights (
  workspace_id uuid PRIMARY KEY,
  w1 real NOT NULL,            -- theme_growth_14d
  w2 real NOT NULL,            -- recency_evergreen_aware
  w3 real NOT NULL,            -- cross_kind_bonus
  w4 real NOT NULL,            -- opened_today_in_theme penalty
  w5 real NOT NULL,            -- novelty / freshness bump
  intercept real NOT NULL DEFAULT 0,
  sample_count integer NOT NULL DEFAULT 0,
  trained_at timestamptz NOT NULL DEFAULT now(),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS queue_weights_trained_at_idx
  ON nexalog.queue_weights (trained_at);
