# Nexalog — Claude Code Guidelines

`AGENTS.md` is the canonical, provider-neutral hub for this repo — project overview, stack, commands,
hard rules, key directories, Plexo integration, domain model, guardrails, and the full inlined
ruleset. Read it as your hub.

@AGENTS.md

## Claude-only notes

- **This repo has a `.claude/settings.json` permission gate — and it binds Claude Code alone.**
  Added 2026-09-25: a Claude Code session in this repo has the destructive commands mechanically
  refused (`pnpm db:push`, `drizzle-kit push`, `psql`, publish and deploy commands). That is one
  harness — every other tool (Cursor, Copilot, Codex, Gemini, Windsurf, Cline, aider) never reads
  `.claude/settings.json` and still gets the MUST-NOT list in `AGENTS.md` as prose, and CI is
  a **required** check on `main` since 2026-09-26 (branch protection is live: admins enforced,
  no force-push, no deletion). The permission gate still binds Claude Code only, so other harnesses
  get these rules as prose. Never run
  `pnpm db:push` in any case: the `nexalog` schema lives in the **shared** Postgres beside
  other apps' schemas, so a drop is not contained to this project.
- Claude Code follows `@` imports natively, but the rule modules are **also inlined** at the bottom of
  `AGENTS.md` (between the `PANOPLY:RULES` markers) so that harnesses which do not follow imports —
  OpenCode, Codex, Cursor, Copilot, Windsurf, Cline, aider — read the same contract. Do not re-add
  `@.claude/rules/*` imports here: that gives Claude a second copy and makes the two drift. Edit the
  module under `.claude/rules/` and re-run `sh scripts/sync-agents.sh`.
- The tool-native mirrors (`.cursor/rules/`, `.clinerules/`, `.windsurf/rules/`,
  `.github/copilot-instructions.md`, `GEMINI.md`, `CONVENTIONS.md`) are **generated**. Never hand-edit
  one; `sh scripts/sync-agents.sh --check` is the staleness gate.
- **`TASKS.md`, `PROGRESS.md`, and `HANDOFF.md` at the repo root are machine-local Phalanx loop state,
  not the backlog.** They are untracked and gitignored (see the MUST NOT block in `AGENTS.md`'s MIRROR
  preamble), so their churn no longer shows up in `git status` at all — but they still exist on disk
  for the loop, so never `git add` one back and never delete one to "clean up". The real backlog is
  `docs/claude/in-progress.md` + `docs/claude/in-progress.d/`. Never plan against the root files.
- Nexalog's intelligence layer is the one part of this codebase that already gets Clean Architecture
  right: `lib/intelligence/port.ts` with `embedded-adapter.ts` and `plexo-adapter.ts`, selected by
  `resolve.ts`. Use it as the template when extracting a new port — and never import an AI SDK
  (`openai`, `@anthropic-ai/sdk`, `ai`) to work around it.
