# In Progress

**Read this first.** The ordered queue of what is next. Top of the list is what to pick up now.
Every item points at a plan doc — if an item has no plan doc, it is not ready to start.

When an item ships: remove its row from here, delete its `in-progress.d/<slug>.md` fragment, move its
folder into `<area>/completed/`, and add an entry to `completed-features.md` — all in the same commit
as the code.

> **Status of this file.** Created 2026‑09‑19 during the Panoply re-adapt. Before that nexalog had a
> `roadmap.md` but **no queue at all**, so this is a first reconstruction from `roadmap.md` + the three
> existing plan docs + the root-level `HANDOFF.md` / `checklist*.md` scratch files. Rows marked
> *(unverified)* were inferred from a plan doc's own last-written status line and have **not** been
> re-checked against `main`. Re-verify a row against source before you start it.

## Active queue

| # | Item | Area | Plan doc | Status | Notes |
|---|------|------|----------|--------|-------|
| 1 | Second-brain remediation — Phase 0.5/0.6 deploy-gap reconciliation (before P1) | `platform` | [`platform/second-brain-remediation/plan.md`](platform/second-brain-remediation/plan.md) §Phase 0.5/0.6 | Open — roadmap calls this P0.5 | The plan has explicit "immediate next steps (before P1)" and a separate operator-gated section. Read §Operator-gated steps first; several steps will not run autonomously. |
| 2 | PKM expansion Tiers 0–3 — Phase 0.1 telemetry & dead-path hygiene, then Tier 1 | `platform` | [`platform/pkm-expansion/plan.md`](platform/pkm-expansion/plan.md) | Executing *(unverified — "at fold" per roadmap)* | Gate-dense phased arc. Phase 1.4 (data export / "exit door") **ADR APPROVED 2026‑09‑26** — `adr/0019-exit-door-data-export.md` is **Accepted for scope + format** (whole-account; repo files byte-for-byte + `manifest.json` with per-file sha256; ZIP via the existing `archiver`; stream from first byte + size cap; `git bundle` opt-in; export deletes nothing). **Deletion APPROVED 2026‑09‑26 — `adr/0021-deletion-and-purge-semantics.md` is Accepted:** typed confirmation + five-fact review screen; 30-day fully-usable cancellable window, worker keeps capturing; history disclosed + delete-and-fresh purge (rewrite rejected); identity deactivated for Nexalog only (fleet-wide erasure is a separate fleet act); legacy `pushd.nexalog` store out of scope (fate rides row 5 retire-staged). **Implementation is gated behind the export build (Phase 1.4) — no purge flow before the v2 export exists.** Q5 (legacy v1 store) was answered 2026-09-26 by the read-only inspection; Q8 (who can export) remains open and blocks nothing. |
| 3 | Projects — reference-based containers | `platform` | [`platform/projects/plan.md`](platform/projects/plan.md) | **SHIPPED 2026-09-28 (vertical slice — the surface exists). ⚠ Phase 5 (operator-gated push target + deploy + prod migration) still stands; the `project_items_item_kind_check` widening is hand-applied, never by the applier.** | Reconciled 2026-09-25 as **NOT shipped in this repo**, then built on 2026-09-28 against the ACCEPTED ADR-0018: `/api/projects` (list/create), `/api/projects/[id]` (detail/patch/delete), `/api/projects/[id]/items` (add/detach a reference), `app/(app)/app/projects/{page,[id]/page}.tsx`, a Library-group nav entry in the sidebar + mobile bottom bar, and sub-projects as `project_items.item_kind='project'` pointing at the CHILD project. The nesting policy (one parent, two levels) lives in the domain as `MAX_PROJECT_DEPTH` + `assertNestable` and is enforced in the single write path with a 400 carrying a machine-readable `code` — never a CHECK, never a depth column. **Schema:** one additive, idempotent migration for the record (`drizzle/0028_project_items_kind_project.sql`, widening the item-kind check to admit `'project'`), hand-applied by the operator; no `db:push`/`db:migrate`/`db:generate` runs from this tree. **2026-09-30 (browse layer):** `lib/projects/browse.ts` (pure) + `projects-browser.tsx` give the list search/filter/sort with the A1.7 invariant intact. **2026-09-30 (hierarchy):** create-as-sub-project in one step, plus a move/promote control (`reparentViolation`/`assertReparentable`, DELETE-then-INSERT in one transaction) — no `parent_id` column, no migration. **2026-09-30 (linked notes):** a Notes section on the detail page with the notes' dates and one-line excerpts, plus an on-demand, project-scoped note view at `/app/projects/<id>/notes/<noteId>`. The list NEVER reads `notes.content` — the store selects `left(content, NOTE_EXCERPT_SOURCE_CHARS)` and every list rule (survival, ordering, excerpt, empty copy) is the pure `lib/projects/notes.ts`; the body is read only on demand. **2026-10-01 (brief):** each project page now carries a synthesized BRIEF — `lib/projects/brief.ts` (pure assembly), `lib/projects/brief-service.ts` (through ADR-0014's **IntelligencePort**, implemented here for the first time in `lib/intelligence/`), `GET|POST /api/projects/[id]/brief`, and a `BriefSection` with a Regenerate control. No model configured ⇒ a labelled mechanical digest, never an error. Themes are READ from `memory_themes` and matched by embedding similarity — never recomputed. Still no schema change and no migration in any of the four. |
| 4 | Wire the plan-contract gates into CI | repo | `scripts/templates/ci-verify.yml` | **DONE 2026-09-26 — `verify` is a REQUIRED check on `main`.** The 403 was the *private*-repo plan limit, not a missing entitlement: the same protection call succeeds on a public repo. Public flip landed; branch protection is live (required check `verify` pinned to the GitHub Actions app, `strict: true`, 0 required approvals, admins enforced, no force-push/delete). | `.github/workflows/verify.yml` runs the two kit gates + typecheck / lint / test / build on every PR and push to `main`, and now BLOCKS a merge that fails. Secret scanning + push protection are enabled on the same repo. |
| 5 | Legacy v1 routes — pick the real direction after the honest-degradation stopgap | `platform` | [`in-progress.d/legacy-v1-routes-stopgap.md`](in-progress.d/legacy-v1-routes-stopgap.md) | **DIRECTION DECIDED 2026-09-26: retire, staged** (this is no longer an open question). Stopgap SHIPPED 2026-09-26. | Five carried-over v1 surfaces (`/api/sync`, `/api/sync/mutations`, `/api/notes`, `/api/bookmarks`, `/api/journal`) query the v1 content model through `{ db }` (`DATABASE_URL` → `nexalog_v2`, 3 tables) while their 34 tables live in the shared **`pushd`** db — every query raised `42P01` and 500'd, failing mobile sync in prod. They now degrade to a 503 `surface_unavailable`. **Not fixed:** the DB split itself. The remaining work is **move mobile to the v2 model**, not a routes decision. Still true and still absolute: do NOT change a `DATABASE_URL`, move data, or run `pnpm db:push` — a repoint/migrate remains operator-gated should it ever be chosen. **The 2026-09-26 read-only inspection settled the shape:** `nexalog_v2` holds only the 3 v2 app-state tables (no v1 content), all 34 v1 tables + live data sit in `pushd.nexalog`, and the shipped v1 `/api/export` route reads through the same `DATABASE_URL` path — so it 42P01s too and is NOT a working content export. Operator chose **retire, staged** (mobile moves to the v2 model). |
| 6 | Mobile Knowledge Garden — **surface DEFERRED (safe default; operator may overturn)** | `platform` | [`platform/mobile/parity.md`](platform/mobile/parity.md) §4.2 | **Tokens SHIPPED 2026-09-26; the screen is DEFERRED.** No `/app/graph` screen on mobile: it would need a `/api/graph` caller that does not exist, and building a screen nobody asked for is the expensive mistake. Parity row 13 stays **Missing — deliberately**. The shipped tokens + type→colour mapping + hardcoded-colour gate stay. To overturn: build `/app/graph` or a reduced fit-to-view version. |

## Blocked / waiting

| Item | Blocked on | Since |
|------|-----------|-------|
| Projects Phase 5 — ship gate | Operator-gated push target + deploy + prod migration | plan doc |
| Second-brain remediation operator-gated steps | See §Operator-gated steps in the plan — will not run autonomously | plan doc |

## Parked / directional

See `roadmap.md` → "Planned — never built (folded from stray plan dirs)". Those rows are the durable
record for work consolidated out of `/srv/nexalog-*-plan` on 2026‑08‑29; the working dirs are
archived under `/srv/plans/`. Do not resurrect a parked initiative into this queue without
moving its `roadmap.md` row first.

## Fragments

`in-progress.d/<slug>.md` is the single backlog shared by every harness (the agent, the Phalanx
loop, the agent, Plexo) — see `PANOPLY-OPTIMIZATION.md` §1a. This table is the human-readable
view; the fragment is the durable record and carries the machine-readable frontmatter. A fragment dies
with its merge: delete it in the same PR that ships the work.
