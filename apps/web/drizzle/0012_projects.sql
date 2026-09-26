-- 0012_projects.sql
-- NEXALOG-PROJECTS — Project container (registry owned by Nexalog) + grouping
-- by reference. Brainstorm Work history lives Plexo-side, referenced by
-- plexo_session_id; never duplicated here. See plans/projects/adr/0001.

CREATE TABLE IF NOT EXISTS nexalog.projects (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           uuid NOT NULL,
  user_id                text NOT NULL,
  name                   text NOT NULL,
  description            text,
  lifecycle_state        text NOT NULL DEFAULT 'active'
                           CHECK (lifecycle_state IN ('draft','active','archived')),
  living_doc             text NOT NULL DEFAULT '',
  living_doc_updated_at  timestamptz,
  plexo_session_id       text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz
);

CREATE INDEX IF NOT EXISTS projects_workspace_id_idx     ON nexalog.projects (workspace_id);
CREATE INDEX IF NOT EXISTS projects_user_id_idx          ON nexalog.projects (user_id);
CREATE INDEX IF NOT EXISTS projects_lifecycle_state_idx  ON nexalog.projects (lifecycle_state);

CREATE TABLE IF NOT EXISTS nexalog.project_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES nexalog.projects(id) ON DELETE CASCADE,
  item_kind   text NOT NULL CHECK (item_kind IN ('note','bookmark','journal')),
  item_id     uuid NOT NULL,
  added_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS project_items_uidx
  ON nexalog.project_items (project_id, item_kind, item_id);
CREATE INDEX IF NOT EXISTS project_items_project_id_idx ON nexalog.project_items (project_id);
CREATE INDEX IF NOT EXISTS project_items_item_idx       ON nexalog.project_items (item_kind, item_id);
