# NEXALOG-PROJECTS — Checklist

## Phase 0 — Audit
- [x] Drizzle schema + entity names mapped
- [x] Jex/Plexo wiring + single client identified (`lib/plexo.ts`)
- [x] Routes/auth/UI conventions captured
- [x] "Work" primitive resolved (`chatMessage` channelRef)
- [x] audit-findings.md written

## Phase 1 — Benchmark + panel
- [x] Top-5 OSS by live stars verified
- [x] Container/grouping/living-doc/lifecycle per repo
- [x] First principles distilled (3+ repos)
- [x] Expert panel + conflicts → ADR

## Phase 2 — ADR  ⚠ HARD STOP
- [x] ADR 0001 written (schema, grouping, Jex contract, lifecycle, living-doc, pre-mortem)
- [ ] **Operator approves D1–D5** ← BLOCKING

## Phase 3 — Core build
- [x] migration `0012_projects.sql` (projects + project_items)
- [x] `lib/projects/domain.ts` (pure lifecycle + ProjectIntelligencePort)
- [x] context graining — DEVIATION: built `lib/projects/store.ts` buildContextDigest standalone; did NOT refactor shipping chat route (blast-radius; "no rebuild of shipping functionality"). Chat-share deferred-additive.
- [x] `lib/plexo.ts` port impl `plexoProjectIntelligence` (chatMessage, channelRef=projectId)
- [x] `app/api/projects/route.ts` (list paginated + create, zod)
- [x] `app/api/projects/[id]/route.ts` (get/patch lifecycle/delete)
- [x] `app/api/projects/[id]/items/route.ts` (group/ungroup, batched ownership guard)
- [x] `app/api/projects/[id]/brainstorm/route.ts` (Work over Jex + history read-back)
- [x] unit tests: lifecycle transitions (7/7 pass)
- [ ] live Plexo `chatMessage` Work-threading probe (pre-mortem #3) → folded into Phase 4 browser-verify
- [x] `tsc --noEmit` clean

## Phase 4 — UI
- [x] `projects/page.tsx` + `projects-client.tsx` (list, lifecycle filter, create)
- [x] `projects/[id]/page.tsx` + client (living-doc primary)
- [x] grouped-knowledge panel (group via /api/search picker + ungroup)
- [x] brainstorm panel (trigger Work, render history)
- [x] sidebar nav entry (Workspace group, FolderKanban)
- [x] no "embedding" copy / no creator-canvas drift (grep-verified)
- [x] `tsc --noEmit` clean + `next build --webpack` green (all 6 routes present)
- [x] e2e screenshots mobile 390 + desktop — DONE on live prod (headless Playwright, cookie-injected real session); list + detail render, brainstorm reply grounded in living doc, panes stack on mobile

## Post-ship follow-ups (autonomous continuation)
- [x] Journal add-picker — `/api/projects/[id]/candidates` + "Journal" tab in picker; fixed addItem kind-mapping (journal was mis-mapped to bookmark). Realizes D5 journal grouping in UI. SHIPPED (commit 3e… journal) + deployed + VERIFIED on prod (seeded temp journal → candidates returned it → grouped with kind='journal' → cleaned up). Note: first prod-host build hit a transient pnpm-build OOM under concurrent load (pipe-to-tail masked the exit → bad recreate → ~1 transient 502); clean rebuild succeeded, site 6/6 healthy.
- [ ] git push main to remote — gated (not requested)
- [ ] reinstate Plexo chatMessage Work-threading — blocked (Plexo returns empty; needs Plexo Core change = forbidden)
- [ ] dynamic smart-membership — out of scope ("not a generic container framework")

## Phase 5 — Ship  ⚠ operator-gated — DONE
- [x] operator approved: commit on main · deploy live · apply 0012 to prod
- [x] tests pass (7/7) · tsc clean · `next build --webpack` green
- [x] apply `0012` to prod nexalog (both tables verified)
- [x] commit on main (<sha> feat + <sha> brainstorm fix); only Projects files, optimization WIP untouched
- [x] deploy to live nexalog.com (build+recreate ×2); route live, container healthy
- [x] live prod verify: API smoke 8/8 (create·group·IDOR-reject·living-doc·lifecycle·409·brainstorm·cleanup) + visual desktop/mobile
- [ ] NOT pushed to GitHub remote (operator didn't request; push is a separate gated action)
