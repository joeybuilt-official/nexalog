# Key Patterns & Gotchas

Conventions to follow and traps to avoid, discovered the expensive way. Add to this file the moment
something surprises you — record the **symptom**, not just the fix, because the next person arrives
holding the symptom.

## Conventions

Patterns that new code must match. Keep each one checkable — a reviewer should be able to point at
a line and say "this violates it."

- **Kebab-case files; PascalCase React components; camelCase functions.** Unit tests are
  `*.test.ts` under `lib/__tests__/` (or a package's own `test/`), Playwright specs are `*.spec.ts`
  under `e2e/`. Mixed export style is deliberate: default exports for Next.js page/layout entrypoints,
  named exports everywhere else.
- **Internal imports use the `@/*` alias**, which maps to the repo root. No deep relative chains
  (`../../../../lib/…`).
- **No magic strings or numbers.** Persistence enums live in `lib/db/schema.ts`, feature types in their
  `lib/<feature>/` slice, port contracts with the port (`lib/intelligence/port.ts`). Add to the owning
  module before you use a new value.
- **Every new file starts with `// SPDX-License-Identifier: MIT`.**
- **`lib/` must not import the UI.** `lib/<feature>/` never imports `app/`, `components/`, or
  `middleware.ts`; `packages/core` imports nothing at all. `pnpm depcruise` fails on a breach.
- **Persistence goes through `lib/db/index.ts`** (the Drizzle client) and the query builder — not raw
  query strings in handler code.
- **Logging goes through `lib/logger.ts` (`logEvent`)** — structured JSON lines, not bare `console.log`.

## Gotchas

| Symptom you will see | Actual cause | What to do |
|---|---|---|
| `depcruise` reports "✔ no dependency violations found" but the count of cruised modules is single digits | dependency-cruiser degrades **silently** when root `typescript` does not resolve | The `scripts/check-architecture.mjs` wrapper already fails loudly on a degraded cruise (coverage < 90%, missing `tsconfig.depcruise.json`, a policed layer with zero modules). Never replace it with a bare `depcruise` call; if it fails, fix the resolution, not the wrapper |
| A dependency-cruiser `exclude` entry silently retires a file you are policing | `options.exclude.path` entries are **unanchored regexes** matched against the whole path — a bare `build` also excludes `lib/export/build-archive.ts` | Anchor every entry `(^|/)…(/|$)`. The wrapper reports how many tracked sources the excludes retired |
| A route queries a table that exists and still gets `42P01 relation does not exist` | The v1 content tables live in the `pushd` database, while `DATABASE_URL` here points at `nexalog_v2` — the split is real, not a typo | Do not repoint `DATABASE_URL` or move data unilaterally. The shipped stopgap degrades the surface to `503 surface_unavailable`; the direction (repoint / migrate / retire) is an operator decision recorded in `docs/agents/in-progress.d/legacy-v1-routes-stopgap.md` |
| Tests keep passing after you changed the query they cover | Sequentially-consumed (positional) mocks shift by one when you add a query to a parallel batch — the assertion is now reading the wrong row | Update the mock push order in every affected file in the same change; prefer mocks keyed by argument. See `.agents/rules/testing.md` |
| A page files under its import date, not the date it was written | The brain index reads a **top-level `date`** only. `claude_created_at` / `anytype_created_at` / `nexalog.captured_at` are provenance and are invisible to the index | Write the content's own creation instant into a top-level `date` field on every page a writer creates |
| `pnpm install` exits non-zero with `ERR_PNPM_IGNORED_BUILDS` | Not a repo defect — a pnpm build-script-approval prompt on this machine | `pnpm-workspace.yaml` declares `ignoredBuiltDependencies`; do not edit `package.json`/`pnpm-workspace.yaml` or add `--ignore-scripts` to make your environment pass. Use the same invocation CI uses (`pnpm install --frozen-lockfile`) and check a failure against clean `main` before owning it |

## Testing conventions

- **What must have a test before it merges:** business logic (validation, transformations,
  calculations, state machines, permission checks, formatting) and every public entry point — route
  handlers under `app/api/`, and `packages/core` use cases against fakes only.
- **Where tests live:** unit tests under `lib/__tests__/*.test.ts` (and `packages/*/test/`), named for
  the module under test. Route tests are **not** colocated beside `route.ts`; the nearest existing
  example is the rule. Playwright specs live under `e2e/` as `*.spec.ts`.
- **Mocked by default:** auth/authorization middleware (inject a fixed test user), the database, and
  external services. **Exercised for real:** the adapter against the thing it adapts, and the
  intelligence port's fakes in `packages/core` tests.
- **Never skip, `.only`, or comment out a failing test to get a change through.** Fix it or report it.
- When you change query structure or call ordering, update the mocks in the same change — a
  positional mock consumed in sequence returns the wrong data silently while the test stays green.

## Performance notes

- The architecture gate cruises ~274 modules; a healthy local run and a CI run can differ by one
  module on the same commit, which is why the coverage assertion is a **ratio** and not an exact count.
- Capture enrichment is fetch-once/store-on-record: re-fetching at render costs a vendor call per page
  view and makes the page fail when the vendor is down. If you find one, that is a bug, not a design.
- Route handlers that fan out to independent resources should issue those requests in parallel —
  sequential awaits turn one round-trip into several.

## Things that look wrong but are intentional

- **`pnpm db:generate` / `pnpm db:migrate` / `pnpm db:push` exist in `apps/web/package.json` and are
  all forbidden from this tree.** The scripts are real; the database is shared with sibling apps and
  its journal belongs to Pushd. Deleting the scripts is not the fix — the ban is the fix.
- **`docs/agents/in-progress.md` is tracked and hand-maintained** even though the kit's contract calls
  it a generated view. The reconcile sweep has not run here. Do not delete or untrack it; keep it in
  step with `in-progress.d/`.
- **`apps/web/app/api/sync/*`, `/api/notes`, `/api/bookmarks`, `/api/journal` return `503
  surface_unavailable`.** That is the deliberate honest-degradation stopgap, not a broken route.
- **`scripts/self-test-arch-gate.sh` is dev-only and is never wired into CI.**
