-- Phase 12: full-text search column on capture_sources.
-- Weighted concat over og_title (A), og_description (B), summary (B),
-- extracted_text (C), url (D). Generated stored column kept fresh by Postgres
-- so the lexical path can use real BM25-style ranking via ts_rank_cd.

ALTER TABLE nexalog.capture_sources
  ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(og_title, '')),       'A') ||
    setweight(to_tsvector('english', coalesce(og_description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(summary, '')),        'B') ||
    setweight(to_tsvector('english', coalesce(extracted_text, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(url, '')),            'D')
  ) STORED;

CREATE INDEX IF NOT EXISTS capture_sources_fts_idx
  ON nexalog.capture_sources USING gin (fts);
