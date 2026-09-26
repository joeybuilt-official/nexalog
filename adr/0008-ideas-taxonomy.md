# ADR 0008 — Ideas taxonomy: shape × maturity × provenance

Date: 2026-06-19
Status: Accepted

## Context

Nexalog stores notes (free text), bookmarks (URLs w/ summaries), AI-conversation transcripts, video transcripts (ADR-0007), and themes/clusters over all of them. But the operator's actual unit of thinking — the *idea* — has no first-class home today. It lives inside a note body, scattered across paragraphs, mixed with raw observations and connecting prose. Existing tables hint at it:

- `extraction_candidates` — per-import review queue (status pending/accepted/rejected). Built only by AI-conversation import; staging table; no embedding, no semantic recall.
- `project_candidates` — clustering output proposing new projects.
- `memory_themes` — cluster centroids w/ labels. Topic-level, not idea-level.

None of these capture an idea as a durable, queryable object. The operator wants to ask:

> Show me every open *question* I've collected about distributed systems.
> What *principles* have I tested in practice?
> Which *observations* recur across different sources?

Themes can't answer those — they cluster by topic, not by *what kind of thinking-unit* a snippet is.

## Decision

Introduce a first-class `ideas` table with **three orthogonal axes**:

| Axis | Values | Default | Meaning |
|------|--------|---------|---------|
| **shape** | observation · question · claim · principle · method · story · heuristic | (required) | What kind of thinking-unit |
| **maturity** | spark · kernel · formed · tested · applied | spark | How developed |
| **provenance** | extracted · curated · synthesized | (required) | Where it came from |

The shape axis is enumerated, not free-text — drift kills queryability. The 7 shapes cover everything the operator can plausibly want to filter on without overfitting. Maturity is a soft promotion ladder; provenance distinguishes machine-extracted from operator-written from cross-source-synthesized.

## Why three axes, not one

A single "type" axis (just shape) is simpler to ship but loses two queries the operator already wants:
- *"Have I actually tested this principle, or is it still a spark?"* → maturity
- *"Did I write this myself or did Plexo extract it?"* → provenance

Each axis answers a different question; collapsing them loses information without simplifying the schema meaningfully (we'd just pack the lost info into ad-hoc tags, which is the failure-mode of every free-tag PKM).

## What ideas are NOT

- Not notes. A note can hold zero or many ideas. Notes remain free text; ideas are structured extractions/curations on top.
- Not themes. Themes cluster *sources by topic*. An idea may live inside a theme (theme_id FK) but the idea is the unit of thinking, the theme is the bucket.
- Not project candidates. Project_candidates propose containers; ideas are the contents.
- Not extraction_candidates. extraction_candidates is the raw review queue scoped to a single import; it remains as the staging layer, and accept-from-candidate can promote to an idea via `promoted_from_candidate_id`.

## Provenance pipeline

`extracted` ideas come from `lib/ideas/extract.ts`:
- Each capture_sources row's text (long_summary > reader_text > summary) feeds an LLM prompt that returns 0–5 ideas w/ shape + maturity classified inline.
- Each note's content feeds the same prompt.
- Wired into the existing `enrichInBackground` chain (post-summary) and into the `/api/cron/enrichment` sweep under `?stage=ideas-captures` / `?stage=ideas-notes`.
- Default maturity for extracted = `kernel` (named, not yet defended).

`synthesized` ideas come from `lib/ideas/synthesize.ts`:
- After `runClusterPass()` refreshes `memory_themes`, the synthesizer reads each theme's member sources, calls Plexo to surface 1–3 *cross-cutting* ideas the individual sources don't state on their own.
- Maturity is always `kernel`. `theme_id` is set; `source_kind = 'cluster'`.
- Idempotent: skipped if any synthesized idea exists for the theme since its last `computed_at`.

`curated` ideas come from `POST /api/ideas`:
- Operator writes the idea directly via the UI. Source fields nullable.

## Embeddings + graph

Each idea gets a `vector(384)` embedding via `plexoEmbed()` (same pgvector path as captureSources/notes per Path B). HNSW + cosine ops, same index pattern.

- Lets the semantic chat surface ideas alongside notes/bookmarks.
- Lets the cluster pass eventually re-cluster by *idea text* (not just bookmark summary), surfacing finer-grained themes.

Graph ingestion is deferred to Phase 2. The `graph_episode_id` column is present so the hook can land without a migration.

## Maturity promotion

Auto-suggestion (Phase 2, not built yet): when an idea is cited 3+ times via semantic chat, suggest spark → kernel. Operator confirms via PATCH. Explicit promotion is the only path today — automatic silent bumps break the operator's mental model.

## Schema notes

- CHECK constraints (not pg enums) on shape/maturity/provenance/status/embedding_state so adding a value is a one-line migration.
- Partial indexes on facet columns (shape, maturity, provenance) gated by `status='active'` so list queries are tight.
- FTS via `tsvector GENERATED ALWAYS AS … STORED`, title weighted A, body weighted B. Matches the convention in `0003_capture_sources_fts.sql` + `0013_notes_fts.sql`.
- `promoted_from_candidate_id` UNIQUE WHERE NOT NULL — prevents double-promotion on a re-accept.

## API

- `GET /api/ideas` — list w/ facet filters, FTS search, keyset pagination.
- `POST /api/ideas` — create curated idea.
- `GET /api/ideas/[id]` — detail.
- `PATCH /api/ideas/[id]` — edit; re-embeds on text change.
- `DELETE /api/ideas/[id]` — soft-delete (status='dismissed'; hard delete admin-only).
- `POST /api/ideas/extract` — manual extraction trigger from the source detail page.

Cron stages added: `ideas-captures`, `ideas-notes`, `ideas-embed`, `ideas-synthesize`. The `?stage=ideas` shortcut runs all four.

## Risks + mitigations

1. **LLM cost blowup on backfill.** Extraction is per-source per-Plexo-call. 1000 captures × ~700 tokens ≈ 700K tokens. Mitigation: cron caps (15 captures + 15 notes per sweep), `backfill-ideas.ts --rps=2` for explicit drains, idempotency via `metadata.ideas_extracted_at`.
2. **Bad classification.** LLM mis-shapes (e.g. labels a claim as an observation). Mitigation: PATCH edits the shape; UI surfaces all facets so mistakes are obvious; future Phase 2 can add a "review queue" of low-confidence extractions.
3. **Drift between code enums and DB CHECK constraints.** Mitigation: `lib/ideas/types.ts` is named "source of truth"; migration comment cross-references it; any new shape requires both files to land in the same PR.
4. **Synthesize over-fires after every cluster recompute.** Mitigation: dedup by `theme_id + provenance='synthesized'` + idea.created_at ≥ theme.computed_at. Themes recompute on >=10 new ready embeddings.
5. **Vector index size.** HNSW on `ideas.embedding` adds ~1.5KB per row × N ideas. Budget 5–10× notes count. Acceptable until library hits 100k+ ideas, then revisit ivfflat.

## Phase 2 (deferred)

- Graphiti ingestion of ideas as their own episode type (so the graph has both "stuff I saved" and "ideas I distilled").
- Auto-suggest maturity bumps from chat-citation count + cross-source corroboration.
- Per-idea "evidence" link table (ideas ↔ notes/bookmarks the idea was supported by).
- Linkback to source detail pages: "Here's what's been extracted from this bookmark."
- Export bundle: ideas markdown by shape, for sharing or external use.

## Status

- 2026-06-19 — Accepted, implementation underway (migration 0017, lib/ideas/*, API + UI surfaces, cron stages).
