# AGENTS.md — Nexalog

Canonical, provider-neutral instructions for ANY coding agent or LLM working in this repo
(any agent or LLM platform).
If your tool reads a native file that imports this one, read this file as your hub.

The tool-native files (`.cursor/rules/`, `.clinerules/`, `.windsurf/rules/`,
`.github/copilot-instructions.md`, `GEMINI.md`, `CONVENTIONS.md`) are **generated** from this file
plus `.agents/rules/*.md` by `scripts/sync-agents.sh`. Never hand-edit a mirror; edit this file or a
rule module and re-run `sh scripts/sync-agents.sh` (`--check` is the staleness gate).

The `PANOPLY:RULES` block at the bottom of this file names every rule module — a one-line description
and the path to read — and does **not** inline the rule text. That is deliberate: most harnesses do
**not** follow `@`-imports, but they can open a path that is named, and inlining the bodies here made
a ~152KB file that the loader reading it whole **silently truncated** at its cap (the middle, index
included, was dropped). The short format note:

- **This file and the single-file mirrors** carry the preamble plus the **index**. They are read
  whole, so the index is what fits — and it points at a path the reader can open.
- **The per-rule `.mdc` files** (`.cursor/rules/*.mdc`, `.agents/rules/*.mdc`) carry each rule's
  **full body**, scoped by that rule's own `Applies when:` line, so a tool loading one file gets the
  complete text of the rules that apply to it.

The rule bodies are canonical under `.agents/rules/*.md` — one home, never a second copy to drift.

<!-- The universal preamble ("if you read nothing else in this repo") lives at `.agents/preamble.md`.
It is copied VERBATIM into every generated tool-native mirror by `scripts/sync-agents.sh`; it is
deliberately NOT reproduced here. This file is read whole and its loader truncates at ~20,000 chars,
and the preamble is addressed to tools that will never open AGENTS.md — inlining it here pushed the
file past its cap and silently dropped the middle. Edit it at `.agents/preamble.md`; do not hand-edit
a mirror. See "Start here" below for the read order. -->

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
