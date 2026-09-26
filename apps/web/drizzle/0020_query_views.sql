-- P4: saved smart-views (query_views). DO NOT APPLY without operator sign-off.
-- pairs with lib/db/schema.ts queryViews table.
CREATE TABLE nexalog.query_views (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid      NOT NULL REFERENCES nexalog.workspaces(id) ON DELETE CASCADE,
  user_id    text        NOT NULL,
  name       text        NOT NULL,
  query      text        NOT NULL,
  sort_order integer     NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX query_views_workspace_id_idx ON nexalog.query_views(workspace_id);
