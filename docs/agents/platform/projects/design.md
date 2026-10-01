# Projects — reference-based containers · Phase 2 design

**Status:** design **APPROVED 2026-09-26** — ADR-0018 is Accepted (Phase 2 hard stop cleared).
**Amended 2026-09-27:** sub-projects (project → sub-project, two levels) are in scope, per ADR-0001
**Amendment A1** — ownership is introduced at the project→project layer and explicitly does not extend
to items (§3.1 note below). Phase 3 may start on the pure `packages/core` slice; the
migration/adapter/route slice is **held**
on the `nexalog_v2` provenance answer (question 5 / §5), which a read-only production inspection is
closing. **Nothing here shipped and nothing deployed** — no `packages/` or `apps/` source is touched
by this document; Phase 5 (ship, deploy, prod migration) stays operator-gated and is out of scope.
Question dispositions live in `adr/0018-projects-reference-based-containers.md` §Operator decisions.
**Date:** 2026-09-25 · **Base:** `origin/main` @ `c20238a`
**Decision record:** [`adr/0018-projects-reference-based-containers.md`](../../../../adr/0018-projects-reference-based-containers.md)

---

## 1. What this is

A **Project** groups existing knowledge units **by reference**. It does not own,
move, or copy them. The consequences that make it worth building:

- **An item can belong to many projects** — a note about Litellm can sit in
  "Homelab" and "PKM expansion" without a copy existing twice.
- **No duplication** — there is exactly one Litellm note, and every project that
  references it reads the same bytes.
- **Deletion semantics stay clean** — deleting a project does not delete anything
  a user wrote. Removing an item from a project is an edit, not a delete.

The costs are equally real and are stated up front rather than discovered later:

- **Joins / indirection** — "what is in this project" is a reference lookup, not
  a column read.
- **Orphan handling** — nothing in the database can prevent a reference pointing
  at something that no longer exists, so the system must reconcile and the UI
  must degrade honestly.
- **Query complexity** — reverse membership ("which projects is this page in?")
  is not expressible in frontmatter without a full-repo walk, which is why §3
  keeps a derived index.

## 2. Reconciliation — was it shipped? (the row's blocking question)

**Verdict: not shipped in this repo. The plan doc's heading is wrong, not the
roadmap.**

| Claim | Where | Verdict |
|---|---|---|
| "SHIPPED + LIVE @ 2026-06-12", all phases done | `platform/projects/plan.md` §Status | **True of V1, false of V2** |
| "Interactive mode, Phase 2 ADR is a hard stop" | `roadmap.md` → Now | **Correct** |
| "reconcile before working it" | `in-progress.md` row 3 | Correct, and now done |

Evidence, all from `origin/main` @ `c20238a`:

1. **The plan describes a different codebase.** `plan.md` line 5 names its
   artifacts root as `/srv/nexalog-v1` and records commits `<sha>` +
   `<sha>` "on local main (NOT pushed to remote)". Those SHAs are reachable in
   this repo (they arrived with the Phase 1 route-migration merge), so the V1
   build genuinely happened — against the V1 app.
2. **V2 deleted every Projects surface.** Commit `1866c2c`
   (`refactor(phase-1): merged app compiles — §1.7 deletions complete`) removed:
   `app/api/projects/{route.ts,[id]/route.ts,[id]/items/route.ts,[id]/brainstorm/route.ts}`,
   `app/api/projects/candidates/{route.ts,[id]/route.ts}`,
   `app/(app)/app/projects/{page.tsx,projects-client.tsx,[id]/page.tsx,[id]/project-detail-client.tsx}`,
   and `lib/plexo.ts` — the client ADR-0001's D3 was built on. `apps/web/app/` has
   no `projects` directory today.
3. **What survives is remnants, and only one of them is wired to anything:**

| Remnant | State |
|---|---|
| `apps/web/drizzle/0012_projects.sql`, `0015_project_candidates.sql` | V1 SQL, never applied to `nexalog_v2` (§5) |
| `apps/web/lib/projects/domain.ts` | Pure lifecycle + port; **no importer** |
| `apps/web/lib/projects/store.ts` | `filterOwnedRefs` / `hydrateGroupedUnits`; **no importer** |
| `apps/web/lib/__tests__/projects-domain.test.ts` | 7 green tests for a module nothing calls |
| `schema.projects` | **LIVE-LINKED** — referenced by `/api/sync` and `/api/sync/mutations` |
| `schema.projectItems` | Only referenced by `lib/projects/store.ts` (dead) |
| `schema.projectCandidates` | **Zero references anywhere** |

4. **No runtime evidence of a live Projects feature in V2.** No route, no page, no
   sidebar entry; `app-sidebar.tsx` carries a comment that §1.7 "deleted the
   queue/chat/ideas/**projects**/watch/reading/reference/import/web-history/
   objects/dashboard routes" and that the list is kept in sync with reality.

The one thing a "was this ever shipped?" reading must not miss: `schema.projects`
is **not** dead code. It is in the live offline-sync surface's table map, so
whatever is decided about the V1 remnants is a **code change to a shipping
route**, not a file deletion. That is recorded as an operator question (§9).

**Reconciled as part of this commit** (same commit, per the row's own next step):
`roadmap.md` now records the truth with the evidence; `in-progress.md` row 3 and
its fragment are updated to the post-reconciliation state. The fragment stays
alive — Phase 2 is a draft, not a ship, and a fragment dies with its merge.

> **Build note (discovery, written at the moment of finding).** The V1 `plan.md`
> §Phase 3–5 and `checklist.md` describe files and a build chain that this repo
> does not contain (`lib/projects/store.ts` is present but orphaned; the
> `lib/plexo.ts` port impl and all routes are gone; the V1 3,000-line
> `lib/db/schema.ts` was carried into the V2 tree wholesale). A future reader
> following those checklists literally will "complete" already-deleted work.

## 3. The data model

### 3.1 Why reference-based rather than hierarchical or owning

> **Amended 2026-09-27 — see A1.9 in `adr/0001-nexalog-projects.md`.** Projects may now have one
> parent (`parent_id`): **ownership is introduced at the project→project layer, on purpose, and
> explicitly does not extend to items.** Everything below still holds *for items* — notes, bookmarks
> and journal entries stay reference-based, one unit still lives in many projects, and no cascade ever
> runs from a project to an item. The rule that keeps the two apart: *ownership stops at the project
> layer; a sub-project is not a container of its parent's items.* Read the paragraph below as the
> item-layer rule it is, not as a claim about projects in general.

A hierarchical (folder) model makes the container the owner: an item has one
parent, moving it is a mutation with a cascade, and "delete the project" becomes
ambiguous — does it delete my notes? The reference model inverts all three. The
item keeps its own identity and lifecycle; the project holds a list of addresses.
Multi-membership is free rather than a special case; membership changes are
additive edits with nothing to cascade; and deleting the container cannot destroy
content, because it never held any.

The cost is that the container's contents are computed, not stored — hence the
index (§3.3) and the degraded read path (§3.5).

### 3.2 Truth: the project page in the brain repo

A project is `projects/<slug>.md`, `type: project`, body = the living document,
`members:` in frontmatter (flat `"<kind>:<ref>"` strings — see ADR-0018 §D1 for
why the shape is flat: `core`'s `yamlBlock()` coerces array elements with
`String(item)` and supports one nesting level, so an object-shaped list would
serialize to `"[object Object]"` silently). Under **ADR-0001 Amendment A1**
(2026-09-27) a sub-project adds one scalar there — `parent: projects/<parent-slug>`
— and nothing else; `nexalog.project_index` gains a nullable `parent_slug`. That is
the same relationship as A1.6's `parent_id`, carried in the page model instead of the
table. Two levels maximum, enforced by the same A1.2 guard in either placement.

This placement is what makes the whole design cohere with V2: the brain repo is
already the system of record, `PAGE_TYPES` in
`packages/core/src/domain/page-type.ts` **already includes `project`**, the graph
surfaces already filter on a `projects` group, and `local-graph.ts` already walks
the typed dirs. Projects becomes a first-class citizen of the existing model
instead of a parallel universe beside it.

### 3.3 The derived index

`nexalog.project_index` + `nexalog.project_members`, both in the **`nexalog` PG
schema** (never `public`) — full DDL in ADR-0018 §D2. They are a **cache**, in the
same sense `capture_index` is: droppable and rebuildable from the repo, rebuilt by
a `ReindexProjects` use case shaped exactly like the existing `ReindexRepo`
(`clear` → `list projects from the repo` → `upsert batch`), with
`pg_advisory_xact_lock` around the rebuild so two concurrent rebuilders serialize.

`ReindexProjects` **extends the existing rebuild**, it does not add a second
mechanism: `ReindexRepo` already reconciles `capture_index`, so project
reconciliation hangs off the same pass and the same trigger. One reconciler, not
two.

Why an index at all, rather than walking `projects/` per read:

| | Walk the repo per read | Derived index |
|---|---|---|
| List view | O(all project files) per request | One indexed `SELECT` |
| Reverse membership | Impossible without reading every project | One indexed lookup |
| Read path | File IO in the request | SQL |
| Freshness | Always current | Window until rebuild |
| Failure mode | Fails with the filesystem | Degrades to the walk |

The right answer is **both**, in that order of preference — index first, walk as
the degraded rung, exactly the ladder `/api/graph` already implements
(`source: gbrain|local|none`).

### 3.4 Integrity, orphans, and what the DB cannot do

There is **no foreign key on `member_ref`** — it names a git path or a ULID, not
a row. The database therefore cannot stop a dangling reference, and this design
does not pretend otherwise. Three concrete mechanisms replace it:

1. **Validated writes.** Every ref is resolved and authorized before it is
   written: the target page must exist in the repo (or the capture must exist in
   the index) and belong to the caller. This is the V1 design's batched-ownership
   guard, kept — but anchored on repository addresses. Refs that do not resolve
   are rejected at the boundary with a 400 naming the offending ref, never
   silently dropped.
2. **Reconciling rebuild.** Orphans cannot survive a rebuild, because the index
   is dropped and re-derived. Stale rows have a bounded lifetime, not an
   unbounded one.
3. **Honest degradation.** Between rebuilds a ref can dangle; the read path marks
   unresolvable members as **unresolved** in the payload and the UI shows them as
   such. A project never silently loses a member and never renders a dead link as
   if it were live.

### 3.5 Deletion & lifecycle

| Event | What happens | What does **not** happen |
|---|---|---|
| Archive a project | `lifecycle: archived` in frontmatter; index rebuilt | Members untouched; nothing is hidden from the member's own surfaces |
| Archive a **parent** project | `lifecycle: archived` on the parent only | **No cascade to sub-projects** — they keep their own lifecycle; the UI badges + offers an explicit bulk archive (A1.4). An archived parent is still rendered for any child that is rendered, so a child never disappears from the list. |
| Un-archive | `archived → active` | — |
| Delete a project (hard) | `git rm projects/<slug>.md`; rows disappear at rebuild | **No cascade to members** — they are references, not children; and under A1, no cascade to **sub-projects** either — a child's parent reference simply stops resolving and is promoted to root |
| Remove an item from a project | Edit `members:` | The item is not deleted, modified, or moved |
| Delete an item that a project references | Item's own deletion path (unchanged) | The project page is untouched; the ref becomes unresolved and is flagged |

Soft vs hard for the project itself: `archived` **is** the soft state and it
already exists in the lifecycle, so a separate `deleted_at` on a page would
duplicate it. A hard delete is `git rm`, which is recoverable through git history
— the same recoverability every other page edit already has. That is why the
design does not add a `deletedAt` column to the index tables.

Referential integrity, restated plainly: **enforced on write, reconciled on
rebuild, surfaced when broken.** Not enforced by the database, because the
database does not own the targets.

## 4. Schema placement & migration mechanics

- **All tables live in the `nexalog` PG schema, never `public`.** Non-negotiable
  repo rule (`.agents/rules/database.md`, `AGENTS.md`). `pgSchema("nexalog")` +
  `schemaFilter: ["nexalog"]` is already how both schema files declare it.
- **Migrations are forward-only, generated, reviewed, applied.** The chain is
  `pnpm db:generate` (`drizzle-kit generate`) → **review the generated SQL
  against the existing chain** → `pnpm db:migrate`. Idempotency guards
  (`IF NOT EXISTS` / `IF EXISTS`) are required because a migration may be re-run
  against a partially-migrated database.
- **`pnpm db:push` is BANNED** — it diffs against the live database and can drop
  columns, and this is the *shared* Postgres where the `nexalog` schema sits
  beside other apps' schemas. It is denied in `.agents/policy.md`, and the
  ban extends to any reset/force/accept-data-loss flag.
- **New tables ship with a migration in the same change.** A schema edit with no
  migration file is an incomplete change.
- **Verify by querying `information_schema`**, not by trusting the CLI's success
  output — because there is no `drizzle/meta/`, `db:migrate` may not know a
  legacy hand-numbered file applied, and a migrator can report success for a file
  it skipped.
- **The next free number must be re-checked at implementation time.** The chain
  has collided before (two `0008_*.sql` files exist). Phase 2 writes no
  migration, so this design names none.

**Blocking unknown before any of this is possible** — §5.

## 5. ⚠ Blocking unknown — `nexalog_v2` migration provenance

`apps/web/lib/db/schema.ts` declares **34 tables** in the `nexalog` PG schema.
The only committed DDL for `nexalog_v2` is `db/migrations/0000_nexalog-v2-bootstrap.sql`,
which creates **three**: `capture_index`, `api_tokens`, `read_state`. Nothing in
the repo creates `notes`, `workspaces`, `journal_entries`, `capture_sources`,
`projects`, or the other ~28 V1-era tables in `nexalog_v2`.

This is not a Projects problem, but it is Projects' blocker: Phase 5 cannot know
whether it is issuing a `CREATE` (fresh) or an `ALTER` (existing) until someone
confirms what `nexalog_v2` actually holds, and `db:generate` cannot be trusted
on a schema it has no journal for. Per the database rules, verification is by
querying the database — which is an operator action, and is why this is question
5 in ADR-0018's operator list rather than something this document resolves.

Same class of finding, recorded because it is the row's theme: the V1
`lib/db/schema.ts` (≈34 tables, ~3,000 lines) was **carried wholesale into the V2
tree** during the route migration. Only the three bootstrap tables have a V2
provenance. Whether the rest are provisioned, dormant, or intended to be dropped
is exactly the kind of claim that needs evidence rather than assumption.

## 6. Layering

Full path table in ADR-0018 §Layering. The shape:

```
packages/core/src/domain/project.ts         ← rules: lifecycle, MemberRef    (pure)
packages/core/src/contracts/project.ts      ← page encode/decode             (pure)
packages/core/src/application/*.ts          ← use cases, over ports
packages/core/src/ports/index.ts            ← AppStateRepo extension (port)
packages/adapters/src/db-drizzle/*          ← the SQL                       (adapter)
apps/web/composition.ts                     ← the only wiring point
apps/web/app/api/projects/**                ← routes: validate → delegate → map
apps/web/app/(app)/app/projects/**          ← pages: render, no rules
```

Why the domain moves into `packages/core` rather than staying in
`apps/web/lib/projects/` (where V1 put it): `packages/core` is pure TypeScript
with **zero runtime deps** — no fs, no fetch, no db, no zod — and `core-is-pure`
is a **blocking** depcruise rule. Lifecycle transitions and ref parsing are
exactly the kind of rule that belongs there, and putting them there means they are
testable with no infrastructure at all. `lib/projects/store.ts` as it exists
today imports `@/lib/db` directly, which is a baselined `warn`
(`web-lib-no-direct-db`) — moving storage behind a port is how that ratchet item
gets retired instead of extended.

Deliberate non-ports: `MemberRef` parsing and the transition table are **pure
functions with no second implementation**, so per `clean-architecture.md`'s
pragmatism guardrails they get no interface. The one port that does earn its
place is the repository port (`AppStateRepo` extension) — it crosses an I/O
boundary and needs a test double.

## 7. Surfaces

**API** (`app/api/projects/**`), following the conventions the repo already
enforces:

| Method + path | Purpose |
|---|---|
| `GET /api/projects` | List — `lifecycle` filter, paginated, **returned as a tree** (roots + their children; A1.7). A `flat=1` opt-out may be carried for clients that want rows. |
| `POST /api/projects` | Create — `{name, description?, parentId?}`, zod `strict()` (A1.6; the guard of A1.2 runs on any `parentId`). |
| `GET /api/projects/[slug]` | Detail + hydrated members |
| `PATCH /api/projects/[slug]` | Living doc and/or lifecycle, **and/or `parentId`** (set / change / clear — the A1.2 guard runs on every change; clearing to `null` is always allowed) |
| `DELETE /api/projects/[slug]` | Hard delete (`git rm`), operator-confirmed in UI |
| `POST /api/projects/[slug]/members` | Add a **set** of refs |
| `DELETE /api/projects/[slug]/members` | Remove a **set** of refs |

Conventions, all already in force in this repo: `getAuthUser()` on every handler
(the edge middleware only checks that a cookie is *present*, so the handler is
where the session is validated — the `/api/captures/[id]/review` route documents
exactly this); zod `strict()` bodies so a misspelled field is a 400; one typed
error shape with stable machine-readable codes that clients branch on, never on
message text; honest status codes (400 malformed, 401 auth, 404 missing, 409
conflict); membership writes take a set so one operator action is one commit.

**UI** (`app/(app)/app/projects/`), matching the existing shell
(`page.tsx` server component → `*-client.tsx`, the pattern every feature here
uses): a list with a lifecycle filter and create; a detail page with the living
doc as the primary pane, a paginated grouped-knowledge panel, and membership
add/remove. Sidebar entry in `apps/web/components/app-sidebar.tsx`, which must
stay in sync with the routes that actually exist. Loading / empty / error are the
required trio on every async surface — the degraded state says *which* rung it is
on rather than rendering a blank pane.

**Sub-projects (A1).** The list is a **two-level tree**: roots as top-level rows,
children indented one level under a disclosure caret, with a "New sub-project"
action on roots only. The detail page gains a Sub-projects panel and a Parent
control; the two blocked states ("has a parent" / "has children") are stated in
words where they fire, because a limit the user cannot see reads as a bug. An
archived parent is still rendered for any child that is rendered. Full shape:
ADR-0001 Amendment A1 §A1.7.

**Linked notes (2026-09-30).** The detail page gains a **Notes** section listing the
project's `project_items(item_kind='note')` references, each with the note's own date
and a one-line excerpt, and each linking to `/app/projects/<id>/notes/<noteId>` — an
on-demand view that reads ONE note's body. The list never reads a body: a note is
often a whole conversation and some rows exceed a million characters, so the list
query selects `left(content, NOTE_EXCERPT_SOURCE_CHARS)` and every rule about the
list (which rows survive — a soft-deleted note never renders; the order; the excerpt;
the empty-state copy) lives in the pure `apps/web/lib/projects/notes.ts`. Notes are
deliberately **not** also rendered in the grouped-knowledge piles: one page does not
show a note twice.

**Mobile**: the V2 Flutter surface has no Projects screen — it was stripped in
`5d8a1a1` (`chore(mobile): strip to v2 surface`). Parity is an operator question
(ADR-0018 #6), not an assumption. Note the mobile app *does* still drive
`/api/sync` (see §2), which is why `schema.projects` matters.

## 8. Relationship to existing concepts

| Concept | Relationship | Decisive call |
|---|---|---|
| **`workspaces`** | Orthogonal. A workspace is the tenancy boundary (who owns a row); a project is a knowledge grouping (what belongs together). A project page lives *inside* a workspace's data. | **Do not merge them.** A project is not a workspace, and building projects on the workspace table would make containers a tenancy concept. |
| **`bookmarks` / tags** | Related, not identical. Bookmarks are a *unit kind* that can be a member; tags are many-cheap-uncontrolled labels. | **Projects are not tags** (ADR-0018 alternatives). A project has a body, a lifecycle and deliberate membership; a tag has none of those. |
| **Sub-projects (A1, 2026-09-27)** | A project may name **one parent** (`parent_id` on the live table; `parent: projects/<slug>` on the page model). Projects are hierarchical; items are not. | **Ownership at the project layer, references at the content layer** — deliberate, per ADR-0001 A1.9. Items keep every §3.1 property; a sub-project never inherits, moves, or owns its parent's members. Two levels, policy-enforced (A1.3). |
| **brain page model (`type:`, slugs)** | A project **is** a brain page, `type: project`, slug `projects/<slug>`. | **DB-only was rejected.** `PAGE_TYPES` already includes `project`; the graph already filters `projects`; making projects DB-only would fork the model and put them outside the export door. |
| **captures / `capture_index`** | A capture is addressable as `capture:<ulid>` and is a legit member kind. The index tables copy `capture_index`'s derived-and-rebuildable pattern rather than inventing one. | **Reuse the pattern.** |

## 9. Open questions for the operator

**Answered 2026-09-26 — approved. Dispositions live in ADR-0018 §Operator decisions; the questions
are kept here with their outcome so this document cannot be read as still-open.**

1. **Approve or reject this design?** — **APPROVED 2026-09-26.** Phase 2's ⚠ hard stop is cleared.
2. **Member kinds** — is "any brain page or capture, by reference" right,
   accepting that a V1-era `notes`/`journalEntries` row never committed to the
   brain is not groupable? — **Yes; the ADR's default is taken.**
3. **Living doc = the project page body**, one git commit per save. Confirm, or
   ask for DB-side editing with a repo sync (which reintroduces two sources of
   truth)? — **The page body it is; no DB-side editing.**
4. **Disposition of the V1 remnants** — delete in Phase 5 or keep? Note that
   `schema.projects` is referenced by the **live** sync routes, so this is a code
   change either way. — **Keep until Phase 5; retirement stays operator-gated
   there.**
5. **`nexalog_v2` provenance** (§5) — how were those ~31 other tables
   provisioned? Blocks any migration. — **NOT answered by the approval.** It is a
   production fact, and a **read-only production inspection** is closing it — not
   an assumption from the repo. It holds the migration/adapter/route slice of
   Phase 3; the pure `packages/core` slice is not blocked.
6. **Mobile parity** — web-first and file parity after, or hold the ship gate? —
   **Web-first; parity after. The ship gate is not held for mobile.**

## 10. Phasing

**Phase 2 (this document — design + ADR).** Commits to: the model in §3, the
placement in §4, the layering in §6, the surfaces in §7, the reconciliation
verdict in §2, and a **named decision record** (ADR-0018) that a later reader can
hold the implementation to. It writes no code, no migration, and touches no
`packages/` or `apps/` source. Exit: operator approves or rejects.

**Phase 3 (core build) — approved to start 2026-09-26, in two waves.** Wave 1 (may start now):
domain + contracts + use cases + port declaration in `packages/core` — pure, testable with fakes,
no migration, no adapter, no route. Wave 2 (HELD on question 5): the migration, the Drizzle
adapter, composition wiring, and the routes. Ship gate as always: `pnpm typecheck`,
`pnpm depcruise`, `pnpm test`, `pnpm build` all green.

**Phase 4 (UI) — not started, needs Phase 3.** List + detail, membership
picker, lifecycle controls, the loading/empty/error trio, sidebar entry.

**Phase 5 (ship) — ⚠ OPERATOR-GATED, and NOT this task.** Push target, deploy,
and the production migration are three separate one-way actions requiring
explicit approval, and the migration cannot even be written until question 5 is
answered. Also operator-gated within Phase 5: retiring the V1 remnants
(question 4).

**Gates between phases:** Phase 2 → Phase 3 was the operator's approval of this design — **given
2026-09-26**, with the migration/adapter/route slice of Phase 3 held on question 5. Phase 4 → Phase
5 is the operator's push/deploy/migration approval. There is no gate between 3 and 4 (both are
reversible code), and nothing in Phase 2 authorizes anything in Phase 5.

## 11. Traceability

| Question the row asked | Where it is answered |
|---|---|
| Is it shipped? Evidence. | §2, ADR-0018 §Reconciliation |
| Data model + why reference-based | §3.1–3.4, ADR-0018 §D1–D2 |
| Sub-projects (hierarchy, depth, cycles, lifecycle, rollup, DDL, UI, import) | ADR-0001 **Amendment A1** §A1.1–A1.12; this doc §3.1 note, §3.5 rows, §7 |
| Schema placement | §4, ADR-0018 §D2 |
| Layering / paths | §6, ADR-0018 §Layering |
| Deletion & lifecycle | §3.5, ADR-0018 §D5 |
| Surfaces | §7 |
| Relationship to workspaces/tags/brain pages | §8 |
| Open questions | §9, ADR-0018 §Operator decisions |
| Phase 2 vs Phase 5, gates | §10 |
