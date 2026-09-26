-- V1 must-haves — Journal as a first-class feature.
-- One entry per user/workspace/day; markdown body; mood/energy 1..5;
-- optional weather snapshot; optional voice source ref (text key, no FK
-- because the voice_notes table is not yet materialized in code).

CREATE TABLE IF NOT EXISTS nexalog.journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  user_id text NOT NULL,
  entry_date date NOT NULL,
  body text NOT NULL DEFAULT '',
  mood smallint,
  energy smallint,
  weather_json jsonb,
  voice_source_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journal_entries_mood_range CHECK (mood IS NULL OR (mood BETWEEN 1 AND 5)),
  CONSTRAINT journal_entries_energy_range CHECK (energy IS NULL OR (energy BETWEEN 1 AND 5))
);

CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_user_workspace_date_idx
  ON nexalog.journal_entries (user_id, workspace_id, entry_date);

CREATE INDEX IF NOT EXISTS journal_entries_workspace_id_idx
  ON nexalog.journal_entries (workspace_id);

CREATE INDEX IF NOT EXISTS journal_entries_entry_date_idx
  ON nexalog.journal_entries (entry_date);
