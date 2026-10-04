# AGENTS.md — Nexalog

Canonical, provider-neutral instructions for ANY coding agent or LLM working in this repo
(any agent or LLM platform).
If your tool reads a native file that imports this one, read this file as your hub.

The tool-native files (`.cursor/rules/`, `.clinerules/`, `.windsurf/rules/`,
`.github/copilot-instructions.md`, `GEMINI.md`, `CONVENTIONS.md`) are **generated** from this file
plus `.agents/rules/*.md` by `scripts/sync-agents.sh`. Never hand-edit a mirror; edit this file or a
rule module and re-run `sh scripts/sync-agents.sh` (`--check` is the staleness gate).

This file is the hub, and it carries an **index** of the rule modules at the bottom, between the
`PANOPLY:RULES` markers — each module named with a one-line description and the path to read, not its
full text. That is deliberate, not a shortcut: read whole, this file was ~152KB and a harness that
caps what it loads **silently truncated the middle**, so the ruleset it claimed to carry was neither
complete nor small. The canonical rule text lives once under `.agents/rules/*.md`; open the one or two
modules a task touches. The **per-rule** files (`.cursor/rules/*.mdc`) carry each rule's full body
verbatim, so a tool that can only load one file still gets the complete text of the rules that apply
to it (scope is read from each rule's own `Applies when:` line).

<!-- MIRROR:start — this block is copied verbatim into every tool-native file by scripts/sync-agents.sh. Edit here only; it is the "if you read nothing else" contract for tools that do not open AGENTS.md. -->
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
<!-- MIRROR:end -->

## What is Nexalog?

AI-enhanced personal knowledge management system (PKMS). Captures fragments of thought, information, and ideas from many surfaces, refines them using Plexo intelligence, surfaces them through search and a knowledge graph, and promotes ready ideas into action in sibling apps (Levio tasks, Pushd deploys).

**Tagline:** "Your second brain, with a backbone."

Plexo-native app built by Joeybuilt LLC. MIT.

## Tech Stack
- **Framework:** Next.js 16 (App Router)
- **Language:** TypeScript (strict)
- **Styling:** Tailwind CSS v4 + shadcn/ui
- **Database:** Shared Postgres (`nexalog` schema), Drizzle ORM
- **Auth:** Better Auth (shared `auth` schema in the shared DB — cross-app SSO)
- **AI/Intelligence:** Tiered via the IntelligencePort (`lib/intelligence/`): embedded adapter (direct provider, raw fetch, no SDK) is the standalone baseline; Plexo adapter supersedes it when Plexo is present + authorized (ADR-0014/0015/0017)
- **Port:** 3300
- **Domain:** nexalog.com

## Commands
```bash
pnpm dev           # Dev server on port 3300
pnpm build         # Production build (next build --webpack)
pnpm start         # Production server on port 3300
pnpm typecheck     # tsc --noEmit — run the FULL check, unfiltered, before every commit
pnpm lint          # ESLint (eslint.config.mjs) — this is the only formatter/linter; there is no Prettier or Biome
pnpm test          # vitest run (unit tests live in lib/__tests__/*.test.ts)
pnpm depcruise     # architecture boundaries — depcruise + coverage assertion (errors block; see clean-architecture.md)
pnpm db:generate   # drizzle-kit generate — writes into ./drizzle (schemaFilter: nexalog)
pnpm db:migrate    # drizzle-kit migrate — forward-only applier
pnpm db:studio     # drizzle-kit studio
```

**`pnpm db:push` exists but is BANNED.** `drizzle-kit push` diffs against the live database and can
drop columns — and this is the *shared* Postgres, where the `nexalog` schema sits beside other
apps'. See the MUST NOT list above. Migrations are generated, reviewed, and applied forward-only.

### Pre-commit gates (all three, every time)

- `pnpm typecheck` — the FULL typecheck, unfiltered. Do not grep the output or spot-check only the
  files you changed; a type error in an untouched module that your change broke through a shared type
  is exactly what this catches.
- `pnpm test` — the full suite. Never skip, `.only`, or comment out a failing test to get a commit
  through; fix the code, or stop and report the failure.
- `pnpm depcruise` — the architecture-boundary check (`.dependency-cruiser.cjs`, wired 2026-09-25;
  wrapped by `scripts/check-architecture.mjs` since 2026-09-25). `error` rules block (core purity,
  inward-only layers, `lib/` must not import the UI); the `web-lib-no-direct-db` violations are a
  baselined `warn` — the ratchet list lives in `clean-architecture.md` → "Known gaps". The wrapper
  also asserts it actually cruised the codebase: dependency-cruiser degrades **silently** (with a
  missing root `typescript` it cruised 3 modules and still reported success), so the gate now fails
  loudly on a degraded cruise. Do not replace it with a bare `depcruise` invocation.

CI (`.github/workflows/verify.yml`) re-runs all three on every PR and push to `main` — but it is
**required** on `main` since 2026-09-26 (the old 403 was the *private*-repo plan limit, not a missing
entitlement — the same call succeeds now that the repo is public). Run it locally anyway: CI reports
after the fact, and a required check gates the merge, not the work.

## Hard Rules
- All tables in the `nexalog` PG schema, never `public`
- Auth uses the shared `auth` schema via Better Auth
- No AI SDK imports (no `openai`, no `@anthropic-ai/sdk`) — intelligence goes through the IntelligencePort; embedded adapter uses raw fetch, Plexo adapter federates when available (ADR-0017)
- No Sentry, no PostHog, no Inngest, no LangChain — Plexo handles observability and async
- No hardcoded secrets — env vars only
- PlexoConnectionStatus belongs in dashboard layout only — never on individual pages
- MIT SPDX header on every new file: `// SPDX-License-Identifier: MIT`

## Key Directories
```
app/(app)/             # Authenticated app pages
app/(auth)/            # Auth pages (login)
app/(website-layout)/  # Public marketing/landing pages
app/api/               # API routes
components/            # React components
lib/auth/              # Auth client/server helpers
lib/db/                # Drizzle schema + connection
lib/plexo-registration.ts  # Plexo App Profile boot registration (21 tools)
instrumentation.ts         # Server boot hook (calls registerWithPlexoCore)
```

## Plexo Integration
- Plexo bridge: `@joeybuilt/nexalog-bridge` in the Plexo monorepo (21 tools wired)
- Registration: `lib/plexo-registration.ts` — runs on boot via `instrumentation.ts`
- Data endpoint: `app/api/plexo/data/route.ts` — service-key authenticated CRUD for notes, captures, bookmark tags
- Tool invoke: `app/api/plexo/invoke/route.ts` — handles tool calls from Plexo agents
- Config: `joeybuilt.config.ts` — app profile metadata

## Domain Model
- **Notes** — text entries in `nexalog.notes`; markdown; soft-deletable
- **Captures** — inbox of raw links/snippets in `nexalog.capture_sources`
- **Bookmarks** — URL captures with OG metadata in `nexalog.capture_sources` (kind=url)
- **Bookmark tags** — flat tagging in `nexalog.bookmark_tags` + `nexalog.bookmark_tag_assignments`
- **Workspaces** — `nexalog.workspaces` (one active workspace per user in v1)
- **Voice notes** — `nexalog.voice_notes` (schema exists; transcription via Plexo Deepgram when PAX-exposed)
- **Imported conversations** — the agent.ai export conversations land as brain pages `notes/<slug>.md` (`type: note`, dedupe on the frontmatter `claude_conversation_uuid`); the run is ledgered in `nexalog.imports`. Every page a writer here creates carries a TOP-LEVEL `date` (the content's own creation instant — never the run time), because that is the only date key the brain's index reads: a date under `claude_created_at` / `anytype_created_at` / `nexalog.captured_at` alone is provenance, invisible to the index, and the page would be filed under its import time

## Where everything lives

| You need | Read |
|---|---|
| The overall plan (initiatives) | `docs/agents/roadmap.md` |
| What to work on now | `docs/agents/in-progress.md` (+ `docs/agents/in-progress.d/<slug>.md` fragments) |
| What landed recently | `docs/agents/worklog.md` |
| What already exists | `docs/agents/completed-features.md` |
| Decisions & gotchas | `docs/agents/architecture.md`, `docs/agents/key-patterns.md` |
| Architecture decisions (long form) | `adr/NNNN-slug.md` |
| Infrastructure | `docs/agents/infrastructure.md` |
| How to work (process) | `.agents/rules/workflow.md`, `quality-bar.md`, `git-workflow.md`, `documentation.md` |
| Architecture premise + this repo's layer map | `.agents/rules/clean-architecture.md` |
| Code / tests / errors | `.agents/rules/code-style.md`, `testing.md`, `error-handling.md` |
| Data & interfaces | `.agents/rules/database.md`, `data-modeling.md`, `api-design.md` |
| Frontend / design | `.agents/rules/frontend.md`, `design-system.md` |
| AI / intelligence | `.agents/rules/ai-features.md` |

Team-shared context lives in `docs/agents/` and is committed to git. Personal preferences and
per-user workflow rules stay in local `~/.<tool>/` memory, never here.

## Enforcement — the honest version

- **A gate exists, and it is narrower than it sounds: it binds only the tool that reads it.** A tool-specific permission file
  (added 2026-09-25; deny list copied verbatim from the sibling `fylo` gate, plus this repo's
  db-destruction and deploy denies: `pnpm db:push`, `pnpm drizzle-kit push`, `psql`,
  `docker compose … nexalog … up`) mechanically refuses those commands **in a agent tool session in
  this repo** — that closes the biggest hole, since the #1 MUST NOT above is no longer prose for the
  one harness that reads the file. It is one harness: any agent, any agent, any agent, the agent, the agent, the agent,
  other agents never read it, so for them the MUST NOT list is still **prose**. The gate is also not a sandbox — it constrains the agent's tool calls, not the shell.
- **Branch protection is live as of 2026-09-26.** `.github/workflows/verify.yml` (the `verify` job:
  frozen-lockfile install, `sync-agents.sh --check`, the `check-docs.sh` landing gate,
  `pnpm typecheck / lint / test / build`) runs on every PR and push to `main`, and `verify` is a
  **required** status check on `main` — a red `verify` blocks the merge. Secret scanning and push
  protection are enabled on the same repo. Known residual holes, accepted knowingly: a PR can edit
  `verify.yml` and be checked by the edited version; protection gates git merges, not shells
  (`pnpm db:push` remains ungated); and with `enforce_admins: true` a stalled Actions report blocks a
  merge until the rule is edited.
- For every harness other than the agent — and for a bad merge in general — the guardrails above
  remain **doc-level doctrine only**. They bind you by agreement, not by a gate. Treat that as a reason
  for more care, not less.
- `scripts/sync-agents.sh --check` and `scripts/check-docs.sh` are now wired into the `verify`
  workflow (installed from `scripts/templates/ci-verify.yml`). The single highest-value step left is
  **marking `verify` REQUIRED in Settings → Branches** plus forbidding force-push / direct push
  (operator; `scripts/init-repo-protection.sh` does it once someone with admin auth runs it). Keep
  running both scripts by hand before every commit regardless — CI reports after the fact.
- `scripts/check-expert-review.sh` is shipped but **not viable yet**: it wants a `checklist.md` with
  pending items under `docs/agents/`, and nexalog keeps its checklists at the repo root instead.

---

<!-- PANOPLY:RULES:BEGIN — generated from .agents/rules/*.md by scripts/sync-agents.sh. Edit the modules, not here. -->

- `clean-architecture` — Clean Architecture — `.agents/rules/clean-architecture.md`
- `workflow` — Workflow: Change Approval & Planning — `.agents/rules/workflow.md`
- `quality-bar` — Long-Term Quality Bar — `.agents/rules/quality-bar.md`
- `git-workflow` — Git Workflow: Commits, PRs, Branching — `.agents/rules/git-workflow.md`
- `documentation` — Documentation & Memory — `.agents/rules/documentation.md`
- `code-style` — Code Style & Patterns — `.agents/rules/code-style.md`
- `testing` — Testing — `.agents/rules/testing.md`
- `error-handling` — Error Handling — `.agents/rules/error-handling.md`
- `database` — Database & Migrations — `.agents/rules/database.md`
- `data-modeling` — Data Modeling — `.agents/rules/data-modeling.md`
- `api-design` — API & Event Payload Design — `.agents/rules/api-design.md`
- `frontend` — Front-End Engineering — `.agents/rules/frontend.md`
- `design-system` — UI Design System — `.agents/rules/design-system.md`
- `ai-features` — AI Features & Data Enrichment — `.agents/rules/ai-features.md`

<!-- PANOPLY:RULES:END -->

---

## License
MIT
