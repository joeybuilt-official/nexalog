# ADR-0011 — Active resurfacing design

- **Status**: Proposed
- **Date**: 2026-06-27
- **Phase**: P2
- **Owner**: orchestrator (audit-driven)
- **Related**: ADR-0003 (embeddings ownership), ADR-0008 (ideas taxonomy),
  audit-2026-06-27 §3 T1c

## Context

Audit findings:

- Queue ranker is sound (`lib/queue/scoring.ts:62-86`) — 5-feature linear,
  per-workspace learned weights, weekly cron.
- `feedbackSignals` table captures every interaction.
- `memoryThemes` table exists but is **unpopulated** locally
  (`app/api/search/route.ts:769` comment): Plexo `/api/v1/memory/cluster/compute`
  404s (ADR-0003); auto-synthesis cron writes nothing in the default sweep.
- `scripts/cluster-themes.ts` (local k-means, k=18) exists but is **manual
  only — not cron-wired**.
- Resurfacing UX surfaces are thin: the Today page has a `JournalPromo` card
  but no "today's brief" digest of N picks; no "Forgotten" lens; no "Related
  now" lens.
- `feedbackSignals` `snooze` + `weekend` actions are **logged but no-op**
  (`app/api/queue/feedback/route.ts:80`).

The mission asks for "active resurfacing" while explicitly **reusing the
existing queue ranker + feedbackSignals + pgvector + memoryThemes** — do not
build a new ranker.

## Decision

### Three lenses on the Today surface (web + mobile parity)

1. **Daily brief** — top N (default 5) from `/api/queue` rendered as a card on
   `/app/today`. This is just the existing ranker output presented at the
   right surface. No new code beyond a card component.

2. **"Forgotten"** — re-score the ranker over candidates that have **not been
   seen in ≥30d**:
   - Filter: `feedback_signals` has no `view`/`open` for the item in 30d AND
     `notes.updatedAt > now() - 1y`.
   - Re-rank with the existing `scoreCandidate` but **boost** `evergreen`
     items (already a feature in the linear model) and **suppress**
     `opened_today_penalty` (these are by definition not opened today).
   - Pick top 3.

3. **"Related now"** — pgvector-driven:
   - For each note edited in the last 24h, compute centroid embedding.
   - Find top-K (K=10) similar notes not edited in last 7d via `<=>` operator.
   - De-duplicate against (1) and (2); pick top 3.

All three are read-only and rely on **existing tables + existing ranker** —
no new ML, no new clustering, no new weights.

### Auto-synthesis prerequisite (P2-prereq)

`scripts/cluster-themes.ts` is wired into the existing cron at
`app/api/cron/enrichment/route.ts` behind a `LOCAL_CLUSTER=1` env. The cron
runs the script daily (capacity-permitting), reads `embeddings` where
`embedding_state='done'`, runs k-means k=18, writes `memoryThemes` and back-
fills denormalized `capture_sources.theme_*` columns. This populates
`memoryThemes` so the "Related now" lens has a topic-level fallback when
direct pgvector similarity is sparse.

### Feedback feedback-loop: snooze + weekend

- `snooze`: stores `dueAt = now() + 3d` in a new `queue_state(itemId,
  workspaceId, dueAt, source)` table. Queue route filters `dueAt > now()`.
- `weekend`: stores `dueAt = next_monday(weekend_horizon)` — same mechanism,
  computed value.

Both rows are idempotent (UPSERT by `(workspaceId, itemId, source)`); the
existing `feedbackSignals` row is still written for the regression learner.

The regression learner already consumes `feedbackSignals.action` — adding
behavioural effect doesn't change the training data shape.

### What we explicitly do NOT build

- A second ranker. We reuse `scoreCandidate`.
- A new embeddings model. Plexo ONNX 384-d stays.
- A clustering service. `cluster-themes.ts` is the script; cron runs it.
- A new feedback table. `feedbackSignals` is canonical; `queue_state` is a
  thin behavioural mirror.
- A separate digest schedule. The card is computed on page-load (cached for
  6h per workspace) — no email pipeline.

## Consequences

- **Pro**: the queue ranker finally surfaces somewhere a user actually sees.
- **Pro**: `feedbackSignals` rows become loop-closing instead of write-only
  for two actions.
- **Pro**: `memoryThemes` gets populated locally, unblocking M-tier work that
  depends on theme labels.
- **Con**: k-means k=18 is a chosen number — drift over time (operator may
  want to retune). Mitigation: log the silhouette score on each run; flag
  drift > 20%.
- **Con**: `queue_state` is a new table — migration is operator-gated.

## Alternatives considered

- **Daily email digest**: more channels = more code. Defer until web/mobile
  resurfacing measurably underdrives engagement.
- **Spaced-repetition resurfacing (SM-2/FSRS)**: belongs in P7 (spaced
  review), not here. The "Forgotten" lens is a 30d cliff, not a memory model.
- **Recompute themes via Plexo every refresh**: Plexo endpoint 404s; local
  k-means is the only path that ships now.

## Operator decisions still required

- Approve `queue_state` migration before P2-fb commits.
- Confirm k=18 starting point; otherwise propose alternative.
- Set `LOCAL_CLUSTER=1` after P2-prereq's smoke commit.
