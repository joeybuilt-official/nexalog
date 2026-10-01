# Nexalog — State Report (Phase 1)

**Date:** 2026-06-13 · **HEAD:** `d4aac45` · **Method:** 6-expert sub-agent panel, read-only audit of live code + prod DB. Each panelist returned synthesis only. Conflicts are surfaced, not flattened.

> Audit-first finding that reframes everything below: **prod holds ~15 authored notes vs ~3564 bookmark-twin notes.** Nexalog today is a strong bookmark-capture-and-enrich engine wearing PKM clothes. The "second brain" promise is largely unbacked by real authored-knowledge usage. This is the dominant lens for the gap analysis.

---

## 1. Boundary integrity (Architect) — clean, with one nuance

- **No direct AI-SDK leaks.** Only AI dep is `@joeybuilt/plexo-sdk`. All inference routes through `plexoAiComplete` (auto-categorize, title-gen, project brainstorm). `openai`/`anthropic` grep hits are domain hostname classifiers (`lib/themes/forest.ts`), not calls. Confidence: high.
- **The nuance / the live conflict:** Nexalog does NOT host a model, but it DOES own the **pgvector store + local k-means clustering (`scripts/cluster-themes.ts:77`) + RRF fusion (`app/api/search/route.ts:485`)**. Embeddings are fetched by hitting Plexo's bundled ONNX embeddings server directly (`lib/plexo.ts:137`), bypassing the *designed* Plexo `memory/embeddings` and `memory/cluster/compute` endpoints — **both of which 404**. This "Path B" was a pragmatic workaround for missing Plexo endpoints. Whether vector storage + clustering + ranking living in Nexalog violates "Plexo owns ALL intelligence" is the **central architectural conflict** (see Phase 2).

## 2. Confirmed `[X]` Jex-protocol gaps (prerequisite work items)

| Gap | Evidence | Status |
|---|---|---|
| `memory/embeddings` (write) | `lib/enrichment/embeddings.ts:99`, flag-gated, 404 upstream | Dead path; Path B used instead |
| `memory/cluster/compute` | themes can't populate Plexo-side; 404 | Forest derived Nexalog-side instead |
| Graphiti **node-merge** verb | only read-only `/graph/cypher` exists | Dedup of identical entities has no Plexo verb |
| Voice **transcription** (Deepgram via Jex) | `/api/voice` uploads to R2 but never transcribes | Capability unexposed |
| **Salience / surfacing** API | no Plexo verb for "right note finds you" | The moat's missing primitive |

**Correction (panel vs plan doc):** entity-type *forwarding* is NO LONGER a gap — `entityTypes` is now sent (`lib/plexo.ts:219`, wired `lib/graph-ingest.ts:222`, 8 types). Only node-merge + the cost of a full re-ingest remain. (`optimization-plan.md:16` is stale on this point.)

## 3. Data model (Librarian) — DERIVED, not modeled

- **Atomic unit:** two parallel opaque-text tables — `notes` (markdown blob: title+content+kind) and `capture_sources` (URL blob + ~40 flat enrichment columns). Every capture mints a twin `notes` row (`app/api/capture/route.ts:272`). No typed-object table, no per-property schema. Sits at the **Obsidian/markdown end**, far from Anytype's modeled objects. DB: notes=3579, capture_sources=4258.
- **Links/transclusion:** `note_links` table exists (bidirectional-capable, dual indexes) but **0 rows in prod**. Block UUIDs are assigned (`block-id-extension.ts`) but **no `((ref))` consumer** — dead foundation. Transclusion impossible with opaque-text notes. Roam/Logseq/SiYuan bar: **not met**.
- **Typed objects/relations/collections:** `bookmark_collections`, flat `bookmark_tags` (25 rows, nullable parentId), polymorphic `projects`/`project_items` — but projects/project_items are **0 rows in prod**. No supertags, no user-defined properties, no typed relations between user objects. Tana/Notion/Anytype relational layer: **absent/dormant**.

## 4. Query / retrieval (Librarian + Synapse) — sound pipeline, mixed data

- **Search** = genuine 3-way RRF (k=60): Postgres FTS + Plexo `memory/search` + local pgvector cosine, with recall-union. Degrades cleanly to lexical if the embeddings server is down.
- **FTS:** `capture_sources.fts` = weighted generated tsvector + GIN (real `ts_rank_cd`). **`notes` has NO fts column** — note search falls back to JS substring rank (`search/route.ts:567`). Plan doc was right here.
- **pgvector — populated, contrary to the plan doc's "0 ready":** captures 4111/4258 embedded, notes 3452/3579. HNSW cosine indexes live. **BUT** the `embedding_state` bookkeeping column is **stale/lying**: 4123 pending / 99 failed / 36 skipped / **0 done**, while the vector column is actually full. Any monitor or backfill re-run reading that column will misroute. Backfill is a **manual script** (`scripts/backfill-embeddings.mjs`), not a cron — the cron `embedOne` still 404s.

## 5. AI-native surface (Synapse) — citations real, salience mostly fake

- **"Ask your notes" ≈ 70% there:** fusion works when vectors are present; chat **citations are real** and render as clickable source chips (`chat-client.tsx:349`). BUT chat *grounding* (`chat/[sessionId]/messages/route.ts`) is FTS/ILIKE + recency-fill only — **no embedding recall in chat**, and "sources" = injected-context items, not model-attributed inline citations.
- **"The right note finds you" ≈ 10%:** Today lanes (continue/recentSaves/triage) are pure `updatedAt`/`createdAt` ordering (`lib/today/cards-data.ts:230`) — zero intelligence. The intelligent lanes (becoming/writeNext/surprised) gate on Plexo synthesis/cluster, which is flag-OFF and 404s → fallback. `lib/staleness.ts` is real but it measures **link-rot**, not relevance. Salience is the field's open gap and Plexo's biggest opening — and it does not exist yet.
- **Generation/agents:** title-suggest, typo-correct, project Jex-brainstorm — all clean `plexoAiComplete`. No autonomous agents/automations.

## 6. Frontend / UX (Editor) — strong web editor, shallow depth, fake-native mobile

- **Editor (ships):** TipTap/ProseMirror WYSIWYG, slash menu (8 cmds), `[[wikilink]]` w/ live note search + persisted `note_links`, server-rendered backlinks panel, 1s autosave. **Missing vs Obsidian/Logseq/Roam:** not an outliner (no fold/zoom/indent-as-structure), no block-level editing UI, no block references/transclusion (UUIDs exist, no consumer), no tables, no in-doc media, **no markdown round-trip (stores HTML)**.
- **Visualization:** one strong graph (`knowledge-graph.tsx`, d3 force, semantic-zoom LOD, a11y) — **but it's a Plexo themes-forest *synthesis* graph, not a note-link graph**. Users expecting an Obsidian-style link graph get a different mental model. **No edgeless canvas/whiteboard. No board/calendar/table views** over one dataset.
- **Cmd-K:** strong hybrid search, but **navigation-only** — no commands/actions/quick-capture from the palette. No live/saved queries.
- **Mobile:** **stripped `flutter_inappwebview` WebView shell, NOT native.** No local store (no sqflite/drift/isar/hive). SEND share intent-filter is declared in the manifest but there is **no Dart share-receiver plugin → the intent is dead.** Zero capture parity, no offline, no camera/voice.
- **Polish:** high on web (shadcn, dark mode, skeletons, honest empty/error states). Learning curve low.

## 7. Sync / storage / sovereignty (Keeper) — hosted-only, no exit

- **Local-first:** none. Pure server-of-record. Mobile shell shows a "You're offline" screen; no offline read/write, no queue, no CRDT.
- **Encryption:** none at app layer (no AES/libsodium/subtle). R2 audio plaintext, no SSE.
- **Export / portability:** **import-only. There is NO export/download/backup endpoint.** Users can enter but cannot leave with their data — the opposite of Obsidian's pitch. **Highest-severity sovereignty flaw; defining the export format is a one-way door.**
- **Self-host:** MIT; a self-hoster gets working CRUD (notes/captures insert directly, Plexo enrichment degrades to `return null`). BUT every differentiator (semantic search, themes, synthesis, idea-extraction) silently no-ops without a Plexo instance — **Plexo is both the moat and the lock-in.**
- **Cross-device:** web + mobile share one Postgres via the same web app — trivially consistent, but connectivity-required.
- **Auth:** Better Auth on shared `auth` schema (`search_path=auth`) = real cross-app SSO; service-key compare is timing-safe. Notes: root `middleware.ts` checks cookie *presence* only (by design, validation deferred to layouts); `lib/auth/middleware.ts` looks dead/unused; `plexo/data` GET trusts a caller-supplied `userId` gated only by the service key (cross-user leak risk if a Plexo-side bug supplies the wrong id).

---

## 8. One-way doors identified (each → ADR + operator gate before its phase)

1. **Knowledge-graph schema** — Plexo/Graphiti-owned, opaque; re-deriving = full re-ingest at LLM cost (~60–180s/item).
2. **Dedicated graph-workspace UUID derivation** (sha256 salt, `lib/plexo.ts:87`) — change the salt and every user's graph orphans.
3. **pgvector `384-d` / `plexo-embed-v1`** — changing model/dimension = re-embed everything.
4. **Jex contract shape** (`/graph/episodes` payload, service-key auth, the `[X]` endpoints to be added).
5. **Storage / portability / export format** — none exists; defining it commits a long-term contract.
6. **Shared `auth` schema SSO** — cross-app blast radius.

## 9. Honest confidence

High on: boundary cleanliness, the `[X]` 404 gaps, the bookmark-vs-authored-note ratio, no-export, fake-native mobile, no-encryption, FTS-missing-on-notes, salience-is-fake. Medium on: dead-middleware intent, exact pgvector counts (state column is unreliable; vector column inspected directly).
