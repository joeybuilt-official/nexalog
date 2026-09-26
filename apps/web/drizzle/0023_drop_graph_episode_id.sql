-- P10: drop dead `ideas.graph_episode_id` column.
-- graphiti ingest was never wired; this column has 0 readers and 0 writers.
-- DO NOT APPLY without operator sign-off.
-- pairs with lib/db/schema.ts ideas table (graphEpisodeId removed).
ALTER TABLE nexalog.ideas DROP COLUMN IF EXISTS graph_episode_id;
