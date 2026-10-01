# Nexalog — Full-App Audit (graph / find / use / create)

**Date:** 2026-06-10 · **Method:** live headless testing on nexalog.com (authed) + static code audit (2 Explore subagents) + DB/graph inspection.
**Purpose under test:** synthesize the user's data into a knowledge graph + synthesis so they can FIND, USE, CREATE from it.
**Prior UI audit:** `audit-findings.md` (shipped 1e857ab) — this doc covers the deeper functional/data layer.

Severity: **P0** broken/data-loss/core-promise-fails · **P1** works-but-wrong/shallow · **P2** gap users notice · **P3** polish.
Status legend: ⬜ open · ✅ fixed · ❎ not-a-defect · ⏳ resolves-on-backfill.

> Note: several findings are agent-reported (static read) and marked `[static]` — verify line/behavior before fixing. Graph-render + graph-typing + cypher items are author-verified live.

## A. Knowledge Graph (the centerpiece)

### [P1] Graph Explorer edges invisible → reads as a disconnected dot-cloud  ⬜
Verified live. 496 edges among 623 nodes (98% connected, avg degree 1.59) but the viz shows scattered dots, no lines.
Root: `explorer-graph.tsx:294` draws links at `stroke "#ffffff18"` (~9% opacity) → imperceptible, esp. zoomed out.
Fix: raise edge opacity/contrast (e.g. `#ffffff55`+), optionally weight by degree; verify structure becomes visible.

### [P1] Graph node labels hidden at overview → nothing identifiable  ⬜
Verified live. `explorer-graph.tsx:224-230` hides ALL labels when `nodes.length > 80` until zoomed in. With 623 nodes the overview is unlabeled dots.
Fix: always label the top-N highest-degree hubs (and/or selected/hovered), regardless of zoom.

### [P1] Relationship meaning is hidden — every edge typed `RELATES_TO`  ⬜
Verified live + code. Cypher `lib/cypher-defaults.ts:29` returns `type(r) AS rel` (always `RELATES_TO`) **and** `r.fact AS fact` (the real meaning, e.g. "X is described as Y"). The renderer types/colors by `rel` (generic) and only shows `fact` on hover `<title>` (`explorer-graph.tsx:295-298`). So the semantic richness graphiti DID extract is invisible.
Fix: surface `fact` as the edge label / on-canvas (at least for selected/hover-near edges); color/group by something meaningful.

### [P1] Every node is bare `entity` — no entity types  ⬜
Verified. Cypher `cypher-defaults.ts:28` `MATCH (n:Entity)`; `lib/cypher-graph.ts:44` `String(labels[0] ?? "entity")`. graphiti 0.29 supports typed entities (Contact/Org/…) but ingestion doesn't assign them, so all nodes collapse to one type/color. The explorer color palette (`explorer-graph.tsx:23-37` Contact/Email/Service/…) is dead code against the live graph.
Fix (needs decision): configure graphiti ingestion with entity types (`lib/graph-ingest.ts`) — pipeline change, blast radius. Surface to operator.

### [P1] Two disconnected "graph" views — themes-forest vs cypher-entity  ⬜ [static]
`app/api/graph/route.ts:29-53` (the main `/app/graph`) renders the Plexo themes-forest (Leiden clusters), NOT the cypher entity graph. `/app/graph/explorer` is a separate opt-in (`NEXALOG_GRAPH_EXPLORER` flag) cypher view. User gets two unrelated graphs with no bridge. Member→theme links hardcoded `kind:"membership", strength 0.55` (`lib/themes-forest.ts:244-246`).
Fix (needs decision): reconcile the two into one coherent graph story, or clearly differentiate their purpose.

### [P0] Most of the user's data isn't in the graph yet  ⏳
~620 entities exist; backfill still draining **1284 notes + 4078 bookmarks**. The graph can't "synthesize your data" while most data is absent. Now fast (gemma3:27b ~25s/item) — resolves as drain completes. Re-judge graph quality at drain=0.

## B. FIND (search + chat grounding)

### [P1] Search ignores the knowledge graph entirely  ⬜ [static]
`app/api/search/route.ts:55-73` searches notes+captures only; graph entities/themes never returned. Can't search the synthesis.
### [P1] Cmd-K / SearchModal is notes-only  ⬜ [static]
`components/search-modal.tsx:71` calls `/api/notes/search` → bookmarks unreachable by keyboard.
### [P1] Chat never cites sources  ⬜ [static]
`app/api/chat/[sessionId]/messages/route.ts:156-191` injects up to 5 recent notes + 100 bookmarks as flat context, no citations/links in the answer → user can't trace grounding. Bookmarks unranked (oldest clutter context).
### [P2] @-mentions exclude graph entities/themes  ⬜ [static]
`messages/route.ts:40-114` `resolveAtRefs` resolves notes+bookmarks only; `@theme`/`@entity` fail silently.
### [P2] Search ranking weak  ⬜ [static]
`app/api/notes/search/route.ts:18-27` ILIKE only, recency fallback, no FTS ranking; spell-check only on zero results.

## C. USE / CREATE (capture → note → graph pipeline)

### [P1] Editing a note never re-ingests it into the graph  ⬜ [static]
`app/api/notes/[id]/route.ts:29-44` PATCH updates content but doesn't clear the `graph_ingestion` row; `contentHash` stored but never compared. Edited notes keep stale graph state forever.
### [P1] Non-URL captures ingested without enrichment  ⬜ [static]
`lib/graph-ingest.ts:136` selects all un-ingested capture_sources regardless of `kind`; text/markdown/voice captures reach the graph as near-empty episodes.
### [P1] Empty/title-less bookmarks marked "ingested" forever (silent loss)  ⬜ [static]
`lib/graph-ingest.ts:139-149` records `episodeId=null` for no-title items → "done" permanently, no retry, no error → silent loss from synthesis.
### [P1] Deleting a note leaves its graph episode behind  ⬜ [static]
`app/api/notes/[id]/route.ts:73` soft-deletes; no cascade to `graph_ingestion`/graphiti episode → deleted notes persist in graph + synthesis.
### [P2] Imports create captures with no note + no enrichment  ⬜ [static]
`app/api/import/route.ts:107-119` imported URLs get `noteId:null`, unenriched → fragmented capture→note→graph chain; may never ingest if note queue saturates.
### [P2] Ingest failures are silent  ⬜ [static]
`lib/graph-ingest.ts:168-189` returns false on missing Plexo workspace; cron logs + reports success → can't distinguish transient vs permanent failure.
### [P2] New captures lag synthesis by minutes  ⬜ [static]
Graph ingest is paced-cron only; no on-demand/real-time trigger → fresh captures invisible to graph/synthesis for 10s of minutes.

## D. SYNTHESIS

### [P2] Only 5 suggestion kinds; no graph-derived synthesis  ⬜ [static]
`app/api/synthesis/route.ts:11-16` whitelists theme.page_draft + link.note_to_note + 3 bookmark kinds. No "notes about the same entity", "co-mentions", "missing connections" — the graph isn't mined for synthesis. Suggestions unranked/undeduped (`lib/plexo-synthesis.ts:55-73`).

---

## Proposed phase order (fix, post-approval)
1. **Phase G1 — Graph readable (quick wins):** A edges-visible + hub-labels + surface `fact` as edge labels. Makes the existing graph usable. Low risk, Nexalog-only.
2. **Phase G2 — Pipeline integrity:** C re-ingest-on-edit, kind-filtered ingest, cascade-delete episodes, surface ingest failures. Makes the graph trustworthy + complete.
3. **Phase F1 — Find:** B search-includes-graph + Cmd-K includes bookmarks + chat citations.
4. **Phase G3 — Typed graph (needs decision):** A entity-types + relationship-typing in graphiti ingestion; reconcile the two graph views. Pipeline/blast-radius — gate.
5. **Phase S1 — Synthesis depth:** D graph-derived suggestions.
6. Re-verify all graph findings once backfill drains.

**Open decisions for operator:** (1) graphiti entity-typing (pipeline change) yes/no; (2) reconcile themes-forest vs cypher-explorer into one graph, or keep both with clearer purpose; (3) on-demand ingest trigger (cost vs freshness).
