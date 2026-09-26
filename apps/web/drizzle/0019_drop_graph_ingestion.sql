-- 0019_drop_graph_ingestion
-- Paired with drizzle/0009_graph_ingestion.sql. Graphiti-coupled explorer
-- + ingest cut on task/cut-graphiti-explorer (c1f4d21). Drops orphan table.
-- Operator-gated activation 2026-06-27.

DROP TABLE IF EXISTS nexalog.graph_ingestion;
