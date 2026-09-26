-- WRITE ONLY — DO NOT APPLY (operator-gated, migration branch, §17 gate 5d)
-- U6: typed_object_templates — one row per (workspace, kind, template name).
-- data jsonb holds the default property values to pre-fill on new-object creation.

CREATE TABLE IF NOT EXISTS nexalog.typed_object_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  kind        TEXT NOT NULL,
  name        TEXT NOT NULL,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS typed_object_templates_workspace_kind_idx
  ON nexalog.typed_object_templates (workspace_id, kind);

CREATE UNIQUE INDEX IF NOT EXISTS typed_object_templates_workspace_kind_name_idx
  ON nexalog.typed_object_templates (workspace_id, kind, name);
