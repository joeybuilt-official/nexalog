# ADR-0005 — Knowledge-graph schema, node-merge & re-ingest

**Status:** Proposed — **operator approval required before Phase 3.4.**
**Date:** 2026-06-13 · **One-way doors:** KG schema (Plexo/Graphiti-owned); the dedicated graph-workspace UUID salt; the cost of a full re-ingest.

## Context
The knowledge graph lives in Plexo/Graphiti/FalkorDB; Nexalog tracks `graph_ingestion` (4566 episodes). Entity-type forwarding now works (8 types sent — the plan doc was stale). Remaining problems (audit §2, §5): identical-entity **duplicates** ("VLine CarPlay" ×2) with **no Plexo node-merge verb** (only read-only `/graph/cypher`); edit/delete cascade is best-effort → corpus↔graph drift. Improving dedup quality may require re-ingesting ~3000 episodes at ~60–180s/item — real LLM cost and hours.

## Decision to make
(a) Approve adding a Graphiti **node-merge** capability to the Jex contract (cross-repo — see ADR-0006). (b) Approve (or bound) a **full re-ingest** for dedup quality. (c) Confirm the graph-workspace salt is frozen.

## Options
1. **Node-merge endpoint + targeted re-ingest of duplicate clusters only** (cheaper, throttled, checkpointed).
2. **Node-merge + full re-ingest** (best quality, expensive — burns Plexo credits + hours).
3. **Defer dedup**; ship better render-time filtering (`minDegree`, singleton pruning) without touching the graph store (reversible, no cost).

## Recommendation
Option 1, with the optimization-plan pre-mortem guardrail: **checkpoint theme/dedup quality on a sample before committing to any full re-ingest.** Never change the graph-workspace salt (`lib/plexo.ts:87`) — it orphans every prior episode. Do not pin a provider; size the Plexo workspace.

## Consequences
- Commits a node-merge shape into the Jex/Graphiti contract (one-way).
- Bounded, authorized Plexo cost; preserves all existing graphs.

## Open question for operator
Approve Option 1 + the node-merge contract addition? What is the cost ceiling for re-ingest before a checkpoint?
