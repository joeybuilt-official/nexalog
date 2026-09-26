-- 0010_page_visits.sql
-- Web-history capture: a lightweight, separate pipe from capture_sources.
-- No OG/LLM/Graphiti enrichment ever runs on these rows (see ADR 0001).

CREATE TABLE IF NOT EXISTS nexalog.page_visits (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL,
  user_id       text NOT NULL,
  url           text NOT NULL,
  url_host      text,
  title         text,
  visited_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS page_visits_workspace_user_idx ON nexalog.page_visits (workspace_id, user_id);
CREATE INDEX IF NOT EXISTS page_visits_url_idx            ON nexalog.page_visits (url);
CREATE INDEX IF NOT EXISTS page_visits_created_at_idx     ON nexalog.page_visits (created_at);

-- History preferences live on the existing per-user preferences row.
ALTER TABLE nexalog.user_preferences
  ADD COLUMN IF NOT EXISTS save_page_visits      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS history_denylist      text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS history_retention_days integer NOT NULL DEFAULT 90;
