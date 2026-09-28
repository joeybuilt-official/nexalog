-- 0028_project_items_kind_project.sql
-- NEXALOG-PROJECTS — sub-projects as reference-based container edges.
--
-- A sub-project is a `project_items` row with `item_kind = 'project'` whose
-- `item_id` is the CHILD project's id: the same reference-based container the
-- item layer already uses, applied one level up (ADR-0018 §D1/§D2). This is the
-- ONLY schema change the sub-project feature needs — the nesting policy itself
-- (one parent per project, at most two levels) is deliberately NOT expressed
-- here. Depth is a property of the domain guard (`MAX_PROJECT_DEPTH` in
-- `apps/web/lib/projects/domain.ts`), enforced in the write path with a 400, so
-- raising the limit later stays a policy change plus a test rather than a
-- migration on populated rows (ADR-0001 Amendment A1.3).
--
-- The existing `project_items_item_kind_check` admits only note/bookmark/journal,
-- so it must be widened before any sub-project row can be written.
--
-- ⚠ FOR THE RECORD ONLY — this file is NOT the applier, and this repository's
-- README-level DB rules differ from the usual toolchain: the `nexalog` schema
-- lives in a Postgres instance SHARED with a sibling app whose drizzle journal
-- (`drizzle.__drizzle_migrations`) this repo does not own. `pnpm db:migrate` and
-- `pnpm db:generate` must never be run against it from this tree, and
-- `pnpm db:push` is banned outright. A human applies this change by hand, scoped
-- to `nexalog.*`, then verifies it against the system catalog. See
-- `.claude/rules/database.md` → "This repository runs against a SHARED database".
--
-- Apply by hand (scoped to the nexalog schema; never `public`, never `auth`):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0028_project_items_kind_project.sql
--
-- Verify after applying (catalog query — not the command's exit status):
--   SELECT pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conname = 'project_items_item_kind_check';
--   -- expect: CHECK ((item_kind = ANY (ARRAY['note'::text, 'bookmark'::text,
--   --                                     'journal'::text, 'project'::text])))
--
-- Idempotent: safe to re-run (DROP … IF EXISTS + a guarded ADD).
-- Forward-only: nothing is dropped except the constraint being replaced.

BEGIN;

-- Widen the kind domain. Both directions are guarded so a re-run is a no-op:
-- the DROP tolerates the constraint already being absent, and the ADD only
-- fires when the constraint is not already in place.
ALTER TABLE nexalog.project_items
  DROP CONSTRAINT IF EXISTS project_items_item_kind_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_items_item_kind_check'
  ) THEN
    ALTER TABLE nexalog.project_items
      ADD CONSTRAINT project_items_item_kind_check
      CHECK (item_kind = ANY (ARRAY['note','bookmark','journal','project']));
  END IF;
END $$;

COMMIT;
