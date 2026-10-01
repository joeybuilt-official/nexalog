# Nexalog second-brain — master remediation plan

Driven by `../../../../docs/audit-2026-06-27.md`. Phased Tier-1 first; each phase
independently shippable on **both** web and mobile (parity is non-negotiable).
No main merges; no prod-DB writes without operator sign-off.

The Tier-1 phases close the daily-driver-trust gaps in roughly the order an
end-user would notice the absence: a brain that survives signal loss (P1),
brings back what would otherwise be forgotten (P2), tells you what it just
did so you can trust it (P3). Tier-2 closes the "scales past a few hundred"
gaps; Tier-3 is depth.

---

## Phase ordering

| Phase | Title | Why now | Web work | Mobile work | ADR | Gating |
|---|---|---|---|---|---|---|
| **P0** | Audit + master plan + ADRs | brief is wrong on 2 premises (audit §2) | docs/audit-2026-06-27.md + docs/master-plan-second-brain.md | none | 0010..0013 | this PR |
| **P0.5** | Deploy-gap reconciliation | plan.md/checklist.md warn live ≠ workspace; "DONE" items may not be on main | grep+diff each P6a/P7b/P8a/P9a claimed-done item vs `git log origin/main`; write `../../../../docs/deploy-gap-2026-06-27.md`; re-seed any unshipped fix as its own task | none | none | P0 |
| **P0.6** | Embeddings backfill drain (RC4) | 4010 pending / 0 ready blocks RC3+RC4 unlock; upstream of P2 lenses | confirm `lib/enrichment/embeddings.ts` post-C5 cron actually drains; one-shot sweep script; verify `embedding_state='done'` bookkeeping | none | none | P0.5 |
| **P1a** | Web service-worker + offline shell | install-then-offline kills capture | Workbox SW, NetworkFirst HTML, CacheFirst statics, offline `/app` fallback | none | 0010 | P0 |
| **P1b** | Web IDB capture outbox | share-target loses data offline | `idb`-backed outbox; share+quick-capture+voice routes write outbox first, drain on `online` | none | 0010 | P1a |
| **P1c** | Mobile share-receiver retry queue | single attempt drops on flaky cell | none | `ShareReceiverActivity.kt` → enqueue to existing sqflite `mutation_queue` (reuse — do not build a new queue), nudge `WorkManager` | 0010 | P0 |
| **P1d** | Observability foundation | optimize-gate (§15) is shut until this lands | Effect.log + `withSpan` on `/api/{capture,search,chat,queue,voice,history}` boundaries; one OTel exporter (stdout in dev, Plexo-routed prod); kill 20 worst `console.*` sites | mirror three native log calls per file (`developer.log` w/ name=route) | none | P0 |
| **P2** | Resurfacing — daily digest + "forgotten" lens | queue ranker is good; surfacing is thin | "Daily brief" card on `/today` listing top-N queue picks + 3 "Forgotten" picks (≥30d unread, pgvector-related to recent query/notes) + 3 "Related now" (memoryThemes overlap with today's edits) | parity card on mobile Today screen | 0011 | P1d (need spans to tune) |
| **P2-prereq** | Auto-synthesis fix | memoryThemes table is empty | wire `scripts/cluster-themes.ts` into existing cron at `app/api/cron/enrichment/route.ts` behind `LOCAL_CLUSTER=1` (operator opts in after smoke); set `embedding_state='done'` on writes | none | none | P1d |
| **P2-fb** | Snooze + weekend feedback actions | logged but ignored | implement snooze (delay re-rank until `due_at`) + weekend (deprioritise weekday-only items 5d before resurface) | parity buttons | none | P2 |
| **P3** | Inline cited-AI trust UX | citations are bare links | hover-preview popover (Tiptap) + jump-to-block + "evidence strength" pill from RRF score | parity tap-to-preview sheet | none | P2 |
| **P4** | Query DSL + saved smart-views | facet UI doesn't scale | tiny query grammar (kind/tag/before/after/has/in:project), implemented as a single parser → existing search params; saved views as `query_views` table; smart-view list on `/today` | parity saved-view list + chip-driven query builder | 0012 | P3 |
| **P5** | Web clipper — finish + ship | extension/ exists (MV3 v1.2.1) but icons/popup.css/options.js/tests missing; needs retry-on-history-flush + bearer-token path for parity | finish missing assets, add retry/backoff, add bearer-token auth alongside cookie, write smoke vitest, ship to Chrome Web Store via signed zip | none | none | P4 |
| **P6** | Mobile voice-memo capture + calendar | parity gaps named in audit §2a | none | new `voice_memo_screen.dart` (`record` package → `/api/voice` → outbox); new `calendar_screen.dart` reusing `journal_providers` | none | P2 |
| **P7** | Spaced review | depth | `review_queue` table (SM-2 derived); `/app/review` daily card | parity native screen | 0013-companion | P6 |
| **P8** | Block transclusion | depth | Tiptap embed node resolving `[[note-id#block-id]]` against `/api/notes/[id]/blocks/[blockId]` | parity in `super_editor` | 0013 | P7 |
| **P9** | Typed objects (beyond ideas) | depth | generalise ADR-0004 + ADR-0008 to user-defined kinds | parity creation sheet | 0013 | P8 |
| **P10** | Graph decision execution | dead schema today | EITHER drop `ideas.graphEpisodeId` + simplify `/app/graph` to gadget OR wire graphiti ingest pipeline | none directly | 0013 | P9 |

---

## Operator-gated steps (will not run autonomously)

The plan writes the migration / script and STOPS. Operator signs off before
applying:

| Phase | What blocks autonomy | What I will leave ready |
|---|---|---|
| P1d | none | n/a |
| P2-prereq | `LOCAL_CLUSTER=1` env on prod; first cron run | env doc + script ready |
| P4 | drizzle/00XX `query_views` migration | migration file + verify pass on local |
| P5 | Chrome Web Store upload + secret rotation | zip artifact + signed manifest |
| P7 | drizzle/00XX `review_queue` migration | migration file |
| P9 | drizzle/00XX `typed_objects` + `typed_object_kinds` migration | migration file |
| P10 (drop path) | drizzle/00XX drop `ideas.graphEpisodeId` | migration file |

---

## Per-phase exit gate

Each phase commits ONLY when ALL of:

1. `node_modules/.bin/tsc --noEmit` clean.
2. `node_modules/.bin/eslint .` no new errors vs baseline.
3. `node_modules/.bin/vitest run` green (incl. any new tests).
4. Playwright `@390` + `@1440` smoke for the touched surface (web) AND
   `flutter analyze` (prod-host Flutter docker) green (mobile).
5. PROGRESS.md updated with branch, commit, verify output line, operator
   follow-ups.
6. ADRs created/updated in the same commit when the phase introduces a
   non-trivial decision.

If any check fails: leave changes uncommitted on the branch, write **what
broke** and **smallest viable next step** to PROGRESS.md, mark task pending in
TaskList, move on to the next unblocked phase.

If the phase needs operator action: write `BLOCKED: <reason>` to PROGRESS.md
and move on.

---

## Phase 0.5/0.6 immediate next steps (before P1)

Branch `task/p0.5-deploy-gap-reconcile` off origin/main:

1. For each "DONE" item in plan.md / checklist.md, grep `origin/main` for
   the named file change. Diff `main` vs current `HEAD` of this clone.
2. Write `../../../../docs/deploy-gap-2026-06-27.md` — three columns: claim · on main? ·
   in clone? Items shipped only in clone become re-seeded tasks.
3. Commit the doc; do not re-ship the fixes from this branch (each is its own
   task w/ its own verify gate).

Branch `task/p0.6-embeddings-drain` off origin/main:

1. Re-check `lib/enrichment/embeddings.ts` post-C5 status — does the cron
   actually call Plexo's embeddings server and write `embedding_state='done'`?
2. Write a one-shot drain script `scripts/drain-embeddings.ts` that batches
   pending rows (concurrency cap of 4) and stamps state. Operator-gated to
   run on prod.
3. Sweep-script for the "state lies" condition: `embedding IS NOT NULL AND
   embedding_state != 'done'` → set done.

## Phase 1 immediate next steps (after P0.5/0.6)

Branch `task/p1a-web-sw-offline-shell` off origin/main:

1. Add `next.config.*` SW build target (or `@ducanh2912/next-pwa` if it's the
   leanest path — research before adding the dep).
2. Workbox stratagems: NetworkFirst for HTML, CacheFirst for `_next/static`,
   StaleWhileRevalidate for `/api/today/cards`, NetworkOnly for everything
   else.
3. `app/offline/page.tsx` — minimal "you're offline, this is what's cached"
   shell.
4. Playwright network-offline smoke at `@390` + `@1440`.

Branch `task/p1b-web-idb-outbox` off `task/p1a-web-sw-offline-shell` once that
PR is open:

1. `lib/offline/outbox.ts` — `idb`-backed FIFO with `opId`, `attempts`,
   `status`.
2. Wire share-target page + quick-capture-modal + voice-memo to outbox-first.
3. Drain on `window.online` + on `visibilitychange`.
4. Vitest fake-IDB round-trip test.

Branch `task/p1c-mobile-share-retry` off origin/main (independent of P1a/b):

1. `ShareReceiverActivity.kt` → on network error, write to existing sqflite
   `mutation_queue` via a tiny method-channel bridge (or hand off the URL via
   a `WorkManager` retry-with-backoff job).
2. `flutter analyze` green.
3. APK build = operator-gated (Pushd tag).

P1d is its own branch and PR — observability is too cross-cutting to be a sub-
commit of any other phase.

---

## Time budget (rough, not a commitment)

- P0: this PR.
- P1a..d: 4 PRs, each one session.
- P2 + prereq + feedback: 3 PRs.
- P3, P4: 1 PR each.
- P5: 2 PRs (clipper has its own verify story).
- P6: 2 PRs (voice, calendar).
- P7..P10: 1 PR each.

Total: ~15 branches, each independently reviewable.
