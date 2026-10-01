# Roadmap — the overall plan

The one canonical strategic view: the **initiatives** this project is committed to, in priority order.
One row is one initiative — a body of work that spawns several plan docs and several `in-progress.md`
queue rows — **not** a single task.

Three views, three altitudes, no overlap:
- **`roadmap.md` (this file)** — strategic. Initiatives and their band (Now / Next / Later).
- **`in-progress.md`** — tactical. The queue of what is next, which rolls up into these initiatives.
- **The worklog** — the change history underneath both.

## Now — in active development

| Initiative | Intent (one line) | Queue rows (`in-progress.md`) |
|---|---|---|
| PKM expansion - Tiers 0-3 | Truth, credibility, differentiators, and the Plexo moat, as a gate-dense phased arc | EXECUTING at fold. **Phase 1.4 (export) unblocked 2026-09-26** — `adr/0019-exit-door-data-export.md` Accepted for scope + format; deletion split to `adr/0021-deletion-and-purge-semantics.md` (Proposed). Plan: `platform/pkm-expansion/plan.md` |
| Projects - reference-based containers | First-class Nexalog Project grouping existing notes/bookmarks, with a living doc and a Plexo-executed brainstorm thread | **APPROVED 2026-09-26 — `adr/0018-*` Accepted; Phase 2 hard stop cleared.** Phase 3 may start on the pure `packages/core` slice; the migration/adapter/route slice is held on `nexalog_v2` provenance (design §5). Plan: `platform/projects/plan.md` (**its "SHIPPED + LIVE @ 2026-06-12" heading is V1-only — see the plan's ⚠ banner**). Design: `platform/projects/design.md` |
| Second-brain remediation - Tier 1/2 | Close daily-driver-trust gaps: survive signal loss, recover the forgotten, report what it did | P0.5 deploy-gap reconciliation open. Plan: `platform/second-brain-remediation/plan.md` |

## Next — committed, not yet started

| Initiative | Intent | Depends on |
|---|---|---|
| | | |

## Later — directional, not yet committed

| Initiative | Why it matters | Revisit when |
|---|---|---|
| | | |

## Planned — never built (folded from stray plan dirs)

Consolidated 2026-08-29 from `/srv/nexalog-*-plan`, `offline-first-apps-plan` (bucketed to `_plans/`).
Each row is the plan's intent as of its last write; the working dirs are archived, so these rows are the
durable record.

| Initiative | Intent (from plan doc) | Original plan dir | Status at fold |
|---|---|---|---|
| Full-app audit + fix | Audit then fix graph, pipeline, find, synthesis so Nexalog delivers knowledge-graph synthesis users can FIND/USE/CREATE | `nexalog-app-audit-plan` | Phase G2 done+deployed+verified (kind-filter, failure-surfacing, cascade-delete) |
| Android app (Play) | Thin Flutter WebView shell wrapping nexalog.com/app, Pushd-signed on tags | `nexalog-app-plan` | Plan only |
| Graph Explorer optimization | Make shipped-but-minimal explorer usable/safe/performant: fit-to-view, node/edge semantics, search/filter, a11y + mobile | `nexalog-explorer-plan` | COMPLETE — all 8 phases shipped+deployed+verified |
| Extension v1.2.0 (web history + already-saved) | Keep browsing history inside Nexalog (forward capture + back-catalog import); already-saved indicator; no URL leakage | `nexalog-extension-history-plan` | Phases 1–2 build-only, uncommitted; Phase 3 prod-migration gate needs operator OK |
| Graphiti graph completion | Drain historical notes+bookmarks into dedicated graph workspace, clean orphans | `nexalog-graph-plan` | Phase 1 paced backfill (~2.5–3 days), then dedupe |
| UI/UX/functionality audit | Audit every screen/flow through 7 lenses, gated findings, fix in severity order | `nexalog-ui-audit-plan` | COMPLETE — all 16 findings resolved, deployed |
| Offline-first native apps | Every Joeybuilt Android app renders last-synced content + queues writes offline, reconciles on reconnect | `offline-first-apps-plan` | FYLO SHIPPED v1.0.25; other apps follow the same pattern |
