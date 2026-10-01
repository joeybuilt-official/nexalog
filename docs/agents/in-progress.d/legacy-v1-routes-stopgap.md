---
id: legacy-v1-routes-stopgap
title: Legacy v1 routes — the real direction after the honest-degradation stopgap
status: open
area: platform
branch: fix/legacy-routes-degrade-honestly
order: 7
risk: operator-confirm
---

The five carried-over v1 surfaces (`/api/sync`, `/api/sync/mutations`, `/api/notes`,
`/api/bookmarks`, `/api/journal`) query the **v1 content model** (34 tables in the shared `pushd`
database's `nexalog` schema) through `{ db }` from `@/lib/db`, which reads `DATABASE_URL`. The
deployment's `DATABASE_URL` points at **`nexalog_v2`**, which holds only the three v2 app-state
tables (`capture_index`, `api_tokens`, `read_state` — `db/migrations/0000_nexalog-v2-bootstrap.sql`).
So every query raises Postgres `42P01` and the routes 500. Observed live from the mobile-sync poll
path in `docker logs nexalog-web`: repeated `relation "nexalog.notes" does not exist` and
`relation "nexalog.workspaces" does not exist` for a real `user_id`.

**The stopgap SHIPPED** (branch `fix/legacy-routes-degrade-honestly`, PR #48, merged 2026-09-26): a missing relation now degrades to a 503 `surface_unavailable` with a typed body
instead of an unhandled 500, and `/api/sync/mutations` no longer reports missing-table failures as
per-op `rejected` (which the shipped Flutter client parks as a terminal conflict — the user's queued
write would have been dropped for good). Mobile is unchanged and safe: `SyncEngine` catches the
transport failure, keeps the last-synced mirror, does not advance its cursor, and retries.

**What is still open is the real direction — deliberately NOT decided in that PR.** The operator
chose "minimal stopgap only" and made the direction a separate decision. The candidates, none
investigated to a recommendation yet:

1. **Repoint these routes at the `pushd` database** (`AUTH_DATABASE_URL`-style, i.e. the db that
   actually carries the `nexalog` schema and the 3769 notes / 4446 capture_sources). Cheapest, but it
   welds the v2 app to the v1 store and reverses the "no content ever lands in `nexalog_v2`" split.
2. **Migrate the v1 tables into `nexalog_v2`** (schema + data). Makes the deployment coherent, but it
   is a prod data migration against a **shared** database — operator-gated, and ~31 of the 34 tables
   have no committed migration today (see `projects-containers-reconcile.md`).
3. **Retire the v1 surfaces** and move mobile onto the v2 content model (the brain git repo via
   `capture_index`). Largest, but the only one that ends the split instead of managing it.

The decision must also settle **data ownership**: the same tables are still read by the v1 app and
written by v1 importers, so whichever direction is picked decides whether v1 keeps writing to a
store v2 also serves.

**Next step:** operator decision on (1)/(2)/(3) before any code. Evidence to hand over is the
container log (`docker logs nexalog-web`, `42P01`) plus `nexalog-v2-compose.yml`'s
`DATABASE_URL`/`AUTH_DATABASE_URL` pair — the honest-degradation PR body records both. Do NOT run
`pnpm db:push`, do not move data, and do not change any `DATABASE_URL` until the direction is picked;
the stopgap means nothing is on fire while it is decided.
