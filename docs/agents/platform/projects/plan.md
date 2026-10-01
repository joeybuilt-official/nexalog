# NEXALOG-PROJECTS — Master Plan

> ## ⚠ READ THIS FIRST — the status below is V1-only
>
> **This plan describes the V1 app at `/srv/nexalog-v1`, not this repo.**
> Verified against `origin/main` @ `c20238a` (2026-09-25):
>
> - The §Phase 3–5 files it names do not exist here. Every Projects route and
>   page was deleted by `1866c2c` (§1.7 deletions), along with `lib/plexo.ts` —
>   the client D3 was built on. `apps/web/app/` has no `projects/` directory.
> - The commits it cites (`<sha>` + `<sha>`) exist in this repo's history,
>   but as V1 history carried in by the Phase 1 route-migration merge. They ship
>   nothing in V2.
> - What survives is **remnants, not a feature**: dead V1 migration SQL
>   (`drizzle/0012`, `0015`), an orphaned `lib/projects/{domain,store}.ts` with no
>   importer, their still-passing tests, and three `schema.ts` declarations.
>   `schema.projects` is the exception — it is referenced by the **live**
>   offline-sync routes (`/api/sync`, `/api/sync/mutations`).
> - **No part of "SHIPPED + LIVE" transfers to V2.** Do not follow §Phase 5 as a
>   checklist; there is nothing to re-ship.
>
> **Phase 2 (design + ADR) was re-opened and re-drafted for V2 on 2026-09-25, and APPROVED by the
> operator on 2026-09-26 —** see [`design.md`](design.md) and
> [`adr/0018-projects-reference-based-containers.md`](../../../../adr/0018-projects-reference-based-containers.md).
> That design supersedes `adr/0001-nexalog-projects.md` below, whose D1–D5 were
> decided for the V1 architecture. **Phase 2's ⚠ hard stop is cleared:** Phase 3 may start on the
> pure `packages/core` slice, while the migration/adapter/route slice is held on the `nexalog_v2`
> provenance question (design §5 / ADR question 5), which a read-only production inspection is
> closing. Phase 5 remains operator-gated.
>
> **AMENDED 2026-09-27 — sub-projects are in scope.** The operator directed hierarchy support
> (project → sub-project, **two levels**) before Phase 3 build; the decision record is
> **Amendment A1 appended to [`adr/0001-nexalog-projects.md`](adr/0001-nexalog-projects.md)**
> (`parent_id` self-reference on the live `nexalog.projects` table, a batched cycle/depth guard on
> the write path, no cascade on lifecycle, a computed — never written-back — living-doc rollup, an
> additive manual-`psql` DDL script, a two-level tree UI, and the flat-37 Claude-export import
> mapping). ADR-0001's header, which had contradicted its own approved body, is corrected in the
> same change. The supersession note above still stands for everything **except** A1: A1 is live
> and binding.

**Goal:** Build a first-class Nexalog **Project** — a reference-based container that groups existing notes/bookmarks, carries a living doc + a Plexo-executed brainstorm Work thread, and a lifecycle state — without copying any unit, modifying Plexo Core, or running local AI.

Mode: **interactive** (Phase 2 ADR = hard stop). Artifacts root: `/srv/nexalog-v1/docs/agents/platform/projects/`.

## Architecture seams (non-negotiable)
- **Domain** (project · grouping · lifecycle) — pure, I/O-free, depends on a `ProjectIntelligencePort` interface only.
- **Intelligence** (Plexo via Jex) — one thin client in `lib/plexo.ts`, implements the port. Plexo holds Work history keyed by projectId; never the registry.
- **Presentation** (UI) — `app/(app)/app/projects/*`. No AI logic, no "embedding" copy.

## Phases

## Phase 0 — Audit (read-only)
- Status: **done** — see `audit-findings.md`.

## Phase 1 — OSS benchmark + expert panel
- Status: **done** — top-5 by live stars; first principles + conflicts folded into ADR 0001.

## Phase 2 — Design + ADR  ⚠ HARD STOP (operator approval) ⛔
- Scope: ADR 0001 with one-way-door decisions D1–D5 + pre-mortem.
- Status: **APPROVED 2026-06-12.** D1 markdown text · D2 static `project_items` · D3 `chatMessage` channelRef=projectId · D4 draft/active/archived · D5 notes+bookmarks+**journal**.
- Exit: met.

## Status @ 2026-06-12 — SHIPPED + LIVE (⚠ **V1 ONLY — see the banner at the top; this describes
`/srv/nexalog-v1`, and no part of it is true of this repo, where the implementation was
deleted by `1866c2c`**)
All phases done. Migration 0012 applied to prod; commits <sha> (feat) + <sha> (brainstorm fallback) on local main (NOT pushed to remote); deployed to live nexalog-web (build+recreate). Verified end-to-end on nexalog.com: API smoke 8/8 (create · group-by-reference · IDOR-reject · living-doc · lifecycle archived + 409 illegal-transition · brainstorm real reply · list · soft-delete) + headless Playwright screenshots desktop(1440)+mobile(390). Pre-mortem #3 FIRED: Plexo `chatMessage` returns empty reply on this deployment → brainstorm degraded to `aiComplete` + transcript in chatSessions/chatMessages (still all-Plexo, no local AI); port preserved for future Work-threading swap. Test data cleaned up. See ADR 0001 UPDATE + next-session.txt for optional follow-ups.

## Phase 3 — Core build
- Scope: migration `0012_projects.sql` · domain module (`lib/projects/` — pure lifecycle + grouping logic + port interface) · `lib/plexo.ts` port impl (`plexoProjectBrainstorm` via `chatMessage`) · extract `lib/context-graining.ts` (shared w/ chat) · routes `app/api/projects/route.ts` (list/create, paginated, zod-validated), `app/api/projects/[id]/route.ts` (get/patch/delete), `app/api/projects/[id]/items/route.ts` (group/ungroup by reference, batched ownership guard), `app/api/projects/[id]/brainstorm/route.ts` (Work over Jex + history read-back).
- Deps: Phase 2 approval.
- Subagents: general-purpose for migration + route impl (one tight prompt each); Explore if a convention needs confirming.
- Guards: validated inputs (zod), parameterized Drizzle, `getAuthUser` on every route, batched ownership check on grouping (no N+1), pagination on list + items.
- Exit: `tsc --noEmit` clean; unit tests for lifecycle transitions + ownership guard pass; live Plexo `chatMessage` probe confirms Work threading (pre-mortem #3).

## Phase 4 — UI
- Scope: `app/(app)/app/projects/page.tsx` + `projects-client.tsx` (list, lifecycle filter, create) · `app/(app)/app/projects/[id]/page.tsx` + client (living-doc primary pane w/ markdown editor; grouped-knowledge panel paginated; brainstorm panel triggering a Work). shadcn/ui + Tailwind v4. No "embedding" copy; no creator-canvas drift.
- Deps: Phase 3.
- Exit: e2e screenshots (mobile 390 + desktop) of list + detail; create→group→brainstorm flow works against live Plexo.

## Phase 5 — Ship gate + handoff  ⚠ operator-gated (push target + deploy + prod migration)
- Scope: confirm push branch + deploy target BEFORE first commit. Ship gate: tests pass (no skips) · `tsc --noEmit` clean · `next build` succeeds · no unintended uncommitted changes. On green: commit + push + deploy if configured + apply `0012` to prod (operator-gated, like 0010/0011). Update the log (`docs/agents/worklog.md`) + the queue (`docs/agents/in-progress.md`).
- Deps: Phase 4.
- ⚠ One-way: prod migration apply + push.
- Exit: deployed + browser-verified on live; handoff written.

## One-way doors / gates
- ⚠ Phase 2 ADR approval (D1–D5) — **current gate.**
- ⚠ Phase 5 prod migration `0012` apply + push/deploy (operator-gated).
- Discovery gate: pre-mortem #3 (live Plexo `chatMessage` Work-threading) — if absent, degrade per ADR fallback and flag.

## Guardrails (restated)
No local AI pipeline · no Plexo Core change · no duplicated registry (Plexo holds pointer+history only) · no creator canvas · no hardcoded secrets · no rebuild of shipping code. On logic error: "Flaw identified. Correcting."

## Project brief — SHIPPED 2026-10-01 (sub-feature; Phase 5 still operator-gated)

A per-project **BRIEF**: a short, structured markdown summary of what the project is, its current
state, active threads, recent activity and open questions.

- **Pure assembly** — `apps/web/lib/projects/brief.ts`. Takes the project row, its linked notes'
  metadata (title/date/size — **never content**), its sub-projects and the workspace themes its
  notes match, and returns a deterministic input: five total comparators, code-point-bounded
  truncation (living doc, note list, sub-project list, theme list), soft-deleted rows refused, a
  recency window computed from an **injected** instant, and a `null` for a soft-deleted project.
  Theme matching is a pure cosine over the notes' vectors against `memory_themes`' own centroids —
  themes are **read**, never recomputed (the clustering pass is a separate change).
- **Synthesis through the port** — `apps/web/lib/projects/brief-service.ts` calls an injected
  `IntelligencePort`; the port is ADR-0014/0017's, implemented for the first time here as
  `lib/intelligence/{port,embedded-adapter,resolve}.ts` (OpenAI-compatible, raw `fetch`, no SDK).
  Prompt + tuning are a versioned template (`lib/intelligence/prompts.ts`); the model id is config
  (`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`).
- **Degradation is the contract** — no model configured, a model error, or an empty answer all
  return a clearly-labelled mechanical digest (`state: "fallback"` + a reason code), never a 5xx.
- **Surface** — `GET|POST /api/projects/[id]/brief` (read / regenerate), and a `BriefSection` on the
  detail page beside the existing sections, with a Regenerate control and all three async states.
- **Not in this slice:** persistence (every brief is synthesized on demand), a Plexo federated
  adapter (no agreed completion contract in this tree), provenance rows for model output, and any
  recomputation of `memory_themes`.

