# Completed Features

The shipped log. One entry per feature, newest first. Read this before proposing work — it is the
cheapest way to avoid rebuilding something that already exists.

Add an entry when a feature is tested and signed off, at the same time you move its folder into
`<area>/completed/`.

## Entry format

```markdown
### <Feature name> — YYYY-MM-DD
- **What shipped:** one or two sentences, in terms of what a user or caller can now do.
- **Area:** `<area>`
- **Archived plan:** `<area>/completed/<feature>/<renamed-file>.md`
- **Notable decisions:** anything that constrains future work; link the ADR in `architecture.md`.
- **Known gaps:** what was deliberately left out, so the next person does not read it as a bug.
```

---

### Untrack machine-local loop state + build artifacts — 2026-09-25
- **What shipped:** the repo no longer tracks machine-local state. `TASKS.md`, `PROGRESS.md`,
  `HANDOFF.md`, `next-session.txt`, `.claude/settings.local.json` and the three root-level
  `nexalog-bookmarks-*.zip` build artifacts left the index via `git rm --cached` — every file stays on
  disk, so the Phalanx loop and the local Claude Code session keep working, and their churn no longer
  shows up in `git status` for the next commit to sweep in by accident. `.gitignore` now covers all of
  them; `next-session.txt` was the one path missing from it.
- **Area:** `repo` (tracked-ness hygiene)
- **Archived plan:** none — the task was a fragment (`in-progress.d/untrack-machine-local-state.md`),
  retired in the shipping commit.
- **Notable decisions:** **no history rewrite.** The fragment recommended against a force-push over
  ~31 KB of artifacts and that stands: the blobs stay reachable in already-published commits, but a
  force-push is destructive and forces a fleet-wide re-clone for nothing. `--cached`, not a disk
  delete — machine-local state belongs to the machine, and removing the files would kill the loop
  running on this box. The six root-level audit/scratch markdown files that opened row 5 were rehomed
  by `git mv` on 2026-09-20 (`platform/pkm-expansion/audit-2026-06/`, `ui/audit-2026-06/`) and needed
  no untracking.
- **Known gaps:** the artifacts still exist in history — `git clone` downloads them regardless of the
  new ignore rules (only a rewrite or a partial-clone filter changes that). The `AGENTS.md` MUST NOT
  block and `CLAUDE.md` then still described `TASKS.md` / `PROGRESS.md` / `HANDOFF.md` as "already
  tracked — a known defect"; that prose is now corrected (the MUST NOT block lives in the `AGENTS.md`
  MIRROR preamble, so the ~20 tool mirrors were regenerated) in the follow-up that also untracked the
  last four machine-local paths — see `.gitignore` and the 2026-09-26 worklog line.

### `.claude/settings.json` permission gate — 2026-09-25
- **What shipped:** the fleet's last repo without a shared permission gate now has one. A Claude Code
  session in this repo has the destructive commands mechanically refused before they run — `pnpm
  db:push`, `drizzle-kit push`, `psql`, publish commands, and the compose-up deploy — with the deny
  list copied verbatim from the sibling `fylo` gate.
- **Area:** `repo` (harness enforcement)
- **Archived plan:** none — the task was a fragment (`in-progress.d/claude-permission-gate.md`),
  retired in the shipping commit.
- **Notable decisions:** deny list verbatim from fylo (fleet parity — one list to reason about) with
  five repo-specific denies appended; the allow list pruned only where this repo's toolchain differs
  (no Prettier, no Biome, no Jest — ESLint + vitest only). Scope is recorded as **Claude-Code-only**
  in `AGENTS.md` and `CLAUDE.md`: no other harness reads `.claude/settings.json`, so the MUST NOT list
  stays prose everywhere else and `verify` remains report-only (queue row 4).
- **Known gaps:** `.claude/settings.local.json` is still tracked (operator-gated untrack — queue row
  5); the gate does not cover non-Claude harnesses, and it constrains tool calls rather than the shell.

### Architecture-boundary gate — depcruise in CI + pre-commit — 2026-09-25
- **What shipped:** the import-boundary rule is machine-checked. `.dependency-cruiser.cjs` +
  `pnpm depcruise` run in `verify` CI and the pre-commit template: `packages/core` importing anything
  (`core-is-pure`, incl. unresolved bare specifiers), outward-pointing layer edges
  (`core-no-outer-layers`, `adapters-no-apps`), and `lib/<feature>` importing the UI
  (`web-lib-no-ui`) are **blocking errors**; `lib/<feature> → lib/db` is a baselined **warn**.
- **Area:** `repo` (CI + architecture enforcement)
- **Archived plan:** none — the task was a fragment (`in-progress.d/arch-boundary-gate.md`), retired in
  the shipping commit.
- **Notable decisions:** severity ladder copied from fylo (`error` = currently clean and blocks;
  `warn` = known-existing, advisory until the incremental cleanup ratchets it). `web-lib-no-ui`
  shipped as a blocking error because the tree is already clean at 0 violations — the audit found
  **zero** `lib → app/components` imports, so no baseline was needed. The `core-is-pure` rule lists
  `dependencyTypes: [..., "unknown"]` deliberately: an unresolvable bare specifier (e.g. `import z
  from "zod"` in a package with no deps) is classified `unknown` by depcruise, and the first draft of
  the rule let it through. A root-level `tsconfig.depcruise.json` exists because depcruise needs one
  TS project spanning the monorepo for `@/*` + workspace resolution; without root `typescript`, it
  silently skipped every `.ts` file (6 modules cruised instead of 273) — `typescript` is now pinned
  in root `devDependencies`.
- **Known gaps:** `web-lib-no-direct-db` stays `warn` at 9 call sites (`lib/workspace.ts`,
  `lib/transcription/index.ts`, `lib/today/cards-data.ts`, `lib/themes/forest.ts`,
  `lib/projects/store.ts`, `lib/notes/wikilinks.ts`, `lib/export/load.ts`,
  `lib/enrichment/reader.ts`, `lib/enrichment/metadata.ts`) — ratchet to `error` as each slice's
  storage moves behind a port (`lib/intelligence/port.ts` is the pattern). The rest of the
  `clean-architecture.md` checklist (vendor types in slices, DTO boundaries, port + test-double
  pairing) remains review-only — not mechanically checkable per-diff. Branch protection is still
  blocked by the GitHub free plan (queue row 4), so `verify` — and this step inside it — reports
  rather than blocks until the plan changes.

### Blocking ESLint gate (baseline burned to zero errors) — 2026-09-21
- **What shipped:** `pnpm lint` exits 0, so the `verify` workflow's Lint step is fatal — a PR that
  introduces a lint error now shows red instead of being reported and ignored.
- **Area:** `repo` (CI + repo-wide code hygiene)
- **Archived plan:** none — the task was a queue row + fragment
  (`in-progress.d/lint-baseline-burndown.md`), both retired in the shipping commit.
- **Notable decisions:** the 19 pre-existing errors were fixed, not suppressed. The three
  `react-hooks/set-state-in-effect` sites were restructured to the patterns React documents for them
  (remount-by-`key`, honest initial state, render-phase reset) rather than eslint-disabled; the
  search page picked up an `AbortController` in the process, which also closes an out-of-order
  response race. `@typescript-eslint/no-require-imports` is scoped **off for `scripts/**/*.js` only**
  in `eslint.config.mjs` — those maintenance one-offs are CommonJS (`package.json` declares no
  `"type": "module"`), so `require('pg')` is correct there and the rule was misapplied, not violated.
- **Known gaps:** 47 warnings remain (unused vars, `@next/next/no-img-element`, exhaustive-deps,
  a `role="radio"` + `aria-pressed` a11y mismatch in `components/reader/reader-chrome.tsx`) and are
  deliberately non-fatal — `pnpm lint` runs without `--max-warnings`. Nothing ratchets the warning
  count down yet, and `verify` is still **report-only** overall: GitHub free plan 403s branch
  protection on private repos, so no check is required (see
  `in-progress.d/ci-plan-contract-gates.md`).
