-- db/gbrain/0001_take_proposals_plan_diff.sql
-- PLAN-CHANGE PROPOSALS — one additive column on gbrain's `take_proposals`.
--
-- A plan-impact reconciler (Nexalog) watches for captures that are relevant to an
-- existing project page and proposes a change to that project's plan. The proposal
-- rides the queue PR #21 already built (ONE queue, never a second one) with
-- `kind = 'plan_change'` — and a plan change needs to carry structured detail that
-- a take does not: which operation, on which milestone, from what to what, why, and
-- which capture is the evidence. That is what `plan_diff` holds:
--
--   { op: add|modify|reprioritize|remove,
--     milestone_id, current, proposed, rationale, evidence_capture, confidence }
--
-- WHY THIS IS SAFE TO ADD TO A LIVE TABLE
-- ---------------------------------------
-- Additive and nullable, with no DEFAULT: every one of the 262 existing rows keeps
-- its exact current value (NULL), Postgres 11+ records the column without rewriting
-- the table, and no reader of `take_proposals` is affected by its presence. Nothing
-- is dropped or renamed. `IF NOT EXISTS` makes a re-run a no-op.
--
-- WHY THERE IS NO CHECK CONSTRAINT HERE
-- ------------------------------------
-- This table belongs to gbrain, not to us. A CHECK we add is a constraint on
-- gbrain's OWN future writes, and a shape rule invented by a foreign writer is a
-- way to make another product's INSERT fail at 3am. The shape contract lives where
-- it can be changed without touching a live table: `parsePlanDiff` in
-- `packages/core/src/domain/plan-impact.ts` (which coerces a hand-written or
-- legacy row into a legible diff or drops it, rather than trusting the column) and
-- the DTO that renders it. The column is deliberately unconstrained and nullable.
--
-- WHICH DATABASE THIS TARGETS — READ BEFORE APPLYING
-- --------------------------------------------------
-- `take_proposals` lives in **gbrain's own Postgres** (`gbrain` database, `public`
-- schema) — NOT in the shared `pushd` database the Nexalog app's drizzle chain
-- targets, and NOT in the `nexalog` schema. The two are different servers on
-- different Docker networks. This file is therefore NOT part of `apps/web/drizzle/`
-- (that chain is `nexalog`-scoped and its journal belongs to a sibling app; see
-- `.agents/rules/database.md` → "This repository runs against a SHARED database").
-- It is hand-applied — with a reviewed, ON_ERROR_STOP psql session — and it is the
-- RECORD, not the applier. Imitated in form from
-- `apps/web/drizzle/0028_project_items_kind_project.sql`.
--
-- No writer coordination is needed for this table: gbrain's `managed_writer_guard`
-- trigger fires on `facts`, `pages`, `takes` and `timeline_entries` only —
-- verified against the live catalog (`pg_trigger`). `take_proposals` is the proposal
-- channel precisely because it is outside that fence, which is what makes it safe
-- for a second writer to emit into.
--
-- Apply by hand:
--   psql "$GBRAIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/gbrain/0001_take_proposals_plan_diff.sql
--
-- Verify after applying (catalog query — not the command's exit status):
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--    WHERE table_name = 'take_proposals' AND column_name = 'plan_diff';
--   -- expect: plan_diff | jsonb | YES
--
-- Idempotent: safe to re-run (ADD COLUMN IF NOT EXISTS).
-- Forward-only: nothing is dropped, renamed, or backfilled.

BEGIN;

ALTER TABLE public.take_proposals
  ADD COLUMN IF NOT EXISTS plan_diff jsonb;

COMMIT;
