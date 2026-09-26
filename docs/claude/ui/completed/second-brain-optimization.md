# Nexalog — "World-Class Second Brain" Optimization Plan

**Date:** 2026-06-11 · **Driver:** owner reports Nexalog is "mediocre"; concrete complaints = (1) bookmarks render as notes, (2) Today page is old/irrelevant, (3) auto-categories are messy/unusable. Folded into the existing `/phased-plan`.
**Method:** 5 expert sub-agents (knowledge-graph/entity-resolution, information-architecture/taxonomy, PKMS product strategy, ingestion-integrity, search/RAG) each investigated live code + the prod `nexalog` DB. This doc is the synthesis; planning content is full English (caveman-exempt).

## Root causes (evidence-backed)

### RC1 — "Bookmarks show up as notes" (CONFIRMED)
`app/api/capture/route.ts:272-287` inserts a `notes` row for **every** capture, including `kind='url'` bookmarks (`content=URL`, back-linked via `capture_sources.note_id`). The notes surface (`/api/search` notes branch, `app/api/search/route.ts:374-417`) selects all non-deleted notes with no provenance filter. DB proof: **3417 of 3455 notes (99%) are URL bookmarks**; only ~40 are authored. Imports are asymmetric — `import/route.ts` does NOT create notes, so 689 imported URL captures have `note_id=NULL` and never enrich.

### RC2 — Today page "old and irrelevant" (CONFIRMED, by design)
`lib/staleness.ts:153-157` scores unread-age off **`createdAt` only**; `last_visited_at`/`opened_at`/`last_opened_at` are **100% NULL (0/4111)**, so the +0.3 "old & unopened" bonus fires for nearly everything and ranking collapses to pure-oldest. `lib/today/cards-data.ts:131-140` selects `stalenessScore>0.7 ORDER BY score DESC` with no recency/engagement tiebreak. Deeper: Today is a *synthesis loop* (`becoming`/`ripeToFuse`/`goneStale`), not a daily-relevance surface — it lacks open-loops, recency, and due-for-review signals.

### RC3 — "Messy auto-categories" (two distinct layers)
- The clean **25-tag controlled vocabulary** (`bookmark_tags`: "AI & ML" 1024, "Personal" 635, "Business", "Finance", …, 6095 links) is **healthy but dead in the nav** — `bookmark-sidebar.tsx` is unimported; the Bookmarks page navigates by the **emergent theme forest** via `capture_sources.theme_label`: 22 verbose, overlapping labels ("preferences links notes shopping tasks" 471, "AI productivity and assistant tools" 290 vs "AI-powered development platforms" 234). `memory_themes` is empty.
- The **graph entity layer** (graphiti): `lib/plexo.ts:153-161` sends episodes with **no `entity_types`** → every node bare-typed `Entity`; default-only resolution → identical duplicates ("VLine CarPlay…" ×2); no granularity floor / singleton pruning (`explorer-graph.tsx` `minDegree` defaults 0, render-only). Typing/dedup require **Plexo-side endpoints that don't yet exist** (entity-type forwarding, node-merge) + a **full ~3000-episode re-ingest** ($$ + hours). Cross-repo.

### RC4 — Retrieval is architecturally sound but the data layer is empty (HIGH LEVERAGE)
`app/api/search/route.ts` is already a hybrid pipeline (Postgres FTS, A/B/C/D weighted GIN index, + Plexo semantic, fused via RRF). BUT `embedding_state` = **4010 pending / 94 failed / 35 skipped / 0 ready** → semantic search returns nothing, silently degrading to keyword-only; `memory_themes` clustering can't run (gates on ready embeddings); `notes` have **no FTS and no embeddings** (ILIKE only). Graph is retrieval-invisible (feeds only the D3 viz). Chat grounding is recency-picked + uncited. **Draining the embedding backfill unlocks semantic search AND clean clustered themes for cheap** — it is upstream of RC3 (categories) and RC4 (search).

## Pre-mortem (assume failure)
1. **Re-ingest/backfill burns Plexo credits + hours with no visible payoff.** → Throttle batches; checkpoint-judge theme/search quality after the *embedding* backfill (cheap) BEFORE committing to a full graph *re-ingest* (expensive). Don't pin a provider — size the Plexo workspace ([[feedback_no_hardwired_llm_provider]]).
2. **Decoupling bookmarks-from-notes breaks the only working graph ingest path.** DB shows `graph_ingestion` has **only `note` rows (3015); zero bookmark rows** — the graph is built entirely from bookmark *note-twins*. → Do the reversible read-path filter first; reconcile the graph-ingest source before any write-path/schema change.
3. **Today redesign / IA refacet hides data users rely on ("where did my notes go?").** → Additive: keep old surfaces reachable, gate visible removals, deterministic signals first (legible), LLM synthesis as a collapsible secondary lane.

## Phased roadmap (folded into plan.md)

**Phase 6 — Content-type integrity (RC1)**
- 6a [P0, S, low-blast] Notes surface excludes capture-derived notes (`/api/search` notes branch: `NOT EXISTS capture_sources.note_id`). Directly fixes complaint #1. Reversible.
- 6b [P1, M/High-blast, ⚠decision+likely migration] Typed content model: `notes.source`/origin flag, backfill, stop double-writing in `capture/route.ts`; reconcile graph-ingest source first.

**Phase 7 — Daily relevance (RC2)**
- 7a [P1, S, low-blast] Staleness scores off `COALESCE(lastVisitedAt,lastOpenedAt,bookmarkedAt,createdAt)` + recency/engagement tiebreak.
- 7b [P1/P2, ⚠product-design] Rebuild Today around open-loops + recency + triage lanes; rename/cap `goneStale`→"Forgotten gems" (positive reason, not raw decay); synthesis as one collapsible lane.
- 7c [P2, ⚠migration 0010] Wire web-history `last_visited_at` into the scorer.

**Phase 8 — Retrieval unlock (RC4) — do early; unblocks RC3**
- 8a [P0, ⚠prod-cost authorization] Drain the embedding backfill (4010 pending; fix 94 failed) → unlocks semantic search + clustering. Throttled.
- 8b [P1, ⚠migration] Notes FTS (generated tsvector + GIN) across search/notes-search/chat.
- 8c [P2] Cite chat grounding (source IDs + chips); replace recency-notes with ranked.
- 8d [P3] Graph-aware retrieval (cypher fact lookup fused into RRF); `@-mentions` → entities/themes.

**Phase 9 — Category usability (RC3)**
- 9a [P1, M] Make the clean 25-tag controlled vocab the **primary Bookmarks facet** (revive `bookmark-sidebar`); demote emergent `theme_label` to a secondary discovery lens. Reuses healthy data, no model cost.
- 9b [depends on 8a] Recompute `memory_themes` via clustering on now-ready embeddings → replace verbose `theme_label` with cleaner clusters.
- 9c [⚠cross-repo + $$ re-ingest, decision] Graph entity typing + dedup/singleton-prune (needs Plexo `entity_types` forwarding + node-merge endpoints + full re-ingest).

**Phase 10 — Differentiation (P2, later):** spaced-repetition resurfacing; progressive summarization layers; typed graph edges surfacing `fact`.

## Expert-panel conflicts → resolutions
- **Hide messy graph vs graph-is-the-centerpiece** (IA vs KG): separate concerns — controlled vocab is the *filing/nav* system; the graph/themes is a distinct *discovery* surface. Suppress in nav ≠ delete.
- **Prune graph vs search recall** (KG vs Search): prune at the *render* layer, keep stored nodes — a degree-1 entity is viz-junk but a valid search hit (once graph-aware search exists).
- **Richer daily surface vs cost + trust** (PKMS vs Perf): deterministic engagement signals first (free, legible); LLM synthesis in a collapsible, labeled lane.
- **Embedding/re-ingest cost vs latency/credits** (Search/KG vs Perf): throttle; checkpoint after cheap embedding backfill before expensive graph re-ingest; never hardwire a provider.

## ⚠ EXECUTION DISCOVERY (2026-06-11) — the retrieval/theme unlocks are blocked on missing Plexo endpoints
Probed the live Plexo memory API (`http://plexo-api:3001/api/v1`):
- `graph/episodes` → 400 (EXISTS; graph ingestion works — that's why entities exist).
- `memory/search` GET → 400 (EXISTS; query-time semantic search endpoint is present).
- **`memory/embeddings` → 404 (MISSING)** — the per-capture embedding-WRITE endpoint nexalog calls. DB confirms: 87 failures are `embedding-http-404`. **Nexalog's embedding pipeline has never worked.** → P8a backfill CANNOT run; semantic search degrades to keyword-only; `embedding_state` is permanently pending/failed.
- **`memory/cluster` → 404 (MISSING)** — the clustering endpoint behind `runClusterPass`. → `memory_themes` can never populate (P9b blocked).
- Graphiti entity-typing + node-merge endpoints (P9c) — also not present (per KG expert).

**Implication:** Phases 8a/8b-semantic, 9b, and 9c are **cross-repo** — they require building memory endpoints on the Plexo API (`joeybuilt-plexo`), not nexalog changes. This reframes "pursue P9c now" (operator's D5 choice): the work largely lives in Plexo.

### Architecture fork (needs decision — D7)
- **Path A — build the Plexo memory API.** Implement `memory/embeddings` (write), `memory/cluster`, and graphiti entity-type forwarding + node-merge on `joeybuilt-plexo`. Unblocks the existing nexalog backfill + clustering as-designed. Larger, multi-repo, but matches the intended architecture.
- **Path B — keep embeddings nexalog-side.** Graphiti already embeds ingested episodes; lean on the existing `memory/search` for semantic retrieval, and/or add a local **pgvector** column in nexalog (pgvector is installed, currently unused) populated via an embedding model routed through Plexo's *completion* API — no new Plexo memory endpoints. Derive themes from the graph instead of the dead cluster endpoint. Keeps work in one repo but is a nexalog refactor + schema change.

### What is NOT blocked (nexalog-side, executable now)
- ✅ **P6a notes filter** — SHIPPED this session (Notes + dashboard; tsc green; DB-verified 41 authored vs 3457).
- **P7b** Today rebuild (open-loops + recency lanes) — pure nexalog product work.
- **P9a** controlled-vocab as primary Bookmarks facet (revive `bookmark-sidebar`) — pure nexalog.
- **P8c** chat citations (source IDs/chips) — nexalog, independent of embeddings.

## Decisions needed before execution
- **D3** Notes surface: ship the read-path filter so bookmark-twins stop appearing as notes (Notes page → ~40 authored notes)? *(recommend yes — directly fixes complaint #1, reversible)*
- **D4** Authorize the **embedding backfill** (drains 4010 pending via Plexo; unlocks semantic search + clean themes)? *(recommend yes — highest leverage, prerequisite for 9b)*
- **D5** Graph entity typing/dedup (9c) needs cross-repo Plexo endpoints + a full re-ingest ($$/hours). Pursue that track now, or defer and rely on 9a (controlled-vocab facet) + 9b (embedding-clustered themes) for "usable categories"? *(recommend defer 9c; do 9a+9b first)*
- **D6** Today: ship the scoring fix (7a) now and schedule the full open-loops/recency rebuild (7b) as its own phase? *(recommend yes)* — RESOLVED: full rebuild now (7b).
- **D7 (NEW — from execution discovery)** Embeddings/clustering/entity-typing are blocked on missing Plexo endpoints. Choose **Path A** (build the Plexo memory API — multi-repo, matches design) or **Path B** (nexalog-side pgvector + lean on existing `memory/search` — single-repo refactor). This gates P8a, P9b, P9c.

## Status (end of 2026-06-11 session)
- SHIPPED: P6a (notes filter, verified, tsc green). Earlier UI fixes (web-history/voice/settings/bookmark/synthesis) also shipped + tsc green.
- DECISIONS PENDING: D7 (architecture fork — blocks the retrieval/theme/graph unlocks). Prod authorizations still open: apply migration 0010; run favicon backfill.
- UNBLOCKED NEXT (nexalog-side, no Plexo dependency): P7b Today rebuild, P9a controlled-vocab facet, P8c chat citations.
