-- Ideas — first-class idea taxonomy (ADR-0008).
--
-- An IDEA is a thinking-unit: an observation, question, claim, principle,
-- method, story, or heuristic the operator has captured, extracted from a
-- source, or that synthesis has surfaced from a cross-source pattern.
--
-- Three orthogonal axes:
--   shape      — what kind of thinking-unit (observation/question/claim/...)
--   maturity   — how developed (spark → kernel → formed → tested → applied)
--   provenance — where it came from (extracted / curated / synthesized)
--
-- Distinct from `extraction_candidates`, which is a per-import review queue
-- for raw LLM-extracted snippets (state: pending/accepted/rejected). Ideas
-- are durable first-class objects; extraction_candidates feeds ideas via the
-- accept flow. The two coexist deliberately.

CREATE TABLE IF NOT EXISTS nexalog.ideas (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                uuid NOT NULL,
  user_id                     text NOT NULL,
  title                       text NOT NULL,
  body                        text NOT NULL DEFAULT '',
  shape                       text NOT NULL,
  maturity                    text NOT NULL DEFAULT 'spark',
  provenance                  text NOT NULL,
  source_kind                 text,        -- 'note' | 'bookmark' | 'transcript' | 'conversation' | 'cluster' | NULL (curated)
  source_id                   uuid,        -- FK-shaped (no DB FK — polymorphic by source_kind)
  source_label                text,        -- short human label of source (cached for list views)
  theme_id                    text,        -- soft ref to memory_themes.theme_id (for synthesized + co-located extracts)
  promoted_from_candidate_id  uuid,        -- FK to extraction_candidates.id; non-null = promoted via /accept
  embedding                   vector(384), -- plexo-embed-v1; HNSW indexed below
  embedding_state             text NOT NULL DEFAULT 'pending',  -- pending | embedding | ready | failed | skipped
  embedded_at                 timestamptz,
  embedding_dimensions        integer,
  graph_episode_id            text,        -- non-null after ingestion into Graphiti
  status                      text NOT NULL DEFAULT 'active',   -- active | archived | dismissed
  metadata                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- Enum guards. Kept as CHECK constraints (not pg enums) so adding values is
-- a one-line migration. Lists mirror lib/ideas/types.ts.
ALTER TABLE nexalog.ideas
  ADD CONSTRAINT ideas_shape_check
  CHECK (shape IN (
    'observation','question','claim','principle','method','story','heuristic'
  ));

ALTER TABLE nexalog.ideas
  ADD CONSTRAINT ideas_maturity_check
  CHECK (maturity IN ('spark','kernel','formed','tested','applied'));

ALTER TABLE nexalog.ideas
  ADD CONSTRAINT ideas_provenance_check
  CHECK (provenance IN ('extracted','curated','synthesized'));

ALTER TABLE nexalog.ideas
  ADD CONSTRAINT ideas_status_check
  CHECK (status IN ('active','archived','dismissed'));

ALTER TABLE nexalog.ideas
  ADD CONSTRAINT ideas_embedding_state_check
  CHECK (embedding_state IN ('pending','embedding','ready','failed','skipped'));

-- Workspace-scoped list, default ordering by recency.
CREATE INDEX IF NOT EXISTS ideas_workspace_created_at_idx
  ON nexalog.ideas (workspace_id, created_at DESC);

-- Facet filters on the listing page.
CREATE INDEX IF NOT EXISTS ideas_workspace_shape_idx
  ON nexalog.ideas (workspace_id, shape) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS ideas_workspace_maturity_idx
  ON nexalog.ideas (workspace_id, maturity) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS ideas_workspace_provenance_idx
  ON nexalog.ideas (workspace_id, provenance) WHERE status = 'active';

-- Source lookups (e.g. "show me every idea extracted from this note").
CREATE INDEX IF NOT EXISTS ideas_source_idx
  ON nexalog.ideas (source_kind, source_id) WHERE source_id IS NOT NULL;

-- Theme co-location lookups (synthesized ideas hang off themes).
CREATE INDEX IF NOT EXISTS ideas_workspace_theme_idx
  ON nexalog.ideas (workspace_id, theme_id) WHERE theme_id IS NOT NULL;

-- Embedding worker pickup. Matches the partial-index pattern used by
-- 0016_video_transcripts.sql for transcript_state.
CREATE INDEX IF NOT EXISTS ideas_embedding_state_pending_idx
  ON nexalog.ideas (embedding_state)
  WHERE embedding_state IN ('pending','failed');

-- Semantic recall. HNSW + cosine ops, same as captureSources / notes.
CREATE INDEX IF NOT EXISTS ideas_embedding_idx
  ON nexalog.ideas USING hnsw (embedding vector_cosine_ops);

-- Full-text search on title+body, weighted A/B. Mirrors notes + capture_sources FTS.
ALTER TABLE nexalog.ideas
  ADD COLUMN IF NOT EXISTS fts tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body, '')),  'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS ideas_fts_idx ON nexalog.ideas USING gin (fts);

-- Track which extraction_candidates have already been promoted (so the same
-- candidate can't double-create an idea on a re-accept).
CREATE UNIQUE INDEX IF NOT EXISTS ideas_promoted_from_uidx
  ON nexalog.ideas (promoted_from_candidate_id)
  WHERE promoted_from_candidate_id IS NOT NULL;
