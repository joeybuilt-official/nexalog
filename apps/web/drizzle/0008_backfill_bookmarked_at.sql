-- SPDX-License-Identifier: MIT
--
-- 0008 backfill — flag legacy Telegram-imported rows.
--
-- Pre-fix Telegram bookmark imports (any rows clustered tightly around
-- the import timestamp from the bookmarks:telegram_json import job)
-- never persisted the per-message date. The raw export is gone, so
-- bookmarked_at is irrecoverable for those rows. We at least mark
-- import_source='telegram' + imported_at so the dashboard/UI can
-- display "imported on …" honestly and a future re-import can update.
--
-- Heuristic: capture rows in workspaces that ran a 'bookmarks:telegram_json'
-- import, whose `created_at` lands within +/- 60s of the import row's
-- created_at, and that don't already carry an import_source.
--
-- Karakeep — no rows currently match (no in-app Karakeep importer was
-- shipped before this migration), so the pattern is harmless if the
-- imports table grows one later.

-- ── Telegram backfill ───────────────────────────────────────────────────
WITH tg_imports AS (
  SELECT id, workspace_id, created_at AS import_run_at
  FROM nexalog.imports
  WHERE kind LIKE 'bookmarks:telegram_json%'
)
UPDATE nexalog.capture_sources cs
SET
  import_source = 'telegram',
  imported_at = ti.import_run_at
FROM tg_imports ti
WHERE cs.workspace_id = ti.workspace_id
  AND cs.kind = 'url'
  AND cs.import_source IS NULL
  AND cs.created_at BETWEEN ti.import_run_at - INTERVAL '60 seconds'
                        AND ti.import_run_at + INTERVAL '600 seconds';

-- ── Karakeep backfill ───────────────────────────────────────────────────
-- Mirror of the Telegram block. No-op today (no Karakeep imports
-- registered), included so re-running the migration after a Karakeep
-- import correctly back-stamps source_payload-less rows.
WITH kk_imports AS (
  SELECT id, workspace_id, created_at AS import_run_at
  FROM nexalog.imports
  WHERE kind LIKE 'bookmarks:karakeep_json%'
)
UPDATE nexalog.capture_sources cs
SET
  import_source = 'karakeep',
  imported_at = ki.import_run_at
FROM kk_imports ki
WHERE cs.workspace_id = ki.workspace_id
  AND cs.kind = 'url'
  AND cs.import_source IS NULL
  AND cs.created_at BETWEEN ki.import_run_at - INTERVAL '60 seconds'
                        AND ki.import_run_at + INTERVAL '600 seconds';

-- ── source_payload re-derivation (when present) ─────────────────────────
-- For rows whose import did persist source_payload, lift the upstream
-- date into bookmarked_at. Telegram payload key is 'date' (ISO string);
-- Karakeep is 'createdAt'.
UPDATE nexalog.capture_sources
SET bookmarked_at = (source_payload->>'date')::timestamptz
WHERE bookmarked_at IS NULL
  AND import_source = 'telegram'
  AND source_payload IS NOT NULL
  AND source_payload ? 'date';

UPDATE nexalog.capture_sources
SET bookmarked_at = (source_payload->>'createdAt')::timestamptz
WHERE bookmarked_at IS NULL
  AND import_source = 'karakeep'
  AND source_payload IS NOT NULL
  AND source_payload ? 'createdAt';
