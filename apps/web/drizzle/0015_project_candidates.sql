-- SPDX-License-Identifier: MIT
-- AI conversation import: discovered (proposed) projects awaiting review.
-- Clustering over imported conversation embeddings proposes projects; the user
-- confirms/dismisses from a review queue before a real `projects` row is made.
-- Mirrors the extraction_candidates review pattern. member_note_ids holds the
-- note ids of the cluster's conversations.
CREATE TABLE IF NOT EXISTS nexalog.project_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  user_id text NOT NULL,
  name text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  member_note_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  project_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_candidates_workspace_id_idx ON nexalog.project_candidates (workspace_id);
CREATE INDEX IF NOT EXISTS project_candidates_import_id_idx ON nexalog.project_candidates (import_id);
CREATE INDEX IF NOT EXISTS project_candidates_status_idx ON nexalog.project_candidates (status);
