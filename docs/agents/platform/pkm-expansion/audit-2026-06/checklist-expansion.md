# Nexalog Expansion — Execution Checklist

Branch `feat/pkm-expansion` → MERGED to `main` @ `f594ed3` (pushed). Migrations 0013+0014 APPLIED to prod + DEPLOYED (2026-06-13). 1.1/1.2/1.5/2.1/3.1 LIVE. ⚠ = hard gate (no go w/o operator).
⚠ Plexo `aiComplete` platform latency degrading chat to fallback (transient, not this work).

## Tier 0 — truth & cleanup
- [ ] 0.1a Fix `embedding_state` telemetry in CODE (derive from real vector column; stop the "0 done" lie) — code only; prod data correction ⚠gated
- [~] 0.1b Delete dead 404 embedding paths — **DEFERRED**: entangled w/ ADR-0003 (deleting preempts the Path-A option). Hold until ADR-0003.
- [ ] 0.1c Promote backfill script to a real scheduled job (wire it; running vs prod ⚠gated)
- [ ] 0.1d North-star metric query (authored-note count, 7-day return)

## Tier 1 — credibility (two-way; no ADR)
- [x] 1.1 Notes FTS: migration 0013 + search notes branch + chat grounding → ts_rank_cd. tsc green. Committed b451f84. ⚠prod migration apply still gated
- [x] 1.2 Make links real: DIAGNOSED (write-paths fine, 0 rows = no-usage) → shipped unlinked-mentions surface + note_links unique index. tsc green. Committed ec61680. ⚠migration 0014 apply gated
- [ ] 1.3 Real mobile capture: Android share-receiver → `/api/capture`  ·  ⚠flutter dep-add gated
- [x] 1.5 Templates: built-in Blank/Daily/Meeting/Project as code const (NO table, NO migration — cleaner than planned). Picker beside New Note. tsc green. Committed c33d593
- [ ] 1.4 Export / exit-door  ·  **⚠ GATE ADR-0002**

## Tier 2 — differentiators
- [x] 2.1 Daily-notes habit surface: REUSED journal (exists, was 3 clicks deep + unused). /app/journal/today redirect + "Daily note" sidebar item + post-login landing → /app/today (reversible, flagged). tsc green. Committed fdeb1ac
- [ ] 2.2 Note-link graph (distinct from synthesis graph)
- [ ] 2.3 DB views (opaque-text model) · typed-object branch **⚠ GATE ADR-0004**
- [ ] 2.4 Edgeless canvas (last)

## Tier 3 — Plexo moat
- [x] 3.1 Full semantic chat grounding + inline citations: pgvector cosine recall (notes+bookmarks) unioned into chat grounding (mirrors /api/search, guarded→FTS-only); numbered grounded sources + range-bound [n] inline citations rendered as links (out-of-range stays literal) + chip legend. tsc+vitest+`next build --webpack` green; browser-verified render @360/768/1440. Committed e2d3678. NOTE: sources not persisted (GET omits them) — inline cites only on live POST, like the pre-existing chips. ⚠nothing pushed; ⚠Plexo aiComplete ~30s SDK timeout flaky in dev (prod = proven path)
- [ ] 3.2 Salience  · **⚠ GATE ADR-0006** (+ Plexo salience endpoint)
- [ ] 3.3 Embeddings boundary  · **⚠ GATE ADR-0003**
- [ ] 3.4 Graph dedup/node-merge  · **⚠ GATE ADR-0005**
- [ ] 3.5 Voice transcription  · **⚠ GATE ADR-0006**
- [ ] 3.6 Agentic promotion → Levio/Pushd
