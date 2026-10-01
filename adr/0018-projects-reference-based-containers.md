# ADR-0018 — Projects: reference-based containers (V2 design)

- **Status**: **Accepted — operator approval 2026-09-26 (Phase 2 hard stop cleared).**
  Phase 3 may start immediately on the pure `packages/core` slice (domain,
  contracts, use cases, port declarations); the **migration/adapter/route slice
  is released for the `CREATE` question** — the `nexalog_v2` provenance
  inspection landed 2026-09-26 (question 5, below): that database holds only the
  3 v2 app-state tables and no v1 content, so Projects DDL there is a `CREATE`,
  not an `ALTER`. The **data** half — that the content Projects references still
  lives in `pushd`, and what to do about that — is folded into the legacy-v1
  direction (queue row 5) and stays operator-gated.
- **Approved**: 2026-09-26 (operator; dispositions per §Operator decisions)
- **Date**: 2026-09-25
- **Phase**: Projects Phase 2 (design + ADR)
- **Owner**: operator (design drafted by agent; the approval is the operator's)
- **Supersedes**: `docs/agents/platform/projects/adr/0001-nexalog-projects.md`
  (the V1 design). ADR-0001's D1–D5 were approved and built against the **V1**
  app; that build is not in this repo (§Reconciliation). This ADR re-decides the
  design against V2's architecture rather than porting the V1 one.
- **Related**: ADR-0014 (intelligence port — V2's replacement for the
  `lib/plexo.ts` client ADR-0001's D3 was built on), ADR-0017 (retires the
  Plexo-exclusive rule), ADR-0009 (export format — this design is what keeps
  Projects inside the exit door)
- **Companion**: `docs/agents/platform/projects/design.md` (the full design,
  including the reconciliation evidence and phasing)

## Context

A **Project** is a reference-based container: it groups existing knowledge units
without owning, moving, or copying them. One unit can belong to many projects;
removing it from a project is not a delete; deleting a project never touches a
member.

Two facts make this a fresh decision rather than a re-approval.

**1. The V1 build is not in this repo.** `platform/projects/plan.md` carries
"Status @ 2026-06-12 — SHIPPED + LIVE" and that claim is **true of V1 and false
of this tree**. Every Projects surface was deleted in the §1.7 commit `1866c2c`
(all six routes under `app/api/projects/**` and all four pages under
`app/(app)/app/projects/**`), and `lib/plexo.ts` — the client D3's brainstorm
contract was built on — went with it. What remains is a migration file, a pure
domain module, and schema declarations. See §Reconciliation.

**2. V2 inverted the rules Projects were designed under.** V1 was a
Postgres-first app. V2's premise is that the **brain repo (markdown + git) is the
system of record** and Postgres is **app state only** — `nexalog_v2`'s own schema
header reads "no page text, no inbox bodies, no content ever lands here", and
`capture_index` is the reference implementation of the pattern: *truth in git, a
derived and rebuildable index in Postgres* (`ReindexRepo`: "TRUNCATE-and-rebuild
… orphans cannot survive a fresh index"). ADR-0001's D2 — a `project_items`
junction keyed on DB row ids — is a Postgres-first design and would make
`nexalog_v2` a second source of truth for a knowledge relationship, which is
precisely what the V2 rewrite exists to prevent.

## Decision

### D1 — A Project **is** a brain page; membership is a repository reference

A project is `projects/<slug>.md` with `type: project` and a frontmatter
`members:` list of references. The page **body is the living document**. There is
no `living_doc` column: project identity, lifecycle and membership live in git,
beside every other knowledge unit.

```
---
type: project
title: "Knowledge Garden"
nexalog:
  schema: 1
  lifecycle: active          # draft | active | archived
  members:
    - page:concepts/litellm-gateway
    - page:people/example-person
    - capture:01J8ZQ4M7K2V9YB3XDRT6WFPNC
---
## Living document

The project page body. Markdown, in git, editable, diffable, portable.
```

`members:` is a **flat list of `"<kind>:<ref>"` strings** — `page:<slug>` for any
brain page, `capture:<ulid>` for an inbox file. Not an object-shaped list, and
not negotiable: `packages/core/src/contracts/frontmatter.ts` → `yamlBlock()`
coerces array elements with `String(item)` and supports one nesting level, so an
array of objects serializes to the literal `"[object Object]"` with no error
anywhere. A flat string list is what that codec can round-trip honestly, and
`local-graph.ts` already reads this shape (`LINK_LIST_FIELDS` walks
`concepts:`/`related:` lists for the same reason).

Membership references a **brain-repo address**, never a DB row id. `notes`,
`captureSources` and `journalEntries` are V1-era tables whose V2 role is
unresolved (§Reconciliation item 5); anchoring a new subsystem to them would
deepen a dependency the rewrite is retiring, and would put members outside the
export door.

### D2 — A **derived** index in `nexalog_v2` makes membership queryable

Frontmatter alone cannot answer "which projects is this page in?" without walking
the repo. So the same reconciliation `capture_index` uses applies here: two
**derived, droppable, rebuildable** tables in the `nexalog` PG schema — never
`public` (repo hard rule; `pgSchema("nexalog")`, `drizzle.config.ts`
`schemaFilter: ["nexalog"]`).

```
nexalog.project_index      -- one row per projects/<slug>.md (identity + lifecycle)
  project_slug  text primary key      -- 'projects/knowledge-garden'
  name          text not null
  lifecycle     text not null check (lifecycle in ('draft','active','archived'))
  member_count  integer not null default 0
  reindexed_at  timestamptz not null default now()

nexalog.project_members    -- one row per membership
  project_slug  text not null
  member_kind   text not null check (member_kind in ('page','capture'))
  member_ref    text not null         -- slug, or ULID
  added_at      timestamptz
  unique (project_slug, member_kind, member_ref)
  index (project_slug);  index (member_kind, member_ref)
```

Two tables, not one: a project with **zero members** must still list, so identity
cannot be a byproduct of a membership row. The `*_index` name keeps "derived,
never hand-edit, rebuild it" legible. `member_count` is denormalised
deliberately for list rendering and recomputed by every rebuild.

**No foreign key on `member_ref`** — the target is a git path or a ULID, not a
row, so the database cannot constrain it. That is the honest price of
reference-based membership, and **the rebuild is the integrity mechanism**: a
member whose target no longer resolves simply does not survive a reindex. The
surfaces must render that as an "unresolved member" affordance, not a broken
page.

### D3 — Intelligence stays optional and behind a port

ADR-0001's D3 (`chatMessage` `channelRef = projectId` over `lib/plexo.ts`) is
void: that client was deleted, and ADR-0017 retired "intelligence routes
exclusively through Plexo". The brainstorm thread is **out of scope for this
ADR**. If a project-brainstorm surface is wanted later it is a
`ProjectIntelligencePort` in `packages/core`, implemented by an adapter behind
ADR-0014's tiered resolution, with the project digest passed as plain data.
Nothing in this design may make a project unreadable when no provider is
configured.

### D4 — Lifecycle `draft → active → archived`, enforced in the domain

Unchanged from ADR-0001's D4, which remains right: enum stored as `text` with a
`CHECK`, transitions in a **pure** domain function — not free text, not inline in
a route. Default `active`.

### D5 — Deletion is `archived` first; the rebuild owns reconciliation

Archive is the default and the reversible state. Hard delete removes the page
(`git rm`); its rows vanish on the next rebuild, because orphans cannot survive
one. Deleting a project **never cascades to a member** — membership is a
reference, and the member's lifecycle is its own. An item leaving a project is an
edit to `members:`, never a delete of the item.

## Layering (V2 Clean Architecture — the Dependency Rule)

Business rules live in `packages/core` (pure, zero runtime deps); I/O sits behind
ports; `apps/web` wires at the composition root. ADR-0001 placed the domain in
`apps/web/lib/projects/`, which V2's depcruise gate treats as an un-ported web
slice — the domain moves inward.

| Layer | Path |
| --- | --- |
| Domain | `packages/core/src/domain/project.ts` — `LifecycleState`, transition table, `canTransition`/`assertTransition`, `MemberRef` parse/validate |
| Contracts | `packages/core/src/contracts/project.ts` — `parseProject`/`serializeProject` (hand-rolled; no zod — zero-dep wall), round-trip tested |
| Use cases | `packages/core/src/application/{create-project,read-project,set-project-members,set-project-lifecycle,reindex-projects}.ts` |
| Ports | `AppStateRepo` (extended) for the derived index; the existing `BrainStore.getPage`/`savePage` for the page |
| Adapters | `packages/adapters/src/db-drizzle/{schema.ts,drizzle-app-state-repo.ts}`; page I/O reuses `FsGitBrainStore` |
| Wiring | `apps/web/composition.ts` — the only place adapters meet use cases |
| Surfaces | `apps/web/app/(app)/app/projects/{page.tsx,[slug]/}`; `apps/web/app/api/projects/…` |
| Nav | `apps/web/components/app-sidebar.tsx` |

Boundary validation is zod at the route (`strict()` — a misspelled field is a
400, not a silently ignored intent; the `/api/captures/[id]/review` route is the
pattern). Domain invariants are enforced in `core` regardless of the route,
because every other entrypoint skips it. New ports ship with a test double, and
their use cases must be testable with fakes only — no DB, no HTTP.

## Consequences

- **Pro**: one source of truth. Projects are portable for free — ADR-0009's
  export door carries them because they are already markdown in git.
- **Pro**: orphaning, deletion and reconciliation reduce to the `capture_index`
  pattern already proven here instead of a new one.
- **Pro**: no cascade, no ownership, no copy — the reference-based property the
  initiative exists for actually holds, including across deletes.
- **Pro**: the domain lives in `core`, where V2's architecture and its gates put
  it, and its tests need no infrastructure.
- **Con**: **every membership or living-doc edit is a git commit.** Accepted
  deliberately: it is the price of the brain being the system of record, and it
  is the price capture already pays. Mitigation: membership writes take a **set**
  of refs (one commit per operator action, not per member) through the existing
  `FsGitBrainStore` single-writer queue, with optimistic UI. If it proves too
  slow at real scale that is a finding — not a reason to move truth into
  Postgres.
- **Con**: frontmatter cannot enforce referential integrity; a stale ref is
  detected at rebuild and must degrade to an "unresolved" affordance.
- **Con**: a project's membership is not transactionally consistent with the
  member items themselves — a reindex window exists. Acceptable for a single
  operator; the rebuild is idempotent and the window is bounded.
- **Con (blocking, must be resolved first)**: `nexalog_v2` has **no committed
  migration for any table in `apps/web/lib/db/schema.ts`** — see
  §Reconciliation item 5. Phase 3 cannot generate a Projects migration until
  this is settled.

## Alternatives considered

- **V1's D2 verbatim — a `projects` table + `project_items` junction keyed on DB
  row ids.** Rejected. It makes Postgres canonical for a knowledge relationship,
  contradicting V2's premise and `nexalog_v2`'s own stated contract; it anchors
  membership to the V1 tables the rewrite is retiring; and it puts projects
  outside the git-based export door, so the one relationship a user builds by
  hand would be the one the exit door loses. Its one real advantage — no git
  commit per toggle — is recorded above as this design's accepted cost.
- **Brain page with no DB index** (walk `projects/` per read, as
  `local-graph.ts` does). Rejected as the *only* mechanism: it is O(repo) per
  request, cannot answer reverse membership without reading every project page,
  and puts file IO on the read path of a list view. Kept as the **degraded
  rung** when the index is unavailable — the shape `/api/graph` already uses
  (`source: gbrain|local|none`).
- **Membership as tags** (reuse the tag machinery). Rejected. Tags are many,
  cheap, unordered and uncontrolled-vocabulary; a project is an identity with a
  body, a lifecycle and deliberate membership. Collapsing them makes "archive
  this project" and "add a label" the same operation.
- **Membership stored on the member** (`projects: [a, b]` in each note's
  frontmatter). Rejected: it inverts the ownership the container exists to
  avoid, requires writing to every member file to build a project, and makes a
  project's member list a full-repo scan.
- **A `projects` DB table as the system of record with a repo mirror.**
  Rejected outright: two sources of truth that must be kept in agreement is the
  exact failure mode V2 was built to end.

## Reconciliation — what "SHIPPED + LIVE" actually refers to

Established from the repo, on `origin/main` @ `c20238a`:

- **True of V1.** `plan.md` describes the app at `/srv/nexalog-v1`
  (line 5: "Artifacts root: `/srv/nexalog-v1/…`") and claims commits
  `<sha>` + `<sha>` "on local main (NOT pushed to remote)". Both SHAs do
  exist in this repo's object history — they arrived with the Phase 1
  route-migration merge — so the V1 build is real history.
- **False of V2.** Every Projects surface was deleted by `1866c2c`
  (`refactor(phase-1): … §1.7 deletions complete`), which removed
  `app/api/projects/{route.ts,[id]/route.ts,[id]/items/route.ts,[id]/brainstorm/route.ts}`
  plus the candidates pair, and `app/(app)/app/projects/{page.tsx,projects-client.tsx,[id]/*}`,
  along with `lib/plexo.ts`. `docs/agents/platform/projects/plan.md` §Phase 3–5
  describe files (`lib/projects/`, `app/api/projects/*`) that do not exist here.
- **What survives** is a mix of dead and live-linked fragments, not a shipped
  feature:
  - `apps/web/drizzle/0012_projects.sql` + `0015_project_candidates.sql` — V1
    migration SQL, never applied to `nexalog_v2` (§item 5).
  - `apps/web/lib/projects/{domain.ts,store.ts}` — a pure domain + an I/O store
    with **no importer** in `apps/`.
  - `schema.projects` / `schema.projectItems` / `schema.projectCandidates`
    declarations. `projectCandidates` has **zero** references anywhere.
    `schema.projects` is **not** dead: it is wired into the **live** offline-sync
    routes (`/api/sync` `SYNC_TABLES`, `/api/sync/mutations` `ENTITY_TABLES`) —
    which is a stronger reason to settle its fate deliberately, not a weaker one.
  - `projects-domain.test.ts` (lifecycle transitions, 7 cases) — still passing,
    still testing a module nothing calls.
- **Verdict**: Projects is **NOT shipped in this repo**, and no part of the V1
  status line transfers to V2. The roadmap's "Now" was the *only* honest
  placement of the two, and the plan doc's heading is the error.

## Operator decisions — dispositions (approved 2026-09-26)

Approved as written by the operator on 2026-09-26. The six questions are kept
below with their dispositions, so a later reader can see exactly what was
decided — and what was not.

1. **Approve or reject this design.** — **Approved** (2026-09-26). Phase 2's ⚠
   hard stop is cleared for the whole design except the hold in question 5.
2. **Member kinds.** — **The ADR's default is taken:** the target set is "any
   brain page or capture, by reference", accepting that a V1-era
   `notes`/`journalEntries` row that never committed to the brain is **not**
   groupable today (the V1 plan's "notes + bookmarks + journal" intent maps
   onto this once those rows exist as pages/captures; the mapping is a gap
   today, not a claim).
3. **Living doc = the project page body.** — **The ADR's default is taken:**
   markdown in git, one commit per save, through the existing
   `FsGitBrainStore` single-writer queue. No DB-side editing with a repo sync.
4. **Disposition of the V1 remnants.** — **The ADR's default is taken:** keep
   them until Phase 5, where retirement stays operator-gated. The ADR's own
   warning stands: `schema.projects` is referenced by the **live** `/api/sync`
   and `/api/sync/mutations` table maps, so removing it is a code change, never
   a file delete.
5. **`nexalog_v2` migration provenance** (§item 5, above). — **ANSWERED
   2026-09-26 by the read-only production inspection this item called for.** The
   inspection is conclusive and both halves of the question came back the same
   way:

   - **`nexalog_v2` holds only the 3 v2 app-state tables** — `api_tokens`,
     `capture_index`, `read_state` (1 row each), all in schema `nexalog`. There
     are **no v1 content tables anywhere in that database**: `SELECT count(*)
     FROM nexalog.workspaces` against `nexalog_v2` returns
     `ERROR: relation "nexalog.workspaces" does not exist`, while the same query
     against `pushd` succeeds. So the ~31 "uncommitted tables" are **not missing
     DDL for tables that exist** — they are tables that were **never created in
     this database at all**.
   - **The v1 content model lives entirely in the shared `pushd` database's
     `nexalog` schema** — all 34 tables, with substantial live data (3,769
     notes, 4,446 capture_sources). `nexalog_v2` is not a partially-migrated
     copy of it; the two are disjoint.

   **Consequence for this ADR — the hold is LIFTED for the `CREATE` question and
   REPLACED by a narrower one.** The `CREATE`-vs-`ALTER` ambiguity is settled:
   there is nothing to `ALTER`, so Projects DDL against `nexalog_v2` is a
   `CREATE`, and generating that migration is no longer blocked by provenance.
   What is **not** settled by the inspection, and stays operator-gated, is the
   **data** question: Projects' member rows and any V1-era
   `notes`/`journalEntries` content live in `pushd`, not in the deployment's
   database, so a Projects migration can create **empty** tables in `nexalog_v2`
   while the content it is meant to reference stays in the other database. That
   is the same repoint-vs-migrate-vs-retire decision tracked on the legacy-v1
   routes (queue row 5) and must be answered **with** it, not separately —
   creating the DDL now is safe and reversible; creating it and *assuming it is
   populated* is not.
6. **Mobile parity.** — **The ADR's default is taken:** web-first in Phase 5
   with file parity after; the ship gate is not held for mobile.
