# Nexalog — End-to-End Audit & Fix — Master Plan

**Goal:** Audit Nexalog across all seven lenses, produce one approved findings doc, then fix in severity order without redesigning.

## Expert panel (conflicts surfaced for operator)
- **UX/IA** vs **Maintainability** — UX wants the still-open graph/find/create items from `nexalog-app-findings.md` rolled into this fix run (they're the core product promise). Maintainability objects: those are pipeline blast-radius + already operator-gated (entity-typing, two-graph reconcile, on-demand ingest) — mixing them into a UI audit-fix muddies scope. **→ DECISION NEEDED (D1).**
- **Domain (PKMS)** vs **Performance** — Domain wants the uncommitted `web-history` WIP audited + finished. Performance + Maintainability say un-committed WIP shouldn't be "fixed" mid-build; audit it only for shippability, don't complete it. **→ DECISION NEEDED (D2).**
- **Security** — flags only: confirm no auth/billing gating regressions from the uncommitted middleware/settings edits. Low-conflict.
- **A11y** — prior pass fixed icon-button labels; wants a fresh keyboard/focus sweep on new surfaces (web-history, any new modals).

## Phases

## Phase 0 — Scope inventory
- Scope: Enumerate every route, flow, component, role-state. (Routes/components already crawled: ~34 page.tsx, 32 components, super-admin + app + auth + marketing route groups.)
- Deps: none
- Subagents: none
- Exit: checklist of every screen exists. **DONE.**
- Status: done

## Phase 1 — Seven-lens audit (read-only)
- Scope: Run every screen through functionality / states / interaction / visual / a11y / responsive / perf lenses. Live dev server (working tree, incl. web-history) at 360/768/1024/1440; console + network capture; static read for validation/state-handling/a11y. Re-verify open `⬜` items from `nexalog-app-findings.md` vs current HEAD.
- Deps: Phase 0
- Subagents: Explore ×2 (static state-handling sweep; open-findings re-verification) in parallel; main thread drives live browser.
- Exit: Every route observed at ≥2 widths; candidate findings collected, each diffed against prior closed list.
- Status: done — 768/1024 live pass + 3 static subagents + DB schema check. Findings in audit-findings.md §R2.

## Phase 2 — Findings doc + OPERATOR GATE ⚠
- Scope: Write consolidated `audit-findings.md` (P0–P3, repro/expected/actual/files/fix). Present + STOP.
- Deps: Phase 1
- Subagents: none
- Exit: Operator types "approved" (or edits the list). **⚠ ONE-WAY GATE — no fixes before approval.**
- Status: done — approved 2026-06-11 (D1=include all, D2=fix web-history).

## Phase 3/4 — Fixes (executed 2026-06-11)
- Shipped (tsc green; web-history + bookmarks + synthesis browser-verified): web-history error boundary + delete rollback + search aria-label; voice-memo inline error; settings label association; bookmark archive state-based; synthesis silent-accept → return-based + dismissible banner. = 7 clearly-correct UI/functionality fixes.
- **Gated on operator (terminal stop — authorization + design):**
  - ⚠ P0: apply migration `drizzle/0010_page_visits.sql` to prod `nexalog` schema (schema change / prod touch → needs OK). This is THE settings-crash fix.
  - ⚠ P2: run `scripts/backfill-favicons.mjs` on prod (prod data touch → needs OK).
  - D1 feature/design items (edge `fact` on-canvas, search-includes-graph, chat citations, entity-typing, two-graph reconcile, @-mentions, imports→note) — per brief Phase-3 rule "design decision/schema change → stop and ask". Re-verification corrected the stale audit: D1-1/2 (graph viz) already addressed; D1-9 + graph "coming soon" not defects.
- Status: in-progress — gated.

## Phase 3 — Fix P0 + P1
- Scope: Fix highest-severity first, one issue at a time, smallest change. Verify each in running app; re-test adjacent screens. Update findings status inline.
- Deps: Phase 2 approval
- Subagents: general-purpose for isolated multi-file fixes if needed
- Exit: All approved P0/P1 closed + verified.
- Status: pending

## Phase 4 — Fix P2 + P3
- Scope: Inconsistency/polish in severity order.
- Deps: Phase 3
- Exit: All approved P2/P3 closed or explicitly deferred.
- Status: pending

## Phase 5 — Ship gate
- Scope: `tsc --noEmit` clean · `vitest run` green · `next build` green. No push without operator OK (⚠ git push is an authorization gate per CLAUDE.md).
- Deps: Phase 4
- Exit: All three green; report. Push only on explicit operator OK.
- Status: pending

## Open decisions (block Phase 3 scope, not Phase 1/2)
- **D1:** RESOLVED — include all graph/find/pipeline items.
- **D2:** RESOLVED — fix + harden web-history.

---

# Expansion (2026-06-11) — "World-class second brain" optimization
Operator escalated: app is "mediocre," wants experts to fold functionality/fixes/gap-fills in. Ran a 5-expert panel; full synthesis + root-cause evidence + pre-mortem in **`optimization-plan.md`**. New phases below; that doc is the source of truth for scope/evidence.

## Phase 6 — Content-type integrity (fixes "bookmarks render as notes" — RC1)
- 6a [P0] Notes surface excludes capture-derived notes (read-path filter, no schema). Reversible.
- 6b [P1 ⚠decision+migration] Typed content model; stop double-write; reconcile graph-ingest source first.
- Status: pending

## Phase 7 — Daily relevance (fixes "Today old/irrelevant" — RC2)
- 7a [P1] Staleness off COALESCE(lastVisited,lastOpened,bookmarked,created) + recency tiebreak.
- 7b [P1/P2 ⚠product-design] Rebuild Today: open-loops + recency + triage; demote goneStale.
- 7c [P2 ⚠migration 0010] Wire web-history last_visited_at into scorer.
- Status: pending

## Phase 8 — Retrieval unlock (RC4; unblocks RC3) ⚠
- 8a [P0 ⚠prod-cost] Drain embedding backfill (4010 pending; 0 ready) → semantic search + clustering.
- 8b [P1 ⚠migration] Notes FTS. 8c [P2] cite chat grounding. 8d [P3] graph-aware retrieval + @-mentions.
- Status: pending

## Phase 9 — Category usability (fixes "messy categories" — RC3)
- 9a [P1] Controlled-vocab (25 tags) as primary Bookmarks facet; demote emergent theme_label.
- 9b [DONE — local, no Plexo] k-means cluster on pgvector embeddings + LLM labels via Plexo /api/v1/ai/complete → 18 clean memory_themes, 4111 bookmarks re-labelled; buildSemanticForest preferred in getForest. Committed + DEPLOYED + live-verified on nexalog.com (2026-06-12).
- 9c [⚠cross-repo + $$ re-ingest — DEFERRED per D5] Graph entity typing + dedup/prune. Needs Plexo entity_types forwarding + node-merge endpoints (don't exist) + full ~3000-episode re-ingest ($$/hours). NOT locally derivable (entity nodes live in Plexo graphiti DB, not nexalog pgvector). Operator-gated.
- Status: 9a+9b done; 9c deferred (cost + cross-repo gate)

## Phase 10 — Differentiation (P2, later)
- Spaced-repetition resurfacing; progressive summarization; typed graph edges surfacing `fact`.
- Status: pending

## Expansion decisions — RESOLVED 2026-06-11
- **D3** = yes, filter. → P6a SHIPPED (Notes + dashboard; tsc green; 41 authored vs 3457).
- **D4** = yes backfill → but P8a BLOCKED (Plexo `memory/embeddings`=404).
- **D5** = pursue graph cleanup now → but blocked (Plexo entity-type/node-merge endpoints missing).
- **D6** = full Today rebuild now (P7b).
- **D7 (architecture fork)** = **Path B** — embeddings nexalog-side via pgvector (extension installed) + embed through Plexo completion API + lean on existing `memory/search`. Avoids the missing Plexo memory endpoints.
- **Next-work** = ALL of: P9a vocab facet, P7b Today rebuild, P8c chat citations, prod-auths-first.

## Done this session (2026-06-11)
- P6a notes filter (Notes + dashboard) — shipped, tsc green, DB-verified.
- Migration 0010 APPLIED to prod nexalog (P0 settings crash structurally fixed; additive, guarded).
- Favicon backfill RUNNING on prod (P2; ~3590 validated, handful nulled).
- Earlier UI fixes (web-history error boundary + delete rollback, voice-memo, settings labels, bookmark archive, synthesis banner) — shipped, tsc green, key ones browser-verified.

## Done this session (cont. 2026-06-11)
- **P9a SHIPPED** — controlled-vocab 25-tag set is now the primary Bookmarks "Categories" nav (clean: AI & ML 1024, Personal 635, …); emergent theme forest demoted to a collapsed "Auto-themes" disclosure (kept, not deleted). Added a `tagIds` filter to `/api/search` (drizzle `exists()`+`inArray` — NOT `ANY(${array})`, which mis-binds). Browser-verified (Business→543 items, 0 console errors), tsc green. Files: `app/api/search/route.ts`, `components/content-finder/{types.ts,useContentFinder.ts}`, `app/(app)/app/bookmarks/{page.tsx,client.tsx}`.

- **P7b SHIPPED** — Today rebuilt around deterministic daily relevance: a triage nudge ("N saved links waiting"), "Pick up where you left off" (recent authored notes), "Recently saved" (recent bookmarks by `coalesce(bookmarkedAt,createdAt)`); the synthesis cards are demoted under a "Synthesis" heading; "Gone stale"→"Forgotten gems" (cap 3, positive framing). Browser-verified (triage 4111 + both recency lanes populated, 0 console errors), tsc green. Files: `lib/today/cards-data.ts`, `app/(app)/app/today/{page.tsx,today-cards.tsx}`.

- **P8c SHIPPED** — chat citations. `app/api/chat/[sessionId]/messages/route.ts` now returns the injected grounding as `assistantMessage.sources` ({id,title,kind,url?}); chat client renders clickable chips (note→`/app/notes/{id}`, bookmark→external url new tab). Notes grounding upgraded: relevance-first (ILIKE proxy — notes have no FTS) merged ahead of recency, AND excludes bookmark-twin notes (same NOT EXISTS filter as P6a) so note-chips are genuine authored notes (40 authored vs 3457). Bookmarks: only the FTS-relevant set is cited (cap 8), NOT the ~100 recency-fill ambient context. Browser-verified on prod-DB dev server (5 note + 2 bookmark chips, POST 200, chips render/truncate cleanly), tsc + vitest (24) green. Limitation: sources are NOT persisted (chat_messages has no sources column) → chips show only for freshly-sent messages, vanish on reload. Persistence = additive `sources jsonb` column = gated migration (follow-up).

- **P8a/Path B FOUNDATION BUILT (gated on prod migration)** — Embed-source decision RESOLVED: there is NO generic Plexo HTTP embed endpoint (memory/embeddings, ai/embeddings, /v1/embeddings on plexo-api all 404), but Plexo's *bundled ONNX embeddings server* `plexo-embeddings:3001` IS up/healthy on app-net and exposes `POST /v1/embeddings` (OpenAI-compatible, model `plexo-embed-v1`, **384-d, L2-normalized**, local + FREE, no auth). This is Plexo's own infra (not a hardwired external provider — satisfies [[feedback_no_hardwired_llm_provider]]) AND makes the backfill cost-free (kills the old D4 "prod embedding cost" gate). Built + verified this session:
  - `lib/plexo.ts` → `plexoEmbed(text)` + `EMBEDDING_DIMS=384`, reads `EMBEDDINGS_URL` (default the embeddings host). Live-tested: returns 384-d unit vectors; cosine(AI, AI-similar)=0.761 > cosine(AI, bread)=0.595.
  - `drizzle/0011_pgvector_embeddings.sql` → additive `embedding vector(384)` on capture_sources + notes + HNSW cosine indexes (pgvector 0.8.2 already installed in prod; guarded IF NOT EXISTS).
  - `scripts/backfill-embeddings.mjs` → idempotent (`WHERE embedding IS NULL`), throttled, free. Embeds capture text (og/derived title + desc + summary + extracted + url) and note text (title + stripped content).
  - tsc + vitest (24) + next build all green.
  - ⚠ **GATE (next): apply 0011 to prod `nexalog` (like 0010) + run `node scripts/backfill-embeddings.mjs` (free).** Search vector-branch wiring into `/api/search` RRF is deliberately DEFERRED until then — it is unverifiable while the column is empty (dev-verify shares the prod DB), and shipping unverified core-search code is the wrong call. Once column+data exist: embed query → HNSW cosine top-N → union missing rows into `merged` → add `1/(RRF_K+vecRank)`, then browser-verify.

- **P8a/Path B SHIPPED + LIVE (semantic search)** — migration 0011 APPLIED to prod nexalog (vector(384) on capture_sources+notes + HNSW cosine idx); backfill RUN (free local ONNX, captures 4111/4111, notes 3452/3458); `/api/search` vector branch wired (recall-union + RRF, guarded). Gotchas: `::public.vector` + `OPERATOR(public.<=>)` required (conn search_path=nexalog excludes pgvector's public schema). Browser-verified hybrid recall (12→54, 1→30, 21→59 on zero-keyword-overlap queries). tsc+vitest+build green.
- **RC1 cleanup EXTENDED (per operator 2026-06-11)** — audited every note-LIST surface for bookmark-twin leaks; added the twin-exclusion filter to **Inbox** (rows+counts, 3458→41 authored), **`/api/notes/search`** (@-mention picker), **themes/[themeId]** note panel. Notes page already covered via /api/search; single-note reads exempt. Inbox browser-verified.

## ⚠ DEPLOYMENT STATUS (important)
Migration 0011 + the embeddings backfill ARE applied to the **prod nexalog DB**. But ALL the CODE in this optimization program (P6a, the new RC1 leak fixes, P9a, P7b, P8c, P8a search) is **uncommitted in the workspace clone and NOT deployed** to live nexalog.com. The live site still runs old code → operator still sees bookmarks-as-notes there until a deploy. Deploy = git push + container rebuild (authorization gate). web-history WIP kept separate.

## Remaining program (next sessions)
1. **Deploy** the optimization branch to prod (gated) so all fixes go live.
2. **P9b/P9c** — themes from clustering / graph entity-typing+dedup — need Plexo side (Path A) unless derived locally.
