-- SPDX-License-Identifier: MIT
-- 0009_graph_ingestion
--
-- Tracks which nexalog notes/bookmarks have been ingested into the
-- Plexo/Graphiti knowledge graph (as Episodics tagged app:nexalog), so the
-- themes-forest + synthesis engine cluster the user's actual content rather
-- than only Plexo's agent-operational memory. Ingest-once, keyed by
-- (item_kind, item_id); content_hash supports a future re-ingest-on-change
-- pass.
--
-- Additive new table, IF NOT EXISTS — re-run safe, no backfill.

CREATE TABLE IF NOT EXISTS nexalog.graph_ingestion (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    item_kind text NOT NULL,
    item_id uuid NOT NULL,
    episode_id text,
    content_hash text NOT NULL,
    ingested_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS graph_ingestion_item_uidx
    ON nexalog.graph_ingestion(item_kind, item_id);

CREATE INDEX IF NOT EXISTS graph_ingestion_ws_idx
    ON nexalog.graph_ingestion(workspace_id);
