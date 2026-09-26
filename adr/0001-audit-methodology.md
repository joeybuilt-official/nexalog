# ADR 0001 — Nexalog end-to-end audit methodology

**Status:** accepted
**Date:** 2026-06-11

## Context
Operator requested a fresh end-to-end UI/UX/functionality audit-then-fix of Nexalog. Two prior findings docs exist:
- `audit-findings.md` (2026-06-09) — UI-layer pass; nearly all items shipped/closed.
- `nexalog-app-findings.md` (2026-06-10) — deeper graph/find/use/create functional pass; **many items still open (`⬜`), several gated on operator decisions** (graphiti entity-typing, two-graph reconciliation, on-demand ingest).

The working tree also has an **uncommitted in-progress feature** (`web-history` page + `page_visits` schema + settings/sidebar/middleware edits) not yet on the live site.

## Decision
1. **Audit the working tree, not just live.** Run a local dev server off the current working tree (includes uncommitted web-history) so the in-progress feature is covered. Cross-check the deployed live site (nexalog.com) where behavior may differ (prod vs dev mode).
2. **Don't re-report closed items.** Treat `audit-findings.md` closed items as fixed unless live re-test shows regression. Re-verify the open `⬜ [static]` items in `nexalog-app-findings.md` against current HEAD before re-listing — code may have moved.
3. **Seven-lens pass** (functionality, states, interaction, visual, a11y, responsive, perf/polish) per the operator's brief, live-app-first with static read for state-handling/validation/a11y.
4. **One consolidated findings doc** rewritten at `audit-findings.md` (this run supersedes the 2026-06-09 content; prior closed items summarized as a baseline section so history isn't lost).
5. **Hard operator gate after findings** — present, STOP, fix only after explicit approval (operator brief + phased-plan Step 6 both require it).

## Pre-mortem (3 failure modes + fallback)
1. **Re-reporting already-fixed items as new** → wastes operator's review. *Fallback:* diff every candidate finding against `audit-findings.md` closed list + grep current code before writing it.
2. **Local dev mode masks/adds bugs vs prod** (React dev warnings, no minification, different error overlay). *Fallback:* tag each finding with where observed (dev/live); confirm functional findings against live before P0/P1 classification.
3. **Auditing stale code — uncommitted feature half-wired** → reporting "bugs" that are just unfinished WIP. *Fallback:* check `git status`; for web-history, judge against "is this shippable as-is" not "is it complete", and mark WIP-incomplete distinctly from defects.

## Deviations from phased-plan ceremony
- **OSS benchmark skipped** — this is an audit of an existing app, not a greenfield build; no structural pattern to benchmark.
