# ADR-0023 — Plan-impact reconciliation: captures propose plan changes

- **Status**: Accepted
- **Date**: 2026-09-28
- **Phase**: second-brain remediation — adaptive plans
- **Related**: ADR-0022 (take-proposal adjudication — this ADR's producer rides that
  queue), ADR-0018 (projects, reference-based containers), ADR-0011 (resurfacing
  lenses), ADR-0017 (retire Plexo-exclusive intelligence)

## Context

ADR-0022 gave `take_proposals` an exit — an operator can now accept or reject a
proposal from `/app/proposals`. What it did not give the table was a **producer
other than gbrain's own extractor**. The queue could therefore report what the
brain had read from pages it already held, and could not report anything about
**what to do next**: a capture saved today, squarely inside an active project, sat
in the bookmark list while the project's plan page went stale, because nothing
connected the two.

Two facts made this buildable now, and both were verified rather than assumed:

1. **`take_proposals` is the only safe channel for a second writer.** gbrain
   enforces its managed-writer protocol with a `managed_writer_guard` trigger, and
   that trigger fires on `facts`, `pages`, `takes` and `timeline_entries` —
   verified against the live catalog (`pg_trigger`). `take_proposals` is outside
   the fence. A proposal channel that a non-gbrain writer may emit into without
   coordinating a page write is exactly what gbrain's own design implies this table
   is for.

2. **A relevance signal already exists, at a usable resolution.** gbrain embeds
   every page (1024-dim) and serves a hybrid vector+keyword search over them; this
   app already holds a client for it. Measured against the live index with URL-only
   queries (the shape a fresh bookmark has before enrichment lands):

   | capture | best project page | cosine |
   | --- | --- | --- |
   | fylo Actions run URL | `projects/fylo` | 0.72 |
   | gbrain issue URL | `projects/gbrain` | 0.65 |
   | panoply repo URL | `projects/panoply` | 0.74 |
   | sourdough recipe | `projects/panoply` | 0.46 |
   | cycling review | `projects/gbrain` | 0.30 |
   | personal-finance article | `projects/fylo` | 0.33 |

   Separately, and this is the measurement that shaped the design: the search
   response's `score` is **useless for a relevance claim**. It is the RRF-fused
   rank score, which folds in keyword hits, a backlink boost and graph adjacency —
   and every project page in this brain links to every other, so they all get
   boosted on every query. A sourdough recipe scored **0.81** against
   `projects/panoply` on `score`. A threshold there would emit a plan change for
   every bookmark ever saved.

## Decision

**A reconciler emits ONE `kind = 'plan_change'` proposal per relevant new capture,
into the queue ADR-0022 built, with the relevance carried as a `cosine` reading
from the brain's own index — and nothing about it is remembered, because
idempotency is enforced by the queue's own unique index.**

1. **One queue, an additive column.** `take_proposals` gains `plan_diff jsonb`
   (nullable, no DEFAULT, no CHECK — see "Consequences"). `kind` is free `TEXT`
   with no constraint on its values, so `plan_change` needs no schema change
   beyond that column. Two queues was the alternative and it is rejected for the
   reason ADR-0022 already gave for one: a second home for the same decision drifts
   from the table gbrain's extractor writes.

2. **Relevance is measured, and the floor is derived.** `pickPlanImpactProject`
   takes the best `type: project` hit whose **`cosine`** clears `0.55` — a value
   that sits in the measured gap between "about this project" (0.65–0.78) and
   "about nothing here" (≤0.46) with ~0.09 of margin on both sides. A candidate
   that reports **no** cosine is rejected rather than defaulted: "the search did
   not say how close this is" and "this is close" are different statements, and
   only the second one supports a decision. The score the proposal carries is
   derived from the cosine (`confidenceFromCosine`), never asserted.

3. **Idempotency is structural.** No ledger, no memo, no cursor. Every field of
   the proposal is derived deterministically from the capture, and
   `content_hash` carries the **capture's id** — so the tuple
   `(source_id, page_slug, content_hash, prompt_version, md5(claim_text))` is
   byte-identical across runs and the table's existing unique index
   `take_proposals_idempotency_idx` refuses the duplicate. A re-run, a retry, two
   concurrent passes and a cold-cache second machine all resolve the same way, none
   of which a ledger survives. The reconciler reports `created: false` for those,
   which is success, not an error.

   `content_hash` is deliberately **not** a digest of the capture's text: og
   metadata and reader text land minutes after the save for the same capture, so a
   text digest would make one capture look like two and emit exactly the duplicate
   this design exists to prevent.

4. **The reconciler proposes one op and only one.** `op: 'add'`, with
   `milestone_id: null` and `current: null`. A reconciler that makes no model call
   has no basis for asserting that a milestone should be **modified**,
   **reprioritized** or **removed** — and a confident, wrong, one-click "remove"
   in front of an operator is worse than a narrow truthful "add". The vocabulary is
   four ops wide so a future producer with a real basis can use them; this producer
   uses one.

5. **The decision surface is the one that exists.** A plan change renders through
   the same `ProposalCard` and the same `POST /api/proposals/[id]/act` route as
   every claim. It gains one block (`PlanDiffBlock`: op, milestone, current →
   proposed, rationale, and a link to the citing capture). A second card component
   would be two renderers for one queue, and they drift.

6. **The pass runs from a route and a script, over one implementation.** `POST
   /api/plan-impact/reconcile` (X-Cron-Secret, or a session) and
   `apps/web/scripts/reconcile-plan-impact.ts` both call
   `runPlanImpactReconcilePass`. An unconfigured queue is a 200 with
   `configured: false` and a typed reason, not a red cron entry — the same rule the
   proposals surface already follows.

## Consequences

**What this buys.** A capture that lands inside a project becomes a decision,
in the queue the operator already reviews. The measured acceptance behaviour is the
plan's own bar: a new bookmark produced **exactly 1** pending plan change, and a
second pass produced **0** more (`created: 0, duplicate: 1`, pending count
unchanged).

**No CHECK constraint on `plan_diff`, and that is a decision.**
`take_proposals` belongs to gbrain. A CHECK we add is a constraint on **gbrain's
own future INSERTs**, and a shape rule invented by a foreign writer is a way to
make another product's write fail at 3am. The shape contract lives where it can
change without touching a live table: `parsePlanDiff` coerces a hand-edited,
legacy or foreign value to `null` (and the card falls back to the claim text),
rather than trusting the column.

**Relevance is a similarity, not a judgement.** The proposal states the cosine and
the floor it cleared — the basis, not a conclusion. An operator who disagrees is
disagreeing with a number they can see, and can reject in one two-step click.

**The column is on a table Nexalog does not own.** It is additive, nullable and
drops nothing; the migration is hand-applied and recorded at
`db/gbrain/0001_take_proposals_plan_diff.sql` rather than in `apps/web/drizzle/`,
because that chain is `nexalog`-scoped and its journal belongs to a sibling app
(`.claude/rules/database.md` → "This repository runs against a SHARED database").

**Not covered, stated plainly.** The reconciler proposes; it does not write a plan.
Accepting a plan change promotes the claim as a **take** on the project page — the
DB plane, with the same markdown-fence caveat ADR-0022 documents — and does **not**
edit the plan page. Closing that loop is a gbrain-side change plus a decision about
what a plan IS in the page's markdown, and this ADR deliberately does not invent
one.

**A pre-existing defect found while probing, NOT fixed here.**
`apps/web/lib/queue/lenses.ts` binds a JS `Date` through drizzle's raw
`db.execute`, which postgres.js rejects with `ERR_INVALID_ARG_TYPE` — reproduced
by execution against the live database, where both `forgottenFilter` and
`relatedEditExclusion` raise on every call. That is the `forgotten` and `related`
queue lenses, shipped in the change that added those routes; it is out of this
change's scope and belongs in its own one-line fix. The plan-impact window binds an
ISO string cast `::timestamptz` for exactly this reason, and a test asserts the
cast, because the two forms are textually identical in the fragment and only
execution distinguishes them.
