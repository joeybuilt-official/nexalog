# Architecture

Decisions and their reasoning. Not a description of the code — the code describes itself. Record a
decision here when a future reader would otherwise ask "why is it like this?" and be tempted to
change it back.

**This file is the INDEX.** The long-form records live at the repo root, one file per decision:
`adr/NNNN-slug.md`. Add a row here pointing at the new file when an ADR lands — a decision with no row
is invisible to anyone reading the architecture; a row with no file is worse. Never renumber or delete a
superseded ADR; mark it `Superseded by ADR-NNNN` in its own file so the reasoning trail survives.

## System shape

Nexalog is an AI-enhanced personal knowledge management system. Fragments of thought are captured from
several surfaces (web, the Android share receiver, the ingestion bridge), refined by intelligence,
surfaced through search and a knowledge graph, and promoted into action in sibling Joeybuilt apps. The
TypeScript app is a Next.js 16 App Router monorepo member (`apps/web`) beside a pure core
(`packages/core`) and its adapters (`packages/adapters`); a Flutter client under `mobile/` is a second
deployable.

Request flow: a route handler under `app/api/<area>/` authenticates, validates *shape*, and calls a
feature slice or a `packages/core` use case; the slice/use case enforces *invariants* and reaches I/O
only through a declared port; the port's adapter (`packages/adapters`, or an in-app adapter such as
`lib/intelligence/*-adapter.ts`) is the only place a vendor is named. A full layer map with the honest
gap list lives in `.claude/rules/clean-architecture.md` → "This project's layers".

## Boundaries and ownership

- **The shared Postgres owns the data, and this repo does not own its journal.** The `nexalog` schema
  sits beside sibling apps' schemas in one instance; the migration journal in that database belongs to
  Pushd. That is why `db:push`, `db:migrate` and `db:generate` are all banned from this tree, and why a
  schema change is hand-applied, scoped to `nexalog.*`, and human-approved — see
  `.claude/rules/database.md` → "This repository runs against a SHARED database".
- **Auth is not ours either.** Better Auth owns the shared `auth` schema (cross-app SSO); no app table
  goes there.
- **Source of truth for shared types:** there is no single module. Persistence enums live in
  `apps/web/lib/db/schema.ts`, feature types live in their `lib/<feature>/` slice, port contracts live
  with the port (`lib/intelligence/port.ts`), and the pure domain/use-case/port types live in
  `packages/core/src/{domain,application,ports}`.
- **The dependency direction that must not reverse:** `packages/core` imports nothing at all (npm, node
  builtins, or unresolved bare specifiers — machine-checked as `core-is-pure`), and `lib/<feature>/`
  never imports `app/`, `components/`, `middleware.ts`, or another slice's adapters (machine-checked as
  `web-lib-no-ui` / `web-lib-no-direct-db`).

## Data model

- **Core entities:** `notes` (markdown, soft-deletable), `capture_sources` (the raw inbox; URL
  captures/bookmarks are `kind=url`), `bookmark_tags` + `bookmark_tag_assignments`, `workspaces`,
  `journal_entries`, `projects` + `project_items` (reference-based containers, `item_kind='project'`
  for nesting), `take_proposals`, and the brain pages under `notes/<slug>.md`. All in the `nexalog` PG
  schema — never `public`.
- **Normalized rows vs. blob columns:** anything queried, filtered, aggregated, or reported on gets its
  own rows and columns; blob/JSON is for opaque payloads only. Typed objects and query views are the
  deliberate exception — there the *shape* is user-defined, so the properties are stored as data
  precisely because they are not knowable at schema time.
- **Denormalization that exists on purpose:** capture display fields and enrichment metadata are stored
  on the record rather than re-fetched at render time (see `.claude/rules/ai-features.md` → "Enrichment
  from third-party sources"). Per-field provenance (source + fetch timestamp) rides along so a stale
  value can be traced and re-fetched selectively.
- **Every page a writer creates carries a TOP-LEVEL `date`** — the content's own creation instant,
  never the run time. That is the only date key the brain's index reads; a date under
  `claude_created_at` / `anytype_created_at` / `nexalog.captured_at` alone is provenance, invisible to
  the index, and the page files under its import time.

## Cross-cutting decisions

- **Auth:** Better Auth in the shared `auth` schema, with passkeys/WebAuthn as the identity root
  (`adr/0016-passkey-webauthn-identity-root.md`) and keypair/recovery fallbacks alongside it.
- **Error shape:** one typed error shape across the API with a stable machine-readable code; failure
  classes map to status codes in the adapter layer, never in a use case. A surface that cannot serve —
  e.g. a v1 route whose tables live in another database — degrades to a `503 surface_unavailable`
  rather than 500-ing.
- **Versioning:** `app/api/**` is the published contract. DTOs are mapped at the boundary; no domain
  entity is serialized directly to the wire.
- **Intelligence:** always through `IntelligencePort` — never an AI SDK import. Two adapters: an
  embedded one (raw `fetch`, no SDK) as the standalone baseline, and a Plexo adapter that supersedes it
  when Plexo is present and authorized (`adr/0014`, `adr/0015`, `adr/0017`).
- **Deliberately not in scope:** a fleet-wide erasure primitive (identity deactivation is Nexalog-only),
  and an in-app observability/async vendor — Plexo covers both, and Sentry / PostHog / Inngest /
  LangChain are banned.

---

## ADR index

| ADR | Title |
|---|---|
| 0001 | Audit methodology |
| 0002 | Data export / portability format |
| 0003 | Embeddings & clustering ownership |
| 0004 | Knowledge structure as typed objects |
| 0005 | Graph schema — node merge & re-ingest |
| 0006 | PEX contract extensions |
| 0007 | Video transcription, phase 1 (Supadata) |
| 0008 | Ideas taxonomy |
| 0009 | Export format |
| 0010 | Offline strategy |
| 0011 | Resurfacing design |
| 0012 | Query language |
| 0013 | Typed objects direction |
| 0014 | Intelligence port & adapters |
| 0015 | Adapter mesh protocol |
| 0016 | Passkey/WebAuthn identity root |
| 0017 | Retire Plexo-exclusive intelligence |
| 0018 | Projects as reference-based containers |
| 0019 | Exit door — data export |
| 0020 | Mobile v2 parity gate |
| 0021 | Deletion and purge semantics |
| 0022 | Take-proposal adjudication |
| 0023 | Chat surface — hosted here, turn hosted there |
| 0023 | Plan-impact reconciliation — **number collision with the row above; the next ADR takes the next free number, and neither existing file is renumbered** |

Status lives in each file. The long-form reasoning is in the files, not here — open the one the change
touches.

## ADR template

Copy this block into a new `adr/NNNN-slug.md` and add its row above. Number sequentially from the
highest existing number; never renumber or delete a superseded ADR.

```markdown
# ADR-0001 — <short decision title>

- **Date:** YYYY-MM-DD
- **Status:** Proposed | Accepted | Superseded by ADR-NNNN | Reversed
- **Context:** the forces in play — constraints, scale, deadlines, what we knew at the time.
- **Options considered:** each one, with its honest tradeoffs. Include the option we rejected.
- **Decision:** what we chose.
- **Consequences:** what this makes easy, what it makes hard, and what would force a revisit.
```
