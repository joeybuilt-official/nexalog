# Infrastructure

How this project runs outside a developer's machine. Read before touching anything deploy-, data-,
or secret-related. Update in the same PR as the change — infra docs that lag the infra are worse
than no docs, because they are trusted.

## Environments

- **Local** — `pnpm dev` on port 3300, pointed at the shared Postgres via `DATABASE_URL` in `.env`
  (tracked example: `.env.example`; the real file is gitignored).
- **Production** — nexalog.com and app.nexalog.com, BOTH served by the same container described
  below (one deployment, one Cloudflare tunnel — the two hostnames are not two apps). Since the
  front-end host split, `nexalog.com` is the FRONT host (the marketing landing page and the login
  page) and `app.nexalog.com` is the APP host (everything under `/app/*`); the rules live in
  `apps/web/lib/hosts/split.ts` and the redirects in `apps/web/middleware.ts`. **The split is off
  unless `NEXALOG_FRONTEND_URL` is set** — with it unset, both hostnames behave exactly as they did
  before the split. This is real user traffic.
  A local dev server pointed at the shared database **is** talking to production data: the `nexalog`
  schema has no separate staging copy, so treat every query you run locally as a production query.
- **Forbidden against prod, in every harness:** `pnpm db:push` (`drizzle-kit push`), any
  `db:migrate` / `db:generate` run from this tree, and any hand-applied migration without human
  approval. See `.agents/rules/database.md` for why (the database is shared and its journal belongs to
  Pushd).

## Deploy pipeline

- Deploys run through the sibling Pushd service, not GitHub Actions. `.pushd.yaml` declares the
  builds; the web image is built from `apps/web/Dockerfile` (multi-stage pnpm monorepo build,
  `node:22-alpine`, pnpm 10.15.1 via corepack, Next.js `output: 'standalone'`).
- **Android release builds are tag-only** (`on: tags: ["v*"]` in `.pushd.yaml`). This is deliberate and
  hard-won: the entry previously enqueued on *every* push, so every branch and PR built a signed
  release APK and emailed ~70 MB to nobody, on a single FIFO worker. On-demand builds from any branch
  still work through the manual trigger (`POST /builds {projectId, repoUrl, branch}`), which bypasses
  `on:` entirely. **Do not add `on:` keys without checking they are supported by the deployed pushd —
  an older pushd ignores the key and the every-push behaviour returns.**
- The `verify` GitHub workflow is a **required** status check on `main`; it is the merge gate
  (typecheck / lint / test / depcruise / build plus the docs, plan-home and mirror gates), not the
  deploy trigger.
- **Rollback:** redeploy the previous image tag through Pushd. There is no in-repo rollback command —
  the image is the artifact, and the branch protection plus the required check are what keep a bad
  image from being built in the first place.

## Hosting & runtime

- The web app runs as a container on the HIVE host, joined to `app-net` (application traffic) and
  `ingress-net` (Cloudflare ingress) as declared in `nexalog-v2-compose.yml`. The runtime user is
  non-root (`nextjs`, uid 1001) and the process binds `0.0.0.0:3300`.
- The container mounts a git-backed brain repo at `/repo` (`BRAIN_REPO=/repo`) — the brain pages are
  files in a git repository, and `git config --system --add safe.directory /repo` is set in the image
  because the mounted repo is owned by a different uid than the runtime user.
- **`ffmpeg` is a runtime dependency**, not just a test one: the media adapter shells out to it to
  normalize audio to opus. `apps/web/Dockerfile` installs `git` and `libc6-compat`; `ffmpeg` must be
  present in the run image or capture transcription silently degrades.
- Logs go through `lib/logger.ts` (`logEvent`, structured JSON lines) and out to the container log;
  the observability backend is Plexo when it is connected. There is no Sentry and no PostHog.

## Data stores

- **Primary database:** a **shared Postgres instance**, not one this project owns. The `nexalog` PG
  schema sits beside sibling apps' schemas; `auth` belongs to Better Auth (shared cross-app SSO).
  `apps/web/drizzle.config.ts` declares `schemaFilter: ["nexalog"]` for exactly this reason.
- **The migration journal in that database belongs to Pushd** (`pushd.drizzle.__drizzle_migrations`),
  and `drizzle/meta/` does not exist in this repo — so drizzle-kit has no snapshot of what applied.
  The chain is hand-numbered (`apps/web/drizzle/*.sql` plus
  `apps/web/lib/db/migrations/0001_capture_lifecycle.sql`) and the numbering has collided before.
- **Authoritative vs. reconstructible:** the `nexalog` schema and the git-backed brain repo are
  authoritative. Derived indexes (FTS, graph projections) and enriched vendor data are reconstructible
  — they are cached onto the record so render never re-fetches, but they can be rebuilt.
- **Migration process:** hand-write the idempotent, `nexalog`-scoped SQL → human approves → apply
  through a parameterized session → land the migration file in the same change → **verify by querying
  the system catalog or selecting the new column and stating what you saw.** "The command printed OK"
  is not verification.

## Secrets & configuration

- Secrets live in the Pushd deploy environment file and are injected as env vars — never inline in
  `nexalog-v2-compose.yml`, never in a commit, never printed into a log line.
- Local development uses `.env` (gitignored); `.env.example` is the tracked template and is the one
  place a new variable must be documented.
- **What must never be committed:** `.env` / `.env.*` (except `.env.example`), `*.pem`, any credential
  in a git remote URL, and any secret in a log line. A tool-specific permission file can refuse `pnpm db:push` and
  the other destructive commands for the agent; that binds the agent only, so the guardrail for every
  other harness is prose plus branch protection.

## Background jobs & scheduled work

- Async work is **Plexo's** — this repo ships no queue, no worker, and no in-app scheduler, and adding
  Inngest or an equivalent is banned. Intelligence calls happen inline behind `IntelligencePort`.
- In-app background work that does exist: the enrichment pipeline (fetch-once, store on record) and
  the offline outbox drain on the client (`lib/offline/`).
- **Idempotency:** the offline outbox and the sync mutation endpoints are the ones to be careful with —
  a captured mutation may be replayed after a reconnect. Anything that writes must tolerate a repeat.
- Failures are logged through `lib/logger.ts` and, where the initiator can act, surfaced to them as a
  typed error. A failure an initiator cannot act on still gets logged, and the change description must
  say it is intentionally silent.

## Monitoring & alerting

- What is monitored today: the container's health and the `verify` check on every PR. Plexo handles
  observability when it is connected.
- **First three things to check when production looks wrong:**
  1. Is `verify` green on `main`? A red required check means the last change did not land cleanly.
  2. Is the surface returning a typed error, or a bare 500? The v1 routes deliberately return `503
     surface_unavailable` — that is a known state, not a new outage (see `docs/agents/key-patterns.md`).
  3. Does `DATABASE_URL` point where you think it does? This app's tables are in the shared instance's
     `nexalog` schema, and a `42P01` usually means a query is reaching for a table that lives in the
     `pushd` database instead.
