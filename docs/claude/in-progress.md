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
| 2 | PKM expansion Tiers 0–3 — Phase 0.1 telemetry & dead-path hygiene, then Tier 1 | `platform` | [`platform/pkm-expansion/plan.md`](platform/pkm-expansion/plan.md) | Executing *(unverified — "at fold" per roadmap)* | Gate-dense phased arc. Phase 1.4 (data export / "exit door") **ADR APPROVED 2026‑09‑26** — `adr/0019-exit-door-data-export.md` is **Accepted for scope + format** (whole-account; repo files byte-for-byte + `manifest.json` with per-file sha256; ZIP via the existing `archiver`; stream from first byte + size cap; `git bundle` opt-in; export deletes nothing). **Deletion is NOT approved — split to `adr/0021-deletion-and-purge-semantics.md` (Proposed, operator's).** Two questions stay open and block nothing on their own: Q5 (legacy v1 store) awaits the read-only prod inspection, Q8 (who can export). Q1–Q4, Q6, Q7 dispositions are in the ADR. |
| 3 | Projects — reference-based containers | `platform` | [`platform/projects/plan.md`](platform/projects/plan.md) | **Reconciled 2026-09-25 — NOT shipped in this repo. ⚠ Phase 2 hard stop CLEARED 2026‑09‑26: ADR-0018 Accepted; Phase 3 may start on the pure `packages/core` slice, with the migration/adapter/route slice released for the `CREATE` question — the provenance inspection landed 2026-09-26: `nexalog_v2` holds no v1 content, so Projects DDL there is a `CREATE`, not an `ALTER`; the *data* half folds into row 5 (design §5)** | The plan doc's "SHIPPED + LIVE @ 2026‑06‑12" was **V1-only** (the app at `/srv/nexalog-v1`); §1.7 commit `1866c2c` deleted every V2 Projects route and page. What remains is remnants (dead `drizzle/0012`+`0015` SQL, orphaned `lib/projects/*`, three `schema.ts` declarations — `schema.projects` is still wired into the **live** `/api/sync` routes). Dispositions of the six operator questions are in `adr/0018-*` §Operator decisions: Q2/Q3/Q4/Q6 take the ADR's defaults; **Q5 was ANSWERED 2026-09-26** by the read-only production inspection — `nexalog_v2` holds only the 3 v2 app-state tables and no v1 content at all, so Projects DDL there is a `CREATE`; the data half (the content lives in `pushd.nexalog`) is tracked with row 5. Phase 5 stays operator-gated. || 4 | Wire the plan-contract gates into CI | repo | `scripts/templates/ci-verify.yml` | **Workflow installed 2026-09-20 — report-only, and CANNOT be made required**: GitHub free plan 403s protection/rulesets on private repos | `.github/workflows/verify.yml` runs the two kit gates + typecheck / lint / test / build on every PR and push to `main`. Operator approved marking `verify` required; both APIs returned 403 (plan limit, org-wide). Options + details in the fragment — do not retry the APIs. |
| 4 | Wire the plan-contract gates into CI | repo | `scripts/templates/ci-verify.yml` | **DONE 2026-09-26 — `verify` is a REQUIRED check on `main`.** The 403 was the *private*-repo plan limit, not a missing entitlement: the same protection call succeeds on a public repo. Public flip landed; branch protection is live (required check `verify` pinned to the GitHub Actions app, `strict: true`, 0 required approvals, admins enforced, no force-push/delete). | `.github/workflows/verify.yml` runs the two kit gates + typecheck / lint / test / build on every PR and push to `main`, and now BLOCKS a merge that fails. Secret scanning + push protection are enabled on the same repo. |
| 5 | Legacy v1 routes — pick the real direction after the honest-degradation stopgap | `platform` | [`in-progress.d/legacy-v1-routes-stopgap.md`](in-progress.d/legacy-v1-routes-stopgap.md) | **Stopgap SHIPPED 2026-09-26 (PR #48, merged). Real direction is an OPEN operator decision — candidates named in the fragment** | Five carried-over v1 surfaces (`/api/sync`, `/api/sync/mutations`, `/api/notes`, `/api/bookmarks`, `/api/journal`) query the v1 content model through `{ db }` (`DATABASE_URL` → `nexalog_v2`, 3 tables) while their 34 tables live in the shared **`pushd`** db — every query raised `42P01` and 500'd, failing mobile sync in prod. They now degrade to a 503 `surface_unavailable`. **Not fixed:** the DB split itself. The open decision is repoint / migrate / retire — do not change a `DATABASE_URL`, move data, or run `pnpm db:push` before the operator picks. **The 2026-09-26 read-only inspection settled the shape:** `nexalog_v2` holds only the 3 v2 app-state tables (no v1 content), all 34 v1 tables + live data sit in `pushd.nexalog`, and the shipped v1 `/api/export` route reads through the same `DATABASE_URL` path — so it 42P01s too and is NOT a working content export. Operator chose **retire, staged** (mobile moves to the v2 model). |
| 6 | Mobile Knowledge Garden — token system ported, **surface still missing** | `platform` | [`platform/mobile/parity.md`](platform/mobile/parity.md) §4.2 + §6 D4 item 4 | `feat/mobile-knowledge-garden-tokens` | **Partly shipped 2026-09-26:** the design tokens, the type→colour mapping and a hardcoded-colour gate are in `mobile/lib/src/theme/knowledge_garden_tokens.dart` + two test files. Parity row 13 (`/app/graph`) stays **Missing** — no screen, no route, no `/api/graph` caller. The remainder needs a §1 gate decision (build vs. recorded deferral) before code. Fragment: `in-progress.d/mobile-knowledge-garden.md`. |

## Blocked / waiting

| Item | Blocked on | Since |
|------|-----------|-------|
| Mark `verify` required on `main` (queue row 4) | GitHub **free** plan — protection + rulesets APIs 403 on private repos; needs org upgrade to Team (or accept report-only) | 2026-09-20 |
| Exit door — deletion semantics | **`adr/0021-deletion-and-purge-semantics.md` (Proposed, 2026‑09‑26)** — the operator has not decided: two-step flow, grace window, git-history disclosure, shared-`auth` blast radius, legacy-store scope. Nothing implements deletion until this returns | 2026-09-26 |
| Projects Phase 5 — ship gate | Operator-gated push target + deploy + prod migration | plan doc |
| Second-brain remediation operator-gated steps | See §Operator-gated steps in the plan — will not run autonomously | plan doc |
| Legacy v1 routes — the real direction (queue row 5) | **Operator decision** (the 2026-09-26 stopgap call deferred it): repoint at `pushd` vs migrate the tables into `nexalog_v2` vs retire the v1 surfaces — see `in-progress.d/legacy-v1-routes-stopgap.md`. Prod data migration would be operator-gated regardless | 2026-09-26 |

## Parked / directional

See `roadmap.md` → "Planned — never built (folded from stray plan dirs)". Those rows are the durable
record for work consolidated out of `/srv/nexalog-*-plan` on 2026‑08‑29; the working dirs are
archived under `/srv/plans/`. Do not resurrect a parked initiative into this queue without
moving its `roadmap.md` row first.

## Fragments

`in-progress.d/<slug>.md` is the single backlog shared by every harness (Claude Code, the Phalanx
loop, OpenCode, Plexo) — see `PANOPLY-OPTIMIZATION.md` §1a. This table is the human-readable
view; the fragment is the durable record and carries the machine-readable frontmatter. A fragment dies
with its merge: delete it in the same PR that ships the work.
