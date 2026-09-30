# Database & Migrations

> **Applies when:** the project owns a database schema and a migration history.
> **Delete this file (and its `@` import in CLAUDE.md) if:** the project has no database of its own, or only reads from a schema another team owns.

## The database is a Detail

Everything in this file is outer-layer work. The ORM, the driver, and the schema are Frameworks & Drivers; the repository implementations that wrap them are Interface Adapters — replaceable in principle, and never permitted to dictate the shape of a business rule. See `clean-architecture.md`. The migration rules below lose none of their force for being outer-layer: they are how you keep a Detail from taking production down.

- **Repository interfaces are ports owned by the inner layer; the Interface Adapters layer implements them.** The use case declares what it needs (`findActiveOwnedBy`, `save`); the adapter decides how to get it. A repository interface carrying `limit`, `offset`, `include`, or a query-builder object in its signature is the ORM leaking inward — express the need, not the query.
- **Never pass an ORM model or entity inward.** Map rows to domain types in the adapter, at the edge. An ORM object in a use-case signature drags lazy loading, session lifetime, and the vendor's column names into your business rules — and from then on every migration is also a domain change.

## Schema changes

- Make every schema change through a migration. Never edit the database directly — through a GUI, a console, or an ad-hoc `ALTER`. A direct edit exists only on that one machine; the next environment to deploy will not have it, and the schema file will disagree with reality.
- Treat the schema definition file (`apps/web/lib/db/schema.ts`) as the single source of truth. Change it first, then generate the migration from it. If the schema file and the database disagree, the schema file is right and the database needs a migration.
- **All tables live in the `nexalog` PG schema, never `public`.** `apps/web/drizzle.config.ts` declares `dialect: "postgresql"`, `schema: "./lib/db/schema.ts"`, `out: "./drizzle"`, and `schemaFilter: ["nexalog"]`, and reads its URL from `process.env.DATABASE_URL`. The `auth` schema belongs to Better Auth (shared cross-app SSO) — do not add app tables to it.
- Every new table, column, index, constraint, or enum value requires a generated migration in the same change. A schema edit with no migration file alongside it is an incomplete change.

## This repository runs against a SHARED database — read this before any schema change

The rules above assume a repository that owns its database and its migration history. **This one does not.** The `nexalog` schema sits in a Postgres instance shared with sibling apps, and the migration journal in that database belongs to a sibling: `pushd.drizzle.__drizzle_migrations` carries Pushd's own history (verified 2026-09-27 — the hashes in that journal match Pushd's chain and **none** match this repository's).

Three rules above therefore have a documented, deliberate exception here:

- **Never run the applier or the generator against this database from this tree.** `pnpm db:migrate` (`drizzle-kit migrate`, run in `apps/web`) writes this repository's bookkeeping into a journal another app owns, and `pnpm db:generate` diffs `schema.ts` against a live database whose other schemas are not ours to change. Both are banned here; `db:push` is banned outright everywhere (see below).
- **Apply schema changes by hand, scoped to the `nexalog` schema only** — reviewed, idempotent SQL executed through a parameterized session against `nexalog.*`. This is the single exception to "never hand-apply migration SQL". Scope every statement to `nexalog`; never touch `public`, `auth`, or another product's schema, and never alter a migration journal you do not own.
- **Still land the migration file.** A hand-applied change lands its hand-numbered, idempotent migration file in the same change, so the chain remains an honest record of what was applied. The file is the *record*; it is not the applier.

**A human approves every change to the shared database before it is applied.** A standing guardrail, not waived for small changes. Verification is unchanged: query the system catalog or select the new column and state what you saw — "the command printed OK" is not verification.

**The chain is hand-numbered and has no journal.** `apps/web/drizzle/*.sql` (hand-numbered `0001_phase11_capture_sources.sql` … `0028_project_items_kind_project.sql`) plus `apps/web/lib/db/migrations/0001_capture_lifecycle.sql`. There is **no `drizzle/meta/` directory**, so drizzle-kit keeps no snapshot of what applied; the numbering has collided before (two `0008_*.sql` files). Check the existing numbers in both directories before adding a migration, and never reuse a number.

## NEVER hand-write migration files

- **Always create migrations through the toolchain's generation command, `pnpm db:generate` (`drizzle-kit generate`, run in `apps/web`) — where it is permitted.** Never author a migration file from scratch. The failure differs by toolchain but the rule does not: in toolchains that keep journal/snapshot bookkeeping alongside each migration, a from-scratch file has neither, so the migrator cannot see it — it passes review, passes local testing where you ran the SQL yourself, and then silently never runs in production. In chain-based toolchains (revision graphs with down-revision pointers), a from-scratch file risks a broken or forked chain that blocks every later migration. Generate first; the bookkeeping comes with it.
  **Nexalog's exception:** generation is banned against the shared database (see the shared-database section), and there is no `drizzle/meta/` journal for the legacy hand-numbered chain — so here the reviewed, `nexalog`-scoped hand-written file **is** the sanctioned path, landed in the same change as the SQL that was applied by hand. "Reviewed and scoped" is the whole of the exception; an unreviewed ad-hoc file is still forbidden. If generation is ever used against a safe target, diff its output against the existing `drizzle/*.sql` chain before keeping it.
- If a generated migration's SQL is wrong or needs tuning, edit the generated file. That keeps the bookkeeping intact. Do not delete it and write a replacement from scratch.
- Make migrations idempotent — `IF NOT EXISTS` on creates, `IF EXISTS` on drops. A migration may be re-run against a partially-migrated database during a retry or a rollback-and-replay; a non-idempotent one fails the second time and blocks the deploy. If the toolchain has an auto-patch step for this, run it after any manual edit to a migration.
- Migrations are forward-only. Never edit or delete a migration that has been merged or applied anywhere but your own machine — the migrator records what it applied, and rewriting history makes its record a lie. Fix a bad migration with a new migration.

## Apply, then verify

- After generating, apply with `pnpm db:migrate` (`drizzle-kit migrate`, run in `apps/web`). This command must be the toolchain's **non-interactive, forward-only applier** (deploy-style, never a dev-mode sync that can prompt to reset) — it was chosen at adapt time precisely because it never drops data, which is what makes it safe to run without asking. If the command in this file can prompt, reset, or drop, the fill is wrong: stop and fix it rather than running it.
  **Nexalog's exception: the applier is never run at all from this tree** — the reviewed SQL is applied by hand against `nexalog.*` (see the shared-database section), and the verification step below carries the whole burden of proof.
- **Verify the migration actually landed by querying the database directly** — inspect the system catalog (e.g. `information_schema.columns`) or select the new column. Do not trust the CLI's success output alone; a migrator can report success for a file it skipped, and the failure then surfaces as a production error instead of a local one.
- State the verification in your report: which object you queried and what you saw. "The command printed OK" is not verification.

## NEVER use the interactive push/sync command

- **Never run the ORM's interactive schema-push/sync command — `pnpm db:push` (`drizzle-kit push`).** It diffs the schema against a live database and applies it in place: it can DROP tables and columns to make the database match, it prompts mid-run in ways that are easy to answer wrong, and it leaves no migration file — so the change never reaches any other environment. Use generate + apply instead, always. **This is the sharpest edge in this repo**: the `nexalog` schema sits in the *shared* Postgres beside other apps' schemas, so a destructive sync here is not contained to this project. `.claude/settings.json` denies it for Claude Code; that binds Claude only, so it is a hard rule for every other harness.
- The same ban covers any "reset", "force", or "accept data loss" flag on the migration tooling. If you believe one is genuinely needed, stop and ask the user first.

## Writing data

- Validate and sanitize every input before it reaches a write. Enforce shape and type at the boundary, not in the handler body.
- **Never delete-and-re-insert a row to update it. Use UPDATE.** Delete+insert silently drops every column you did not list in the insert, breaks foreign keys pointing at the old row (or cascades deletes you did not intend), and burns two writes plus index churn to do one row's work.
  - The one legitimate exception: deleting genuinely ephemeral records for a business reason — e.g. discarding raw uploads or transcripts once they have been processed. That is a deletion, not an update, and it should be obvious from the code which it is.
- Prefer the project's query builder / parameterized API over raw SQL in handlers. Where raw SQL is unavoidable, parameterize it — never interpolate user input into a query string.

## CI enforcement

CI exists (`.github/workflows/verify.yml` — typecheck / lint / test / build plus the docs, plan-home and mirror gates), but the migration checks below are not wired into it yet, so they remain the target state — review must enforce them by hand until they are added. When they are, CI should fail the build, not just warn, on:

- a migration file with no matching journal/manifest entry or with a broken revision chain, per what the toolchain keeps (catches hand-written migrations),
- a migration missing its idempotency guards,
- a schema file modified with no new migration in the same change,
- a diff between the schema file and the migration history (regenerate and compare — a non-empty diff means someone edited one without the other).

Each check is a plain script over the migrations directory. Add them once; they catch the exact failures above before they reach production.
