# ADR-0003 — Embeddings & clustering ownership (Path A vs Path B)

**Status:** Proposed — **operator approval required before Phase 3.3.**
**Date:** 2026-06-13 · **One-way door:** pgvector model/dimension; the Plexo↔Nexalog intelligence boundary.

## Context
The designed Plexo endpoints `memory/embeddings` (write) and `memory/cluster/compute` both 404 (audit §2). As a workaround, Nexalog grew **Path B**: it owns the pgvector store, runs **local k-means** (`scripts/cluster-themes.ts:77`), and does **RRF fusion** itself (`app/api/search/route.ts:485`), fetching vectors from Plexo's bundled ONNX server directly.

**The conflict (gap matrix #1):**
- *Architect:* Path B is a deliberate, working architecture fork; the cleanup is deleting the dead 404 paths.
- *Synapse:* local k-means + vector ranking inside Nexalog is a borderline-to-clear violation of the hard invariant "Plexo owns ALL intelligence (… ranking/salience …)."

## Decision to make
Path A (build the missing Plexo endpoints, migrate clustering/ranking back to Plexo, restore invariant purity) **or** Path B (formally bless: Nexalog owns vector *storage*, Plexo owns the *model*; clustering/fusion is "query construction," a Nexalog domain concern).

## Options
1. **Path A — restore purity.** Requires Plexo-repo work (the `[X]` endpoints, see ADR-0006). Highest invariant fidelity; highest cross-repo cost.
2. **Path B — bless the fork.** Document the boundary line as "Plexo owns the model + memory/understanding; Nexalog owns the vector index + retrieval fusion." Cheapest; redefines the invariant's edge.
3. **Hybrid — embeddings via Plexo endpoint (Path A for the model write), clustering stays Nexalog (Path B for fusion).**

## Recommendation
Option 3, leaning on the principle that *inference/understanding* is Plexo's and *retrieval-query construction* is Nexalog's domain. Either way: **freeze pgvector at 384-d `plexo-embed-v1`** (changing model/dimension = re-embed everything — a one-way door).

## Consequences
- Sets the durable definition of the Plexo/Nexalog boundary for all future intelligence features.
- Path A/3 require ADR-0006 Jex work scheduled first.

## Open question for operator
Which path? And do you ratify "retrieval fusion = Nexalog domain, inference = Plexo" as the boundary rule?
