---
id: ci-plan-contract-gates
title: Wire the plan-contract gates into CI (workflow installed — protection pending)
status: blocked
area: platform
order: 4
---

The agent-side half of this task SHIPPED 2026-09-20 (PR against `main`, branch `chore/wire-ci`):
`.github/workflows/verify.yml` is installed from `scripts/templates/ci-verify.yml` and runs on every
PR and push to `main` — frozen-lockfile install (pnpm 10 / Node 22, matching the Dockerfile),
`sh scripts/sync-agents.sh --check`, `sh scripts/check-docs.sh --since <base>`, and
`pnpm typecheck / lint / test / build`. `check-expert-review.sh` is deliberately NOT wired (it wants
`docs/claude/**/checklist.md`; nexalog keeps its checklists at the repo root). The stale "no CI at
all" prose in `AGENTS.md` and the `clean-architecture` / `database` / `testing` rule modules was
corrected in the same commit, and all 20 tool mirrors were regenerated.

What remains is OPERATOR-ONLY — and **blocked by the GitHub plan, not by any repo setting**: the
`verify` check is **report-only** — nothing is required, so a red run does not block a merge, and
there is still no protection against force-push / direct push to `main`. This matters more here than
in the sibling apps: the database is the **shared Postgres**, and `pnpm db:push` is a
one-command way to drop columns across other apps' schemas.

**2026-09-20 — platform limit found while attempting to mark `verify` required (operator-approved):**
both server-side enforcement APIs return **403 "Upgrade to GitHub Pro or make this repository public
to enable this feature"** — the classic branch-protection API
(`PUT /repos/joeybuilt-official/nexalog/branches/main/protection`) AND the rulesets API
(`POST /repos/joeybuilt-official/nexalog/rulesets`). `joeybuilt-official` is on the GitHub **free**
plan, and branch protection / rulesets on **private** repos are a paid feature (Pro for personal,
Team for orgs). This applies to every private repo in the org — fleet-wide, not nexalog-specific.
Do not retry these APIs; they cannot succeed on the current plan.

**Next step (operator, plan-level):** either upgrade `joeybuilt-official` to GitHub Team (then: mark
`verify` required, block force-push/direct push — note `scripts/init-repo-protection.sh` as written
also sets `required_linear_history: true` + 1 required review, which conflict with the house
merge-commit style and single-account agent merges; use the narrower API call instead), or accept
that server-side enforcement is impossible for private repos and enforcement stays report-only.
Until then: `verify` reports on every PR; treat red as blocking by discipline. Then delete this
fragment, remove queue row 4 from `in-progress.md`, and add the `completed-features.md` entry, in
the same commit.
