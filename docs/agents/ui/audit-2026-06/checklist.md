# Nexalog Audit & Fix — Checklist

## Phase 0 — Scope
- [x] Crawl all routes (router config, not nav)
- [x] List components + variants
- [x] Note role-states (user / super-admin / unauth)

## Phase 1 — Seven-lens audit
- [x] Stand up local dev server off working tree (incl. web-history)
- [x] Authed headless browser at 360/768/1024/1440
- [x] Lens 1 Functionality — every route, console + network clean
- [x] Lens 2 States — empty/loading/error/partial/ideal per screen
- [x] Lens 3 Interaction — hover/focus/active/disabled, touch targets, confirms
- [x] Lens 4 Visual — spacing/type/color one-offs, truncation/overflow
- [x] Lens 5 A11y — keyboard nav, labels, contrast, landmarks, reduced-motion
- [x] Lens 6 Responsive — no h-scroll/overlap/clipping at 4 widths
- [x] Lens 7 Perf/polish — CLS, slow-net loading states, copy/typos
- [x] Static sweep (Explore): validation + state-handling + a11y
- [x] Re-verify open ⬜ items from nexalog-app-findings.md vs HEAD
- [x] Diff every candidate finding vs prior closed list (no re-reports)

## Phase 2 — Findings + gate
- [x] Write consolidated audit-findings.md (P0–P3)
- [x] Present + STOP for operator approval (done; approved D1=all,D2=fix) ⚠

## Phase 3 — Fix P0/P1 (approved: D2 fix web-history, D1 include all)
- [x] P0 web-history error boundary (browser-verified "Try again" recovery)
- [x] P1 web-history fire-and-forget delete → res.ok + rollback + inline error
- [~] D1-1 graph edges visible — NOT NEEDED (default already #ffffff55; #ffffff18 is search-dim)
- [~] D1-2 graph hub labels — NOT NEEDED (hubs always labeled)
- [⛔] D1-3 edge `fact` on-canvas — DESIGN DECISION, surfaced
- [⛔] D1-6 search includes graph entities — DESIGN (ranking/quality), surfaced
- [⛔] D1-7 chat cites sources — DESIGN (citation format), surfaced
- [⛔] D1-4 typed entities — PIPELINE/gated, surfaced
- [⛔] D1-5 reconcile two graph views — ARCHITECTURE decision, surfaced

## Phase 4 — Fix P2/P3
- [x] P2 voice-memo alert() → inline error state
- [x] P2 bookmark archive → res.ok + rollback, no opacity DOM hack (browser-verified)
- [x] P2 web-history search input aria-label
- [x] P2 settings history inputs label association
- [x] P3 synthesis silent accept → actOne returns bool + dismissible banner (tsc green)
- [x] P0 settings/prefs crash → migration 0010 APPLIED to prod nexalog (2026-06-11)
- [x] P2 bookmarks favicon backfill → RUNNING on prod (2026-06-11)
- [⛔] D1-8 @-mentions graph / D1-10 imports create note — pipeline-design, surfaced
- [~] D1-9 empty-bookmark ingest — NOT a defect (nothing to ingest)
- [~] P3 graph "coming soon" — NOT a defect (disabled-state affordance)

## EXPANSION — optimization (see optimization-plan.md) — awaiting D3-D6
- [x] P6a Notes+dashboard exclude bookmark-twin notes (RC1) — SHIPPED, tsc green, 41 authored
- [x] P6a EXTENDED (RC1 audit, all note-LIST surfaces): added twin-exclusion to **Inbox** (`app/(app)/app/inbox/page.tsx` rows+counts: 3458→41), **`/api/notes/search`** (@-mention picker), **themes/[themeId]** note panel. Notes page already filtered (uses /api/search). Single-note reads (notes/[id], tags/links/backlinks/snapshots) exempt. Inbox browser-verified (raw1/refined4/active36, 0 errors), tsc+build green
- [ ] P6b Typed content model / stop double-write — D3 deep, gated
- [~] P7a Staleness COALESCE — superseded by P7b (recency lanes don't use staleness; lastVisited/Opened ~100% NULL anyway)
- [x] P7b Today rebuild SHIPPED — triage nudge + "Pick up where you left off" (recent notes) + "Recently saved" (recent bookmarks); synthesis demoted; goneStale→"Forgotten gems". Browser-verified, tsc green
- [x] P8a Path B SHIPPED + LIVE-VERIFIED (semantic search). Embed source = Plexo's bundled ONNX server `http://plexo-embeddings:3001/v1/embeddings` (plexo-embed-v1, 384-d, L2-normalized, local/FREE, OpenAI-compat, no provider hardwiring). Done: `plexoEmbed()` lib/plexo.ts; migration `drizzle/0011` APPLIED to prod (vector(384) col on capture_sources+notes + HNSW cosine idx); `scripts/backfill-embeddings.mjs` RUN on prod (captures 4111/4111, notes 3452/3458, 6 empty skipped, FREE); `/api/search` vector branch wired (recall-union, guarded) — extracted captureToResult/noteToResult mappers, RRF adds 1/(RRF_K+vecRank). GOTCHAS fixed: `::public.vector` cast + `OPERATOR(public.<=>)` needed b/c conn search_path=nexalog excludes pgvector's public schema (42704/42883). Browser-verified hybrid recall: "software dev faster" 12→54, "physical fitness" 1→30, "money/investments" 21→59, rankingMode=hybrid, topical hits w/ zero keyword overlap. tsc+vitest(24)+build green
- [ ] P8b Notes FTS — migration
- [x] P8c Chat citations SHIPPED — assistant message returns injected `sources` ({id,title,kind,url}); chat client renders clickable chips (note→/app/notes/{id}, bookmark→ext url). Note grounding now relevance-first (ILIKE proxy, no notes FTS) + excludes bookmark-twins (P6a filter); only FTS-relevant bookmarks cited, not 100 recency-fill. Browser-verified (5 note + 2 bm chips, 200), tsc+vitest green. NOT persisted across reload (needs jsonb col = gated migration; follow-up)
- [ ] P8d graph-aware retrieval + @-mentions
- [x] P9a Controlled-vocab 25-tag facet = primary Bookmarks nav (RC3) — SHIPPED, browser-verified (Business→543), tsc green; added tagIds filter to /api/search
- [ ] P9b Recompute memory_themes clustering (dep P8a)
- [ ] P9c Graph entity typing + dedup — D5, cross-repo + re-ingest
- [ ] P10 Spaced-repetition / progressive summarization / typed edges (later)

## Phase 5 — Ship gate
- [ ] tsc --noEmit clean
- [ ] vitest run green
- [ ] next build green
- [ ] Push only on explicit operator OK ⚠
