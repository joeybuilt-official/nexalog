# Nexalog — Phased Expansion Plan

**Mode:** autonomous *within an attended session* (don't park at non-gated phase boundaries; push to ~45% context) — but **NO unattended auto-scheduling**: this is a live prod app + the remaining backlog is gate-dense, so the operator clears gates between sessions. **Every ⚠ ADR gate + prod-migration-apply + dep-add + push is a hard stop** (irreversible / authorization). Execution branch: `feat/pkm-expansion`. Durable checklist: `checklist-expansion.md`.
**Date:** 2026-06-13 · **HEAD:** `d4aac45` · **Status:** EXECUTING (reversible code only; nothing applied to prod, nothing pushed). Companion docs: [`nexalog-state-report.md`](nexalog-state-report.md) (Phase 1 audit), [`nexalog-gap-matrix.md`](nexalog-gap-matrix.md) (Phase 2). ADRs in `adr/`.

## Operating rules for every phase
- **Ownership tags** per item: `[N]` Nexalog-domain · `[P]` Plexo-via-Jex · `[X]` Jex-protocol prerequisite (a Plexo-repo work item that must land *before* the dependent Nexalog item).
- **Ship gate (every phase):** `pnpm typecheck` clean · `vitest run` green · `next build` green · browser-verified at 360/768/1440 where UI changes · invariants intact (no AI-SDK import; `nexalog` schema only; no user-facing "embedding"). **No push without operator OK.**
- **Context cap:** stop each execution session at ~45% context; update the log (`docs/claude/worklog.md`) at the boundary; hand off via the queue (`docs/claude/in-progress.md`).
- **One-way doors** (knowledge structure, embeddings ownership, KG schema, export format, Jex contract, auth) → the phase **cannot start** until its ADR is operator-approved. Each such phase is marked **⚠ GATE: ADR-NNNN**.
- **Two-way doors:** move fast, no gate.

## Guiding sequence (from the differentiation thesis)
Close **table-stakes credibility** gaps first (a magic moat behind a broken front door still loses) → land **differentiators** → build the **Plexo-only moat** (salience, cited ask-your-notes, agentic promotion). The north-star gate is **authored-note count + 7-day return**, not feature count (pre-mortem #1).

---

## Tier 0 — Truth & cleanup (do first; all two-way, no gate)

### Phase 0.1 — Telemetry & dead-path hygiene `[N]`
- **Scope:** Fix the lying `embedding_state` column (reflect the actually-populated vector column, or drop it for a derived view). Delete the dead 404 paths (`lib/enrichment/embeddings.ts`, `lib/journal/embeddings-hook.ts`) that imply clustering works. Promote the manual `scripts/backfill-embeddings.mjs` to a real scheduled job (it currently 404s in cron). Establish the north-star metric query (authored-note count, 7-day return).
- **Deps:** none. **Ship gate:** standard. **Why first:** every later decision reads this state; it currently misleads.

---

## Tier 1 — Credibility (table-stakes; mostly `[N]`, reversible)

### Phase 1.1 — Notes search parity `[N]` (TS)
- **Scope:** Add generated `tsvector` + GIN FTS to `notes` (parity with `capture_sources`); wire into `/api/search` notes branch and chat grounding (replace JS substring + recency-only).
- **Deps:** 0.1. **Migration:** yes (additive, `nexalog` schema) → operator-gate prod apply (data touch, not a one-way door). **Ship gate:** standard + search-quality spot check.

### Phase 1.2 — Make links real `[N]` (TS)
- **Scope:** The `[[wikilink]]`/backlinks code ships but `note_links` is empty in prod. Diagnose why writes don't land; backfill links for existing authored notes; surface "unlinked mentions" suggestions. Add block-ref *consumer* UI for the already-assigned UUIDs **only if** cheap — otherwise defer to Tier 2.
- **Deps:** 1.1. **Ship gate:** standard + `note_links` row-count > 0 after a real edit, browser-verified.

### Phase 1.3 — Real mobile capture `[N]` (TS)
- **Scope:** The Android SEND intent is declared but dead (no Dart receiver). Add a share-receiver plugin → POST to `/api/capture`. This is the highest-leverage mobile fix (capture-on-the-go is table stakes) without committing to a full native rewrite.
- **Deps:** none (parallelizable). **Ship gate:** APK build green (Pushd tag flow); device share-to-Nexalog verified.

### Phase 1.4 — Data export / "exit door" `[N]` **⚠ GATE: ADR-0002 — CLEARED 2026-09-26 for scope + format (`adr/0019-exit-door-data-export.md` Accepted except deletion; deletion is `adr/0021-deletion-and-purge-semantics.md`, still Proposed)**
- **Scope:** A real export endpoint (markdown-with-frontmatter for notes + JSON for captures/links/tags). Removes the "data jail" — the deepest sovereignty deficit and an Obsidian table-stake.
- **Deps:** ~~ADR-0002 approved~~ **ADR approved 2026-09-26:** `adr/0019-exit-door-data-export.md` (Accepted for scope + format — repo files byte-for-byte + `manifest.json` with per-file sha256, ZIP, stream + cap). **Deletion semantics are NOT approved and live in `adr/0021-*` (Proposed).** Still open and not gating the export build: Q5 (legacy v1 store) awaits the read-only prod inspection; Q8 (who can export). **Ship gate:** standard + round-trip sanity (export → re-import parity check).

### Phase 1.5 — Templates `[N]` (TS)
- **Scope:** Note templates (daily-note, meeting, project) — repeatable structure, low effort, removes a glaring "every PKM has this" gap.
- **Deps:** none. **Ship gate:** standard.

---

## Tier 2 — Differentiators (`[N]`/`[P]`)

### Phase 2.1 — Daily-notes habit surface `[N]` (DIFF)
- **Scope:** Journal route+schema exist but are empty/unsurfaced. Make daily notes the default low-friction entry point (Logseq/Tana pattern) — a dated landing surface, not a buried route. Directly attacks the "no reason to return" retention risk (pre-mortem #1).
- **Deps:** 1.1, 1.5. **Ship gate:** standard + browser-verified daily flow.

### Phase 2.2 — Note-link graph (distinct from synthesis graph) `[P]`/`[N]` (DIFF)
- **Scope:** Today's strong d3 graph is a *themes-forest synthesis* view; users expect an Obsidian-style *link* graph. Add a local (per-note) + global note-link graph fed by `note_links`, kept separate from the synthesis graph (label both clearly to avoid the mental-model confusion the panel flagged).
- **Deps:** 1.2 (links must populate first). **Ship gate:** standard + a11y/keyboard pass.

### Phase 2.3 — Database views over one dataset `[N]` (DIFF) **⚠ GATE: ADR-0004 (if typed objects)**
- **Scope:** Table/board/calendar lenses over notes+captures. **Decision fork:** views over the *existing opaque-text model* (cheap, reversible, no ADR) vs introducing a *typed-object/relations layer* (Anytype-style, powerful, but a one-way door + re-imports Tana complexity risk — conflict #4). Start with views over the current model; only cross into typed objects under ADR-0004.
- **Deps:** 1.1. **Ship gate:** standard.

### Phase 2.4 — Edgeless canvas `[N]` (DIFF, optional/later)
- **Scope:** Whiteboard over the same content (AFFiNE/Obsidian Canvas). Deliberately **last** in the differentiator tier — high effort, not a credibility blocker.
- **Deps:** 2.2. **Ship gate:** standard.

---

## Tier 3 — The Plexo moat (`[P]`/`[X]`; each `[X]` gated on its Plexo prerequisite)

> Per pre-mortem #3: **no Tier-3 phase may depend on an unbuilt `[X]` unless that `[X]` prerequisite is scheduled first.** Tier 3 may begin *in parallel* with late Tier 1 to create a return-reason early — but only the `[N]`/`[P]` parts; `[X]`-blocked parts wait.

### Phase 3.1 — Full semantic chat grounding + inline citations `[P]` (PO)
- **Scope:** Chat grounding is FTS+recency only; bring the embedding-recall branch (already in `/api/search`) into chat, and make citations *inline model-attributed* (not just injected-context chips). Highest moat ROI with no `[X]` blocker.
- **Deps:** 0.1, 1.1. **Ship gate:** standard + citation-accuracy spot check.

### Phase 3.2 — Salience / "the right note finds you" `[X]→[P]` (PO) **⚠ GATE: ADR-0006**
- **Scope:** Replace `createdAt`-ordered Today lanes with real Plexo salience. **Blocked on `[X]`:** Plexo has no salience/surfacing verb. Prerequisite = ADR-0006 Jex-contract extension (salience API) lands in the Plexo repo first.
- **Deps:** ADR-0006 approved + Plexo salience endpoint shipped. **Ship gate:** standard + relevance eval vs the old createdAt baseline.

### Phase 3.3 — Embeddings & clustering boundary resolution `[X]/[P]` **⚠ GATE: ADR-0003**
- **Scope:** Resolve Path A vs Path B (conflict #1). Either build Plexo `memory/embeddings`+`memory/cluster` and migrate back (Path A, restores invariant purity) or formally bless Path B (Nexalog owns vector storage, Plexo owns the model) and document the boundary. Freeze pgvector at 384-d `plexo-embed-v1` regardless (one-way door).
- **Deps:** ADR-0003 approved. **Ship gate:** standard + theme-quality checkpoint before any expensive re-cluster.

### Phase 3.4 — Graph entity dedup + typing quality `[X]→[P]` (PO) **⚠ GATE: ADR-0005**
- **Scope:** Identical-entity dedup (e.g. "VLine CarPlay" ×2). **Blocked on `[X]`:** Graphiti has no node-merge verb; only read-only `/graph/cypher`. Prerequisite = ADR-0005 (KG schema + node-merge endpoint + the cost decision on full ~3000-episode re-ingest; the graph-workspace salt is a one-way door — never change it).
- **Deps:** ADR-0005 approved + Plexo node-merge endpoint. **Ship gate:** standard + dedup precision check on a sample; **throttle + checkpoint cost before full re-ingest** (pre-mortem #3, optimization-plan pre-mortem #1).

### Phase 3.5 — Voice capture + transcription `[X]→[P]` (TS, moat-flavored) **⚠ GATE: ADR-0006**
- **Scope:** `/api/voice` uploads but never transcribes. **Blocked on `[X]`:** Deepgram-via-Jex unexposed. Prerequisite = ADR-0006 (transcription verb in the Jex contract). Then talk→note→action-items (Tana's win).
- **Deps:** ADR-0006 approved + Plexo transcription endpoint. **Ship gate:** standard + transcription round-trip verified.

### Phase 3.6 — Agentic promotion to sibling apps `[P]` (PO — the unique moat)
- **Scope:** Promote ripe ideas into Levio tasks / Pushd deploys via Plexo agents. The thesis's defensible claim — "your knowledge works for you while you're away" — that no single-app PKM can match.
- **Deps:** 3.1, 3.2; existing Jex tool/event contract. **Ship gate:** standard + end-to-end promotion verified into a Levio task.

---

## Deferred / out of near-term scope (note, don't plan yet)
- Public user-facing **plugin API** (`[N]`, future ADR — one-way door): Jex covers inbound integration today; a public plugin contract is a separate commitment.
- **Local-first / offline + CRDT** (`[N]`): conflict #2 (vs hosted-SaaS revenue) unresolved — needs an explicit product/business decision before planning.
- **E2E / zero-knowledge** (`[N]`): conflict #3 — structurally incompatible with Plexo reading plaintext; recommend formally declining and competing on intelligence instead.
- **Real-time multiplayer, publish-to-web, Readwise sync, spaced repetition:** DIFF/PO, post-moat.

## ADR index (each = operator gate before its phase)
| ADR | One-way door | Gates phase | Status |
|---|---|---|---|
| 0002 | Data export / portability format | 1.4 | **Superseded for v2 — see 0019 below** (kept as the historical record) |
| 0019 | Exit door: data export / portability | 1.4 | **Accepted 2026-09-26 for scope + format — EXCEPT deletion, split to `adr/0021-deletion-and-purge-semantics.md` (Proposed)** |
| 0021 | Deletion and purge semantics (split out of 0019) | 1.4 (deletion half) | **Proposed — awaiting operator approval; decides nothing yet** |
| 0003 | Embeddings & clustering ownership (Path A vs B) + pgvector freeze | 3.3 | **Proposed — needs approval** |
| 0004 | Knowledge structure: opaque-text vs typed objects | 2.3 (typed-object branch only) | **Proposed — needs approval** |
| 0005 | KG schema + node-merge + re-ingest + graph-ws salt | 3.4 | **Proposed — needs approval** |
| 0006 | Jex contract extensions (salience, transcription, embeddings/cluster write, node-merge) | 3.2 / 3.4 / 3.5 | **Proposed — needs approval** |
