# Deploy-Gap Reconcile — 2026-06-27

Audits every "DONE" claim in `plan.md`, `checklist.md`, and `optimization-plan.md` against:
- **on main?** = present in `origin/main` tree (verified by `git show origin/main:<file>` + grep)
- **in clone?** = present in a local `task/*` branch ahead of main

Items present only in the clone are re-seeded as open TASKS.md entries (see bottom).

---

## Summary table

| Claim | Source | on main? | in clone? |
|---|---|---|---|
| Phase 0–2 audit + findings doc | plan.md / checklist.md | YES (in 333f20c + older commits) | YES |
| P0 web-history error boundary | checklist.md | YES (333f20c) | YES |
| P1 web-history delete rollback + res.ok | checklist.md | YES (333f20c) | YES |
| P2 voice-memo alert → inline error | checklist.md | YES (333f20c) | YES |
| P2 bookmark archive res.ok + rollback | checklist.md | YES (333f20c) | YES |
| P2 web-history search aria-label | checklist.md | YES (333f20c) | YES |
| P2 settings inputs label association | checklist.md | YES (333f20c) | YES |
| P3 synthesis silent-accept → bool + banner | checklist.md | YES (333f20c) | YES |
| P0 migration 0010 applied to prod | checklist.md | YES (0010 on main) | YES |
| P6a twin-exclusion filter on note-LIST surfaces | checklist.md | YES (333f20c) | YES |
| P7b Today rebuild (triage nudge + recency lanes) | checklist.md | YES (333f20c) | YES |
| P8a pgvector embeddings (plexoEmbed + migration 0011) | checklist.md | YES (333f20c + 0011) | YES |
| P8c chat citations (sources chips) | checklist.md | YES (333f20c) | YES |
| P9a controlled-vocab 25-tag Bookmarks facet | checklist.md | YES (333f20c) | YES |
| 9b k-means clustering + memory_themes | plan.md | YES (earlier commits) | YES |
| C2 notes FTS (migration 0013 + search route) | TASKS.md | YES (0013 on main; search route uses notes.fts) | YES (+ test only in task/c2) |
| C4 mobile ShareReceiverActivity → /api/capture | TASKS.md | YES (ShareReceiverActivity.kt on main) | YES |
| D6 projects nav in app-sidebar | TASKS.md | YES (FolderKanban nav item on main) | YES |
| fix-batch P3: right-rail Promote hide | checklist.md | NO | YES (task/fix-batch-tier1-trivials) |
| C1 data export GET /api/export + settings button | TASKS.md | NO | YES (task/c1-data-export) |
| C2 notes FTS vitest | TASKS.md | NO | YES (task/c2-notes-fts — test only) |
| C3 wikilinks persist on note save + test | TASKS.md | NO | YES (task/c3-note-links-fix) |
| C5 embed cron plexoEmbed fix + embedding_state repair | TASKS.md | NO | YES (task/c5-embed-cron-fix) |
| D3 Cmd-K actions section | TASKS.md | NO | YES (task/d3-cmdk-actions) |
| D4 in-code note templates (round-out + test) | TASKS.md | NO | YES (task/d4-templates) |
| D5 web-history prefs 500 guard + safe-prefs lib | TASKS.md | NO | YES (task/d5-web-history-finish) |
| M2 chat RRF grounding (lib/search/rrf.ts) | TASKS.md | NO | YES (task/m2-chat-rrf-grounding) |

---

## Items on main (no action needed)

All items from the original optimization program (P6a, P7b, P8a/P8c, P9a, 9b) landed in commit `333f20c` ("feat: second-brain optimization") and earlier commits. Migration files 0001–0019 are all present on main. Core UI fixes (web-history, voice-memo, settings labels, bookmark archive, synthesis banner) landed in the same commit. C4 ShareReceiverActivity was included in the native Flutter commit stream. D6 (projects nav) is present. C2 notes FTS migration and search-route wiring are on main.

---

## Items in clone only → re-seeded

The following task branches exist locally but have NOT been merged to `origin/main`. Their code changes are real, verified-green commits but have not been PR'd/merged. Each is re-seeded as an open task below.

1. **fix-batch right-rail** (`task/fix-batch-tier1-trivials`, commit `8d0a741`) — hides disabled "Promote to Page" button unless `cluster.isScl`. Single-file change `app/(app)/app/graph/right-rail.tsx`.
2. **C1 data export** (`task/c1-data-export`, commit `85089e0`) — `app/api/export/route.ts` streams a ZIP; settings "Download my data" button; ADR-0009.
3. **C2 notes FTS test** (`task/c2-notes-fts`, commit `b0c9b4a`) — adds `lib/__tests__/notes-fts.test.ts` (45 lines). Migration + route already on main; only the test is missing.
4. **C3 wikilinks persist** (`task/c3-note-links-fix`, commit `8a23309`) — `lib/notes/wikilinks.ts`, fix in notes save route, test, backfill script.
5. **C5 embed cron fix** (`task/c5-embed-cron-fix`, commit `92a666a`) — rewrites `lib/enrichment/embeddings.ts` to call `plexoEmbed` directly; repairs `embedding_state`; adds test.
6. **D3 Cmd-K actions** (`task/d3-cmdk-actions`, commit `bf68dff`) — adds Actions section to `components/search-modal.tsx`.
7. **D4 note templates round-out** (`task/d4-templates`, commit `db11af5`) — extends `lib/note-templates.ts`; adds test.
8. **D5 web-history prefs guard** (`task/d5-web-history-finish`, commit `1c82eed`) — `lib/db/safe-prefs.ts` + guarded prefs reads in web-history page + settings route; adds test.
9. **M2 chat RRF grounding** (`task/m2-chat-rrf-grounding`, commit `4b4ffc5`) — `lib/search/rrf.ts` + chat-grounding route uses FTS+vector RRF; adds test.

---

## Re-seeded tasks (appended to TASKS.md)

See bottom of TASKS.md for the nine re-seeded items.

---

## Operator follow-ups (not code work)

- **Prod deploy**: all items on main but NOT yet deployed to nexalog.com (code ships via git push + container rebuild — authorization gate). The operator must push and rebuild to get optimization code live.
- **Migration 0013 prod apply**: notes FTS migration needs `pnpm db:migrate` on prod. C3 backfill script (`scripts/backfill-note-links.ts`) is operator-gated.
- **P0.6 embeddings drain**: write `scripts/drain-embeddings.ts` is safe code, but prod sweep is operator-gated (see PROGRESS.md).
