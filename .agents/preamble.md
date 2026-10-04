<!-- The universal preamble: the "if you read nothing else" contract, copied VERBATIM into every
generated tool-native mirror by scripts/sync-agents.sh. It lives here rather than inline in
AGENTS.md because AGENTS.md is read WHOLE and truncated at ~20,000 chars — the hub does not need a
copy of the preamble summarised for tools that will never open it, and that copy pushed the file
past its loader's cap. Edit here only; do not hand-edit a mirror. -->
## If you read nothing else in this repo

**Before writing anything, read this file fully.** The short version:

- **Read, in order:** `docs/agents/roadmap.md` (the plan) → `docs/agents/in-progress.md` (the queue +
  the exact next step) → `docs/agents/worklog.md` (the running worklog — this repo has **no**
  `CHANGELOG.md`/`HISTORY.md`, so `worklog.md` IS the log; one running log, never two) → this file
  (stack + commands) → the `.agents/rules/` module for what you touch.
- **Carry existing work forward.** `docs/agents/in-progress.d/<slug>.md` fragments are the single
  backlog, shared by every harness. The top of `in-progress.md` is the live task with its next step —
  continue it; do NOT open a parallel track for work already queued. Root-level `TASKS.md` /
  `PROGRESS.md` / `HANDOFF.md` are **machine-local Phalanx loop state**, not the backlog — never plan
  against them and never commit changes to them.
- **Keep the plan and worklog current in the SAME change as the code.** Shipped-but-unlogged = not
  done. `scripts/check-docs.sh` is the landing gate; `--since REF` checks every commit individually,
  so **amend, don't follow up**.
- **Plans live in the repo, never at workspace root.** A plan is a row in `docs/agents/roadmap.md`,
  with depth in `docs/agents/<area>/<slug>/plan.md`. ADRs live in `adr/NNNN-slug.md`.
- **Clean Architecture is mandatory.** Dependencies point inward only; business rules import no
  framework / ORM / HTTP client / vendor SDK; external concerns sit behind a **port** with an adapter
  at the edge. `lib/intelligence/` (IntelligencePort + embedded/Plexo adapters) is the reference
  implementation. This repo is an honest **target with documented gaps**: rules and I/O are often
  co-located in the same `lib/<feature>/` file and some `app/api/**` handlers still hold business
  logic. New code follows the target, and a new outward-pointing dependency is a defect even where
  older ones survive.

### First touch — the kit is already adopted here; keep it current before you modify anything

**Nexalog carries the Panoply kit. Verify it before you write — do not assume, and do not work around
a stale copy.** The kit's own machine surface is a shell script any harness can run (Hermes, any agent,
any agent, CI — not just the agent):

    sh scripts/panoply.sh check          # 0 current · 10 not applied · 11 partial · 12 stale
                                         # 13 unadapted (placeholders left) · 14 mirrors drifted

A non-zero result means **stop and fix the kit state first — it IS the first batch of work**:

    sh scripts/panoply.sh apply          # deterministic seeding + the agent checklist
    sh scripts/sync-agents.sh            # regenerate every tool mirror AFTER editing modules
    sh scripts/panoply.sh check          # must exit 0 before other work begins

Do the judgement half the checklist names (fill every `{{TOKEN}}` from this repo's OWN manifests,
prune the `MODULE:` blocks that do not apply, merge — never overwrite — `AGENTS.md`).
A half-applied kit fails its own doc gate and looks like a doc bug, so finish it or revert it; do not
leave it partial. `PANOPLY_OFF=1` exists for a deliberate exception — say plainly that you used it, so
the choice is reviewed rather than assumed. **Never stamp a version without the regeneration it
implies**: `.panoply-version` is only true once `sync-agents.sh` has run over the reconciled modules.

### MUST NOT — hard guardrails

**What is actually enforced, honestly:** a tool-specific permission file can refuse the destructive commands below (`pnpm db:push` first among them) — but it binds **only the tool that reads it**. Every other harness that reads this block (any agent, any agent, any agent, the agent, the agent, the agent,
the agent, the agent) gets these guardrails as **prose**, and CI (`.github/workflows/verify.yml`) runs the
typecheck / lint / test / build and the docs + mirror gates on every PR. As of 2026-09-26 the repo is
public and `verify` **is a required check on `main`** — branch protection is live (admins enforced,
no force-push, no deletion), so a red `verify` now actually blocks a merge. The permission gate still
binds the agent only: CI is a merge gate, not a sandbox, and every other harness gets these rules as
prose. One hole closed, not all of them — so these
guardrails are doctrine, and they are absolute:

- **NEVER** push to `main` directly. Branch + PR, always.
- **NEVER** force-push `main` or a branch another writer has checked out, `git reset --hard` a shared
  branch, delete branches/tags, or rewrite published history. **The one exception is your own unmerged
  PR branch:** amending it and pushing with `git push --force-with-lease` is allowed — and is what the
  docs landing gate requires when a commit is missing its worklog line, because that fix belongs in the
  same commit rather than a follow-up. Never a bare `--force`, and never once someone else holds the
  branch.
- **NEVER** run `pnpm db:push` (`drizzle-kit push`). It diffs against the live DB and can drop columns.
  This database is the **shared Postgres** — the `nexalog` schema sits beside other apps'
  schemas, so a destructive command here is not contained to this project.
- **NEVER** apply a migration to the shared/production database without explicit human approval.
- **NEVER** create a table in `public`. Everything goes in the `nexalog` PG schema; auth lives in the
  shared `auth` schema via Better Auth.
- **NEVER** import an AI SDK (`openai`, `@anthropic-ai/sdk`, `ai`). Intelligence goes through the
  `IntelligencePort` only.
- **NEVER** add Sentry, PostHog, Inngest, or LangChain. Plexo handles observability and async.
- **NEVER** hardcode a secret. Env vars only, and never print one into a log line or a commit.
- **NEVER** deploy to prod (nexalog.com / prod-host), publish a release, or ship a signed mobile release build
  unless the task explicitly asks and a human has approved.
- **NEVER** pipe the network to a shell (`curl … | bash`) or install from an untrusted source.
- **NEVER** commit machine-local loop state: `.claude-state.json`, `TASKS.md`, `PROGRESS.md`,
  `HANDOFF.md`, `.phalanx-*`, `.claude-runs/`, `.claude/settings.local.json`, `.playwright-mcp/`.
  **None of it is tracked**, and `.gitignore` covers every one of these paths — the older "already
  tracked — a known defect" note is obsolete. Untracking is not deletion: the files still live on the
  machine, so never `git add` one back and never delete one to "clean up" — a running loop reads it.
  Anchored rules are used deliberately for the root-level scratch (`/progress.md`, `/progress-v2.md`)
  and for the two app-side `.bak` snapshots: a bare `*.bak` / `progress*.md` glob would swallow a
  legitimate file elsewhere in the tree.
- **ALWAYS** start a new file with `// SPDX-License-Identifier: MIT`.
- **ALWAYS** stop and get human approval before any change that is destructive, irreversible, or
  outside the approved scope.