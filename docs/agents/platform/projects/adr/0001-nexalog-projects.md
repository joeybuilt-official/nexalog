# ADR 0001 — Nexalog Projects (container · grouping · Jex contract · lifecycle · living-doc)

Status: **V1-era decision record, amended. D1–D5 APPROVED 2026-06-12 (see §APPROVED DECISIONS —
the previous header read "PROPOSED — awaiting operator approval" and contradicted the gate-pass
recorded in this file's own body; the body is the evidenced one and the header is corrected here
rather than left to disagree with it). Superseded for V2 by
`adr/0018-projects-reference-based-containers.md` (Accepted 2026-09-26) — except Amendment A1 below,
which is live for both placements and is operator-locked 2026-09-27.**
Date: 2026-06-12 · Initiative: NEXALOG-PROJECTS

## Context
Add a first-class **Project** to Nexalog: a container that GROUPS existing atomic units (notes, bookmarks) BY REFERENCE, carries a LIVING DOCUMENT + an AI BRAINSTORM thread, and has a LIFECYCLE STATE. Nexalog owns the canonical project record. Execution (brainstorm/AI) runs in Plexo over the Jex boundary; Plexo attaches Work history to the project ID. No Plexo Core changes; no second registry; no local AI pipeline; no creator canvas.

Phase 0 (audit-findings.md) + Phase 1 (OSS benchmark, top-5 by live stars) inform every decision below.

## Benchmark first principles applied
1. Atomic units are addressable by stable ID; references point at IDs, never copy (AFFiNE/SiYuan/Logseq/Trilium).
2. **Grouping ≠ ownership** — Project is a reference-set, never a folder that owns notes. One unit lives in many projects.
3. Living-doc storage = markdown text for portability; runtime block-tree is optional sugar, and CRDT/block-tree lock-in is *unearned for single-user PKM*.
4. **Lifecycle is the field's blind spot** — only Outline ships real container states. First-class lifecycle is our differentiator (design it as an enum on the container, not a tag).

## Expert panel (conflicts surfaced — operator decisions D1–D5)
- **Security ↔ UX:** Sec requires every grouped `itemId` be validated as same-workspace before linking (IDOR risk: grouping another user's note by raw ID). UX wants frictionless "add to project" quick-actions app-wide. → Resolved by batched ownership validation (single `IN` query) so the guard is cheap; UX keeps the quick-action. (No operator decision needed; recorded.)
- **Performance ↔ PKM-domain (D1):** Perf wants living-doc as plain markdown `text` (cheap store/diff, paginate grouped items). Domain wants a rich block-tree. → **D1.**
- **Maintainability ↔ PKM-domain (D2):** Maint + the "no generic container framework" guardrail want static explicit references only. Domain wants dynamic saved-query "smart" membership (AFFiNE Collections style). → **D2.**
- **Maintainability ↔ UX (brainstorm):** Maint wants the chat route's context-graining extracted into one shared lib reused by both chat and project brainstorm (no divergence). UX wants project brainstorm to auto-scope to project context and feel distinct. → Resolved: extract `lib/context-graining.ts`, project brainstorm passes project digest via `sessionContext.activeView`. (Recorded.)

## Decisions (one-way doors — require approval)

### D1 — Living-doc storage  ⚠ one-way
**Recommend: `livingDoc text` (markdown) + `livingDocUpdatedAt timestamptz`.** Lightweight, portable, diff-able, matches "no premature abstraction"; benchmark says CRDT/block-tree is unearned single-user. A JSONB block-tree can be added later additively without dropping the column. Editor = simple markdown textarea/MD editor in v1.
- Alt rejected: JSONB block-tree / CRDT (heavy, Rust bindings, hard egress, multi-user-only payoff).

### D2 — Grouping membership model  ⚠ one-way
**Recommend: static explicit references via `project_items` junction** — `(id uuid, projectId uuid, itemKind text CHECK in ('note','bookmark'), itemId uuid, addedAt timestamptz)`, unique `(projectId,itemKind,itemId)`, indices both directions. Mirrors existing junction pattern exactly. Group by reference, never copy. Dynamic saved-query membership deferred (additive later — would add a `project_smart_rules` table, not change this one).
- Alt rejected for v1: query-defined dynamic membership (premature; guardrail forbids generic container framework).

### D3 — Jex contract (brainstorm Work + context read + history write-back)  ⚠ one-way
**Recommend: route brainstorm through SDK `chatMessage(workspaceId, userId, opts)` via one new `lib/plexo.ts` export** (e.g. `plexoProjectBrainstorm`). Mapping:
- **Project handle → Plexo Work thread:** `channelRef = { channel: "nexalog-project", channelId: <projectId>, chatId: <projectId> }`. Plexo holds the conversation/Work history server-side keyed by this — **no registry copy in Plexo**, only a reference + history attached to projectId.
- **Context read:** `sessionContext.activeView = { type: "project", id: projectId, summary: <living-doc digest + grouped-knowledge digest> }`; bulk context (grouped unit titles/snippets) in `sessionContext.appState`.
- **History write-back:** Plexo returns `{ reply, conversationId, sessionId, taskId }`; Nexalog persists only the `sessionId`/`taskId` pointer on the project (NOT a copy of history) and reads history back via `getConversations(workspaceId)` filtered to the project session. Brainstorm transcript of record lives Plexo-side.
- Domain depends on a small **port interface** `ProjectIntelligencePort` (methods: `brainstorm`, `readWorkHistory`), implemented once by the Jex client. AI concerns never leak into domain/route logic beyond the port.
- Alt rejected: reuse local `aiComplete` graining (stateless, no Work threading, no taskId, violates "writes Work history back over Jex").

### D4 — Lifecycle states  ⚠ one-way
**Recommend enum `lifecycleState`: `draft → active → archived`** (Outline-validated), default `active`, stored as `text` with CHECK (matches existing `lifecycleState`/`state` columns in schema). Optional 4th `paused` if operator wants an explicit hold state.
- Transitions enforced in domain layer (pure fn), not free-text.

### D5 — Which units are groupable (v1 scope)  — **APPROVED: notes + bookmarks + journal**
`itemKind in ('note','bookmark','journal')`. Ownership guard validates each kind against its table (`notes` / `captureSources` / `journalEntries`) by `workspaceId`+`userId`. journal has no title → graining uses `entryDate` + `body` snippet.

## UPDATE 2026-06-12 — pre-mortem #3 FIRED (fallback applied)
Live prod smoke showed `chatMessage` (channelRef Work threading) returns an **empty reply + no sessionId** on this Plexo deployment — `chat/message` has never been exercised by Nexalog (existing chat uses `aiComplete`). Per the pre-mortem #3 fallback, brainstorm now runs over **`aiComplete`** (proven path) grounded in the project digest, and the **transcript persists in Nexalog's existing `chatSessions`/`chatMessages`** (project.plexoSessionId → session id), mirroring the chat feature. Still all-Plexo inference, no local AI, no new table. The `ProjectIntelligencePort` surface is preserved (now pure inference; route owns persistence) so a future Plexo Work primitive can be reinstated without touching the route/UI. Contract note: storing brainstorm turns in Nexalog matches how the app already stores chat — it is NOT a duplicated project *registry*.

## APPROVED DECISIONS (Phase 2 gate passed 2026-06-12)
D1 = markdown `text` · D2 = static `project_items` junction · D3 = Jex `chatMessage` channelRef=projectId · D4 = `draft/active/archived` · D5 = notes+bookmarks+journal.

## Schema (proposed `0012_projects.sql`)
```
projects (
  id uuid pk default gen_random_uuid(),
  workspaceId uuid not null, userId text not null,
  name text not null, description text,
  lifecycleState text not null default 'active' check (lifecycleState in ('draft','active','archived'[, 'paused' if D4]) ),
  livingDoc text, livingDocUpdatedAt timestamptz,
  plexoSessionId text,           -- pointer to Plexo Work thread (NOT history copy)
  createdAt timestamptz default now(), updatedAt timestamptz default now(), deletedAt timestamptz
)  -- indices: (workspaceId,userId), (lifecycleState)

project_items (
  id uuid pk default gen_random_uuid(),
  projectId uuid not null references projects(id),
  itemKind text not null check (itemKind in ('note','bookmark')),
  itemId uuid not null,
  addedAt timestamptz default now()
)  -- unique (projectId,itemKind,itemId); index (projectId), (itemKind,itemId)
```
No FK from project_items.itemId to notes/captureSources (polymorphic by itemKind) — integrity enforced in the validated insert path (batched ownership check), consistent with existing polymorphic junction usage.

## Pre-mortem (assume it failed)
1. **Drift: a project registry/copy leaks into Plexo.** Cause — brainstorm convenience pushes project metadata into Plexo memory/graph as the source of truth. *Fallback:* port interface only ever sends a *digest* via `sessionContext`, never persists project rows Plexo-side; ADR + a code-review checklist item assert "Plexo holds pointer+history, never registry." Grep guard for accidental `addEpisode` of full project records.
2. **IDOR / cross-workspace grouping.** Cause — `project_items` insert trusts client-supplied `itemId`. *Fallback:* every link path runs a single batched `SELECT id FROM notes/captureSources WHERE id IN (...) AND workspaceId = $ws AND userId = $u`; reject any id not returned. Covered by a test.
3. **Brainstorm contract mismatch — `chatMessage` Work threading not as assumed** (e.g. `channelRef`/`taskId` semantics differ on the live Plexo). Cause — SDK type ≠ deployed Plexo behavior. *Fallback:* probe the live endpoint in Phase 3 before wiring UI; if Work threading is absent, degrade to `aiComplete` + store transcript pointer only in `plexoSessionId`, keep the same `ProjectIntelligencePort` surface so UI is unaffected. Flag as a discovery if it fires.

## Consequences
- Adds 2 tables + 1 migration (0012, manual prod apply — operator-gated).
- Extends `lib/plexo.ts` with one port-implementing export; extracts `lib/context-graining.ts` shared with chat.
- New routes `app/api/projects/*` + UI `app/(app)/app/projects/{page,[id]}`.
- Deferred (additive, not built now): dynamic smart membership, journal grouping, block-tree living-doc, real-time collab.

---

# AMENDMENT A1 — Sub-projects (a project may have one parent)

**Status: ACCEPTED — operator-locked 2026-09-27.** This amendment is appended to ADR-0001 and is
binding on the Phase 3 build. It is placement-independent: §A1.6 gives the additive DDL for the
**live `nexalog.projects` table** (the row model this ADR defines, which exists in prod), and
**A1.10 Finding 3** gives the same relationship's shape under the accepted V2 brain-page model
(`adr/0018-projects-reference-based-containers.md`). Whichever placement Phase 3 lands, the
semantics in A1.1–A1.5 are the same, and no reading of this amendment may be used to relax
ADR-0018's D1/D2 for **items**.

Three of the decisions below are the operator's, given as a directive and recorded as locked:
**A1.1** (representation = strict tree on `parent_id`), **A1.3** (depth = two levels, policy-enforced),
and the §A1.9 resolution of the design.md §3.1 tension. The remainder (A1.2, A1.4, A1.5, A1.6, A1.7,
A1.8) is the amendment's recommendation at build-ready detail, marked **[recommends]** so a reviewer
can see which parts are the operator's word and which are the drafter's.

## A1.0 Context — why this amendment exists at all

The approved model is flat. In production, `nexalog.projects` holds **1 row** with no way to express
a parent, and there are **no routes and no UI** for Projects at all — the tables are live and
unreachable. Meanwhile the operator's own working set is 37 projects, and **37 flat rows is not a
usable project list**; two of those 37 already carry a parent hand-encoded in the *name*:
`Angel // Release Manager` and `Angel // Distribution Management`.

That pair is the whole argument in miniature. The operator, working without any hierarchy support,
invented one — in a convention the system must now either honour or destroy. This is not speculative
demand; it is an observed workaround.

Two facts about the source data bound the design:

1. **the agent's conversations carry no project link.** The conversation object's keys are
   `account, chat_messages, created_at, name, summary, updated_at, uuid` — there is no project field
   and no project uuid cross-reference. Hierarchy therefore **cannot be inferred from conversations**.
   It can only come from names (the `//` convention) or from the operator.
2. **Name is the only structural signal that exists**, and it is a convention, not a schema. Any
   derivation from it must be visibly a *proposal*, never a silent truth.

## A1.1 Hierarchy representation — self-referencing `parent_id`, one parent, strict tree  **[operator-locked]**

**Decision: `projects.parent_id uuid` (nullable, self-referencing).** One parent per project. The
child is a normal project — same table, same lifecycle field, same living doc, same membership
machinery — that names a parent. There is no new entity, no new table, and no second registry.

**Why this and not the alternative, from the two constraints that actually bind:**

- *The hard constraint.* A parent must be able to own a lifecycle that a child can be read against
  ("is this project part of something still alive?"), and a tree that the UI can walk in one indexed
  query. `parent_id` gives both for the cost of one nullable column and one index. The reference
  model cannot give either without a join per level and an ambiguity (see below).
- *The house constraint.* `bookmark_tags` is already a self-referencing `parentId` column in this
  schema (`apps/web/lib/db/schema.ts`, and `audit-findings.md` line 17 names it as the junction
  precedent). A self-reference is the established pattern here, not a novelty — and unlike every
  other reference in the Projects design, a project parent **is a row**, so this reference can carry
  a real foreign key (see A1.6). That difference is the technical reason the two layers are not the
  same problem.

**The one thing this buys that matters most:** the parent/child relation becomes *queryable and
constrainable*, which is what makes A1.4 (lifecycle) and A1.5 (rollup) answerable at all. Under the
reference alternative, "what are this project's children" is a filtered scan over a polymorphic
junction whose semantics are "membership", not "structure" — the two concepts would share a column
and be indistinguishable.

**Alt rejected — reference-based sub-projects (a project sitting under multiple parents via
`project_items.item_kind = 'project'`).** Recorded as rejected, in the form the decisions above use:

- It preserves the "grouping is not ownership, one unit lives in many projects" principle in its
  purest form and adds no column — that is its real strength, and it is the reason it had to be
  argued rather than dismissed.
- It is rejected because it makes **structure and membership the same relation**, and then cannot
  tell them apart: "the parent project" and "a project that also references this one" become the
  same row, so archiving, rolling up and tree-walking all have to guess which is meant. A container
  that appears under two parents is a *tag*, at which point the model has no parents at all.
- It also fails the concrete need: with no single parent, a project has no single place to be
  archived from, no single lifecycle to read against, and the UI cannot render a tree over a
  many-to-many graph without lying about something (which parent is the "real" one?).
- Cost of being wrong: **`parent_id` is the cheap direction.** If multi-parent membership is ever
  genuinely wanted, it is additive — a `project_parents` junction referencing the same column
  semantics can be introduced beside `parent_id` without moving data out of it, because `parent_id`
  holds a strict subset of what such a junction would hold. The reverse (starting many-to-many and
  discovering structure was needed) forces a choice of a "primary" parent at migration time, which is
  a judgement the data cannot supply. **This asymmetry is the one-way-door argument for A1.1.**

**One-way-door consequences of A1.1, stated plainly:**

- Every read that lists projects must now decide what to do with parents and children; the flat
  `SELECT * FROM projects` is no longer a complete answer to "show me my projects".
- `parent_id` becomes part of the offline-sync payload for free (`/api/sync` selects whole rows), so
  the mobile client will *see* the column whether or not it understands it. The mutation path does
  not accept it (`ENTITY_TABLES.projects.fields` lists five fields and does not include `parentId`),
  which means for now hierarchy is **web-only by construction** — a property to keep deliberately,
  not by accident (see A1.11 item 1).
- Reversing A1.1 later (back to flat) means dropping a column with user data in it. The amendment
  accepts that as the price of the model the operator actually needs.

## A1.2 Cycle prevention — a batched validated-write guard, never a trigger  **[recommends]**

A project must never be its own ancestor. The house pattern for "the database cannot fully express
this, so the write path must" is already established twice in the approved design — the batched
ownership guard (`filterOwnedRefs`, `lib/projects/store.ts`) replacing a missing FK on
`project_items.item_id`, and "enforced on write, reconciled on rebuild, surfaced when broken" in
ADR-0018 §D2. **This amendment follows that pattern rather than inventing a third mechanism.**

**Decision: one guard function, one batched read, no trigger, no CHECK constraint.**

```
assertCanSetParent({ workspaceIds, projectId, parentId }) → ok | rejected(reason)
```

Rules, evaluated in one place (naming mirrors `filterOwnedRefs`):

| # | Rule | Rejection | Why |
|---|---|---|---|
| R1 | `parentId !== projectId` | 400 `SELF_PARENT` | The degenerate cycle. Cheap check, exact error. |
| R2 | Parent exists, is not soft-deleted, and belongs to a workspace the caller owns | 404 / 403 | Same IDOR class as `filterOwnedRefs`: a raw uuid must not be usable to attach to someone else's project. One batched `SELECT ... WHERE id IN (...) AND workspaceId IN (...)`. |
| R3 | Parent is **a root** — `parent.parent_id IS NULL` | 409 `DEPTH_EXCEEDED` | This is the two-level policy (A1.3) enforced from the parent's side. |
| R4 | The project being parented has **no children** | 409 `DEPTH_EXCEEDED` | The same policy enforced from the child's side. With R3, one level is the maximum *by construction* while the policy holds. |
| R5 | `projectId` is not among the parent's ancestors (recursive walk) | 409 `CYCLE` | The durable guard. Today R3+R4 make a cycle unreachable; R5 is the one that still holds if the depth policy is ever raised, so a future change to A1.3 cannot silently introduce loops. |

**The cycle-check query** (R5; one round trip, bounded in practice by the depth cap — `$1` =
candidate `parent_id`, `$2` = `project_id`):

```sql
WITH RECURSIVE ancestors AS (
  SELECT id, parent_id, 1 AS depth
    FROM nexalog.projects
   WHERE id = $1                          -- candidate parent
  UNION ALL
  SELECT p.id, p.parent_id, a.depth + 1
    FROM nexalog.projects p
    JOIN ancestors a ON p.id = a.parent_id
   WHERE a.depth < 32                    -- hard stop: a corrupt row cannot hang the request
)
SELECT id FROM ancestors WHERE id = $2;  -- the project being parented
```

A returned row means setting the parent would close a loop → reject with 409. `depth < 32` is a
liveness bound, not a policy: policy is 2 (A1.3). **A cycle must never be able to take the API
down**, and a recursive query on corrupt data is exactly how that happens.

**Why not a trigger and why not a CHECK, stated as engineering rather than preference:**

- A `CHECK` constraint **cannot express any of R2–R5** — PostgreSQL CHECK does not permit subqueries
  or references to other rows, so "my parent must itself have no parent" is not expressible. The
  operator's routing of this rule into the write path is therefore not a compromise; it is the only
  option short of a trigger.
- A trigger **can** express them, and is still rejected deliberately: this schema contains **zero
  triggers and zero stored procedures** (verified across every file in `apps/web/drizzle/` and
  `db/migrations/` — there is no `CREATE TRIGGER` or `CREATE FUNCTION` anywhere). Introducing the
  first one adds a second place where business rules live, invisible to `pnpm test`, invisible to
  `depcruise`, and impossible to test with fakes — the exact defect V2's architecture exists to
  prevent. The guard is domain logic; it belongs where it can be unit-tested.
- **Covered by a test** (the same standard ADR-0001's pre-mortem #2 set for the ownership guard):
  one case per rule R1–R5, plus a positive case, plus the R5 case built on a *deliberately* deepened
  fixture so the ancestor walk is exercised for real rather than trivially true.
- **Honest limit, recorded:** the guard is read-then-write, not serialized. Two concurrent
  assignments could in principle race. Single-operator usage makes this a non-event, and the tree
  read caps its own walk depth so even a pathological row degrades to a bounded render rather than a
  hang. Recorded as A1.11 item 3 rather than papered over with a lock the traffic does not
  justify.

## A1.3 Nesting depth — two levels (project → sub-project), policy-enforced  **[operator-locked]**

**Decision: exactly two levels. A project that has a parent MUST NOT itself be a parent.** Enforced
by R3+R4 in the A1.2 guard — **not** a DB trigger, **not** a CHECK constraint, and **no** depth
column.

**Reasoning, from the evidence rather than from tidiness:**

- **The corpus demonstrates one level and no more.** The only structure in 37 real projects is a
  single `//` split — parent, child. There is zero evidence of grandchildren. Designing for depth N
  when the observed maximum is 1 is designing for a hypothesis.
- **Every concern in this amendment gets more expensive with depth, superlinearly.** Cycle prevention
  stops being a construction property and becomes a live risk (R5 carries the whole load); the
  lifecycle question in A1.4 acquires a propagation chain instead of an edge; the rollup in A1.5
  needs recursion and a total-size bound; the UI needs disclosure affordances and a breadcrumb trail;
  and "which project do I archive?" becomes ambiguous in a way users report as a bug.
- **Two levels is the maximum that stays legible in one glance**, which is the only thing a project
  list has to be good at.

**The column shape keeps the door open, and that is deliberate.** `parent_id` is not a
depth-encoding — it is plain self-reference, so raising the limit later is a **policy change plus
deleting one rule from the guard and its test**, not a migration and not a data reshape. Depth is a
property of the guard, not of the schema. This is exactly why the schema must not encode depth (no
`depth` column, no `CHECK`): a schema-level limit would make the future change a migration on
populated rows, and it would forbid the shapes a policy change needs.

**Say the limit out loud in the product, not just the ADR.** The UI must state "two levels" when a
limit is encountered (A1.7) — a rule the user cannot see is a rule that reads as a bug when it fires.
**Depth of the *policy* is enforced in exactly one place: a single `MAX_PROJECT_DEPTH = 2` constant
in the domain module**, consumed by the guard and asserted by its test. Depth must not be spelled as
a literal in a route, a query, or a component.

## A1.4 Lifecycle propagation — independent, with a warn-and-offer, never a cascade  **[recommends]**

Three candidates: cascade (parent archived ⇒ children archived), independent (children unaffected),
warn (children unaffected *and* the inconsistency is surfaced with an explicit bulk action).

**Decision: warn — children keep their own lifecycle, and the product tells the truth about it.**

| Event on the parent | Effect on children | Why |
|---|---|---|
| `active → archived` | **No write.** Children keep their state. UI shows an "under an archived parent" badge on any child still `draft`/`active`, and offers a one-click "archive these children too" that writes *explicit* transitions. | Archiving is the reversible state (D4/D5). A cascade on the parent's archive destroys the child's own state on an action the user understands as scoped to one project — and un-archiving cannot restore what the cascade overwrote, because the old value was never recorded. The bulk action is one commit, so the convenience the cascade was buying is retained. |
| `archived → active` | **No write.** Children are already in whatever state they held. | Symmetry. A cascade here would resurrect children the user deliberately parked. |
| `active → draft` | **No write.** Same badge logic as archive. | A draft parent with active children is a legitimate "I'm sketching a restructuring" state, not an error. |
| Create a child **under an archived parent** | **Rejected**, 409 `PARENT_ARCHIVED`. | The one place a rule is right: adding new work under a shelved container is almost always a mistake, and un-archiving first is one click. This is a *validation*, not a cascade — it never mutates an existing row. |

**The load-bearing requirement: an archived parent must never hide its children.** Default list
filtering is "active only", which would make `Angel // Release Manager` vanish when `Angel` is
archived — silently deleting work from view, the single worst failure this feature could have. Rule:
**the tree always renders a parent row for a child that is rendered**, even when that parent is
archived, dimmed and labelled; and a child of an archived parent is never filtered out *because of
the parent*. Deleting a project still never touches a child's existence (A1.6, `ON DELETE SET NULL`).

## A1.5 Living-doc / brainstorm rollup — computed, never written back  **[recommends]**

Today: `buildContextDigest(project, groupedUnits)` (`lib/projects/store.ts`) builds the digest;
`ProjectIntelligencePort.brainstorm({ digest, history, message })` (`lib/projects/domain.ts`)
consumes it. `ProjectContextDigest` carries `{ projectId, name, summary, groupedUnits }`.

**Decision: a parent's living doc does NOT aggregate children's documents. Rollup is a computed read
that extends the digest — it is never a write to the parent's page.**

- **The doc stays authored.** Appending child content into the parent's living doc is a *copy* of
  child content in a second place; copies drift, and the drift is invisible because both copies look
  authoritative. It also contradicts the principle this whole design rests on — one unit, one home —
  and under ADR-0018's placement it would make every child doc save a git commit against the parent,
  turning one edit into a write amplification the design explicitly counts as a cost.
- **The digest is the right seam, and it already is one.** Extend the value object, not the port:

```
ProjectContextDigest = {
  projectId, name, summary, groupedUnits,          // unchanged
  subProjects?: Array<{ id, name, lifecycle, docExcerpt }>,   // NEW — parents only
  parent?: { id, name, lifecycle },                           // NEW — children only
}
```

  `ProjectIntelligencePort`'s method signatures do **not** change: the digest is data, so adding
  fields is not a port change and no adapter churn follows. That is the discipline ADR-0018 §D3 set
  ("the project digest passed as plain data").
- **Bounded by construction.** Children contribute a **document excerpt**, capped (recommends: 400
  chars each, ≤ 2,000 chars total across children, hard-truncated). An unbounded rollup makes a
  parent's brainstorm prompt grow with its children's documents, which is a slow-motion prompt-size
  failure, not a design.
- **Downward only, and explicitly.** A parent's digest includes its children; a child's digest
  includes only its parent's **identity line** (`name` + `description`), never the parent's living
  doc. Otherwise a private sketch in a parent doc leaks into a child's brainstorm context by
  accident, and the child's digest grows without bound as the parent's doc grows.
- **UI:** the project detail page renders a "Sub-projects" panel (names, lifecycle chips, links, and
  a count) above the grouped-knowledge panel. The parent's living doc remains a textarea the user
  owns; nothing auto-populates it. If the operator later wants a *visible* rendered rollup it is a
  read-only rendered section — never text merged into the stored doc.

## A1.6 Schema + DDL — additive, idempotent, manual `psql`  **[recommends — exact shape]**

⚠ **This is an operator-run `psql` script, not a migration file, and not a `db:*` command.** Both
hard constraints hold: **no migration file is created** and **`pnpm db:push` / `pnpm db:migrate` are
never invoked**. `.agents/rules/database.md` normally requires the generate→review→migrate toolchain
and forbids hand-applied SQL; that is a real divergence from the repo's written rule, directed by the
operator for this table, and it is **recorded rather than silent** (see §A1.10 Finding 2).

**Why `ALTER`, not `CREATE`:** the table exists. `nexalog.projects` is live in prod with **1 row**;
`nexalog.project_items` and `nexalog.project_candidates` also exist (both 0 rows). So this change is
purely additive against a populated table, and every existing row becomes a root by definition
(`parent_id IS NULL`). No backfill, no data movement, no downtime. That is the safest possible shape
for a schema change on live data, and it is worth stating explicitly because it is not the usual case.

```sql
-- ============================================================================
-- Projects hierarchy — MANUAL APPLY ONLY (psql). NOT a migration file.
-- Idempotent: safe to re-run. Forward-only. Additive: drops nothing, rewrites
-- nothing. Target: the shared Postgres, schema `nexalog` (never `public`).
-- Operator-locked design: ADR-0001 Amendment A1 (2026-09-27).
-- ============================================================================
BEGIN;

-- 1) The hierarchy edge. Nullable = root. Self-FK = one parent, strict tree.
ALTER TABLE nexalog.projects
  ADD COLUMN IF NOT EXISTS parent_id uuid;

-- 2) The self-FK, guarded (Postgres has no ADD CONSTRAINT IF NOT EXISTS).
--    ON DELETE SET NULL is deliberate: deleting a parent PROMOTES its children
--    to roots. A child is never deleted, and never left dangling.
--    (NOT CASCADE — that would destroy projects. NOT RESTRICT — that would make
--    a parent undeletable until the user first detaches children, turning a
--    one-action operation into a puzzle.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_parent_id_fkey'
  ) THEN
    ALTER TABLE nexalog.projects
      ADD CONSTRAINT projects_parent_id_fkey
      FOREIGN KEY (parent_id) REFERENCES nexalog.projects(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 3) The tree read is "roots and their children for this workspace", so index
--    the edge. (Postgres does not index FK columns automatically.)
CREATE INDEX IF NOT EXISTS projects_parent_id_idx
  ON nexalog.projects (parent_id);

-- 4) OPTIONAL — import provenance / idempotency key for the Claude-project
--    import (A1.8). Scoped to the owner so the same source project cannot be
--    imported twice into one workspace. Skip only if A1.8's fallback
--    (name-match) is preferred; nothing else here depends on it.
ALTER TABLE nexalog.projects
  ADD COLUMN IF NOT EXISTS import_ref text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_import_ref_uq'
  ) THEN
    ALTER TABLE nexalog.projects
      ADD CONSTRAINT projects_import_ref_uq
      UNIQUE (workspace_id, user_id, import_ref);
  END IF;
END $$;

COMMIT;
```

**What is deliberately NOT in this DDL, and why:**

- **No depth column, no `CHECK (parent_id IS NULL OR ...)`.** A CHECK cannot express A1.3's rule (it
  cannot see another row), and encoding depth in the schema would make a future policy change a
  migration on populated rows. Depth lives in the guard (A1.3).
- **No trigger.** Zero triggers exist in this schema; see A1.2.
- **No `NOT NULL`, no default.** `NULL` is the root state and must stay the default — a default value
  would silently invent a parent.
- **No new table.** A separate `project_parents` table would be the many-to-many shape A1.1 rejected,
  and would make "one parent" a runtime invariant instead of a column shape.

**Verify after applying** (the repo's rule: verify by querying the catalog, not by trusting exit
codes — `database.md` "Apply, then verify"):

```sql
SELECT column_name, is_nullable, data_type
  FROM information_schema.columns
 WHERE table_schema = 'nexalog' AND table_name = 'projects'
   AND column_name IN ('parent_id','import_ref');

SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conname IN ('projects_parent_id_fkey','projects_import_ref_uq');

SELECT indexname FROM pg_indexes
 WHERE schemaname = 'nexalog' AND tablename = 'projects'
   AND indexname = 'projects_parent_id_idx';

-- Post-state assertion: the pre-existing row must still be a root.
SELECT count(*) AS roots, count(parent_id) AS children
  FROM nexalog.projects;
```

**Also required in the same change, when the code slice lands (not this docs-only change):**
`schema.projects` in `apps/web/lib/db/schema.ts` gains
`parentId: uuid("parent_id")` and `importRef: text("import_ref")` — the schema file must stay the
declared source of truth and must not drift from the hand-applied DDL. Until the code slice touches
it, this amendment deliberately does **not** edit `schema.ts`.

**Read-side query shape** — one query, no N+1, roots first (the whole tree for a workspace):

```sql
SELECT id, name, lifecycle_state, parent_id, living_doc_updated_at
  FROM nexalog.projects
 WHERE workspace_id = $1 AND deleted_at IS NULL
 ORDER BY parent_id NULLS FIRST, name;
```

Group in application code: rows with `parent_id IS NULL` are roots; each other row attaches to its
parent. A row whose parent is absent (filtered by `deleted_at`, or a different workspace) must be
rendered **as a root with a note** — never dropped (the honest-degradation rule the approved design
sets for unresolved members).

## A1.7 UI shape — a two-level tree under the existing authed shell  **[recommends]**

Follows the authed-shell pattern recorded at `audit-findings.md:34` (`page.tsx` server component →
`*-client.tsx`), the same shape as `app/(app)/app/chat/` and every other feature here. Routes are the
approved ones (ADR-0018 §Layering: `apps/web/app/(app)/app/projects/**`) — this amendment adds no
route, it adds a hierarchy *view* to the routes already specified.

| Surface | Change |
|---|---|
| `projects/page.tsx` + `projects-client.tsx` (list) | Becomes a **tree**: roots as top-level rows, each root's children indented exactly one level under a disclosure caret. Children render inline by default (there are at most a handful) — no lazy expansion for a two-level tree. Lifecycle filter keeps working and applies to *rows*, with the A1.4 rule that a parent row is always rendered for any rendered child. |
| Root row action | **"New sub-project"** on roots only. Hidden (with the reason stated) on a project that already has a parent. |
| Child row | Shows `Parent / Child` breadcrumb trail and an "under an archived parent" badge when A1.4 applies. |
| `projects/[id]/page.tsx` + detail client | Gains a **"Sub-projects" panel**: children with lifecycle chips, links, and a detach control; plus a **"Parent"** control on a child (set / change / clear). Two blocked states stated in words: "This project has a parent — sub-projects are limited to two levels" and "This project already has sub-projects — it cannot itself become a sub-project." A rule the user cannot see reads as a bug; the limit is stated where it fires. |
| Create dialog | Optional parent field (combobox of roots), pre-filled when launched from a root row. |
| Sidebar | **Unchanged** — one entry, `app-sidebar.tsx`, which must keep matching routes that actually exist. |

Rules: no nesting deeper than one indent level (that *is* A1.3, made visible); every async surface
keeps the loading / empty / error trio; the empty state says what a project is and offers "New
project"; the error state says which rung failed rather than rendering a blank pane. Removing a child
from a parent is an edit to one column — never a delete of anything (the A1.6 `SET NULL` semantics,
mirrored in the UI copy).

## A1.8 Import mapping — the flat 37 into a two-level tree  **[recommends]**

**Constraints the mapping must respect:** conversations carry no project link (verified — no project
field on the conversation object, no uuid cross-reference), so structure can come only from names or
from the operator; and a wrong parent is worse than no parent, because it is *invisible* wrongness —
the tree looks authoritative.

**Decision: mechanical mapping imports directly; every inferred structure goes through the review
queue.**

| Source shape | Action | Count (operator's real export) |
|---|---|---|
| Name matches `^\s*(?<parent>.+?)\s*//\s*(?<child>.+?)\s*$` and the parent name resolves to an imported project | Child imported with `parent_id` set | 2 children resolve to a real parent if that parent exists |
| Same pattern, parent name resolves to **nothing** | Create the parent as a **shell project** — `name` = the left side, `lifecycle_state = 'draft'`, empty living doc — then attach the child. The shell is created **as a review candidate first** (below), never silently. | 1 shell ("Angel") covers both `//` children |
| No `//` in the name | Import verbatim as a **root** (`parent_id NULL`). No name rewriting. | 35 of 37 |
| Anything else (ambiguous, duplicate names, missing fields) | Not imported; reported in the dry run. | — |

**Derivation rules, stated precisely so they are testable:**

1. Split on the **first** `//` only; trim both sides. `Angel // Release Manager` → parent `Angel`,
   child `Release Manager`. (First-split, not last, so a future `A // B // C` degrades to a child
   named `B // C` — visible and fixable — rather than silently inventing a third level the policy
   forbids.)
2. Parent resolution is **exact, case-insensitive, trimmed** match against other imported project
   names. No fuzzy matching, no prefix matching, no substring matching.
3. **No inference from prose.** `Full-On Pictures`'s description mentions "for Angel Studios"; that is
   a sentence, not a structure, and parenting from it is exactly the silent corruption rule 2 exists
   to prevent. If the operator wants those under `Angel`, the operator says so — the review queue is
   the mechanism.
4. The **shell parent is the only invented row**, and it exists because the operator's own name
   encodes the intent. It is `draft` (never `active`), empty, and flagged in `import_ref`
   (`claude:shell:<slug>`), so a later real import of a project named `Angel` matches it by the
   unique `(workspace_id, user_id, import_ref)`… or, if `import_ref` is skipped, by exact name within
   the workspace — either way it is deduped, not duplicated.
5. **The 37 are not all visible in one place.** The conversation export enumerates **31** project
   uuid+name pairs (inside pasted message text — not a conversation↔project field); the operator
   states 37 exist. The importer takes the project list as its input and must not treat the
   conversation scrape as the source of truth. It imports what it is given and **reports the
   discrepancy rather than filling the gap with guesses.**

**Review path (the designed-but-unreachable path, finally used):**
`project_candidates` exists for exactly this — "discovered (proposed) projects from an AI-conversation
import, awaiting review" (0 rows, zero code references today). The `//`-derived children and the
synthesized `Angel` shell are **proposed**, not created: they land as candidates (`import_id` = the
import run, `status = 'pending'`) and become real rows/edges only on operator confirmation
(`status = 'accepted'`, `project_id` set), exactly as the table's comment describes. The **35 flat
roots** are a mechanical, lossless mapping (name + description, verbatim) and may import directly
into `draft`. The split is the point: **mechanical = direct, inferred = reviewed.**

**Result of running it on the real export:** 35 roots + 1 synthesized parent (draft) + 2 children =
**38 rows, 2 edges.** Every one of the 37 real projects is present; nothing was dropped; exactly one
row was invented and it is a draft awaiting confirmation.

**Alt rejected for the import:** *import all 37 flat and let the operator restructure by hand.* It
destroys the one structural signal the operator already produced, and it recreates the precise pain
this amendment exists to fix — a 37-row flat list. Also rejected: *derive the hierarchy from
conversation text heuristically* — the only signal in conversation text is pasted prose and links,
which cannot distinguish a project's parent from a project's *mention*.

## A1.9 Reconciliation with §3.1 — project→project ownership is being introduced **deliberately**  **[operator-locked]**

`design.md` §3.1 ("Why reference-based rather than hierarchical or owning") rejected a hierarchical
model because it makes the container the **owner**: one parent, moves become cascading mutations, and
"delete the project" stops being safe. This amendment introduces `parent_id`, which is exactly that
relationship — one project owning another. **The tension is real and is not denied here.** It is
resolved on three points, in order of weight:

1. **The two hierarchies are over different things, and only one of them is rejected.** §3.1 is about
   the relationship between a **knowledge unit and its container** — a note, a bookmark, a journal
   entry. That relationship stays reference-based, unchanged: items are still grouped by reference,
   one item still lives in many projects, removing an item from a project is still an edit and never
   a delete, and deleting a project still destroys nothing the user wrote. **Nothing in this amendment
   touches the item layer.** Hierarchy among *containers* is a different relation with different
   semantics: two projects are not one thing stored twice, they are two identities, one of which the
   user has decided is part of the other. Calling this orthogonal is right, and the reason is that the
   *unit* of the relation changed, not the principle.
2. **At the container layer, ownership is being introduced on purpose, and it buys something real.**
   A child project has one parent, and the parent therefore *does* own it structurally: moving the
   child is a mutation, and the parent's lifecycle is meaningful to read the child against (A1.4).
   That is a deliberate product decision — the operator's own working set already encodes it in
   names, and there is no way to get a legible project tree without a single-parent edge. The cost
   §3.1 predicted is real and is paid knowingly: the price of hierarchy is that the container is now
   an owner of something. What keeps the price bounded is that the thing owned is another *project*,
   not a user's content.
3. **The boundary is stated as a hard rule so it cannot creep.** *Ownership stops at the project
   layer. Items never gain ownership. A sub-project is not a container of its parent's items.*
   Concretely: attaching a child project does **not** move, copy, or inherit the parent's `members`;
   the child's member list stands alone, and the same note may be referenced by both parent and child
   (that is the reference model still working). No cascade ever runs from a project to an item —
   not on archive, not on delete, not on reparent. If a future change proposes item ownership, it
   contradicts this amendment and both ADRs, and requires a new ADR.

**Why this is the honest form of the answer:** the alternative phrasings are both worse. Claiming
there is no tension ("hierarchy of containers is simply unrelated to hierarchy of items") ignores that
`parent_id` genuinely makes a project an owner, which is the thing §3.1 was written against. Claiming
the tension is unresolved would block the build on a question already answered by the operator's own
data. So: named, scoped, and capped — ownership at the container layer, references at the content
layer.

## A1.10 Findings this amendment records rather than resolves

1. **ADR-0001's header contradicted its own body; corrected in this change.** The header read
   "Status: **PROPOSED — awaiting operator approval (Phase 2 hard stop)**" while line 51 records
   "APPROVED DECISIONS (Phase 2 gate passed 2026-06-12)", `plan.md` records Phase 2 as **APPROVED
   2026-06-12**, and `checklist.md` line 18 still shows "**Operator approves D1–D5** ← BLOCKING" as
   unchecked. Body evidence wins; the header is corrected, and this note records that three places
   disagreed. (The checklist's unchecked box is a stale V1 artifact — not corrected here, because
   ADR-0018 §Reconciliation already documents the V1 checklist as describing a build this repo does
   not contain.)
2. **The operator's "migrations are forbidden; apply by manual psql" direction diverges from the
   repo's written database rule** (`.agents/rules/database.md`: schema changes go through
   generate→migrate; hand-applied `psql` migration SQL is explicitly prohibited). The direction is
   followed, because it is the operator's, and **flagged here rather than silently normalised** — a
   reader comparing this script to `database.md` would otherwise conclude someone broke the rule.
   The script is written to the spirit of the rule it displaces: idempotent, forward-only, additive,
   catalog-verified.
3. **ADR-0001 is superseded by ADR-0018 for the V2 placement** (`adr/0018-…` §Supersedes; `plan.md`'s
   banner; the `projects-containers-reconcile` fragment). This amendment is written to ADR-0001 as
   directed and is binding on the Phase 3 build regardless of placement: §A1.6 addresses the live
   `nexalog.projects` table that exists in prod today, and this ADR's D2 (`project_items`) is the
   model those tables implement. **Where ADR-0018's brain-page model wins, the same relationship
   carries as: a `parent: projects/<slug>` scalar in the project page's frontmatter, and
   `parent_slug text` on `nexalog.project_index`** (nullable; a child whose parent does not resolve
   at rebuild is promoted to root and flagged, mirroring ADR-0018's unresolved-member rule). The
   two-level policy, the R1–R5 guard and the rollup rules are identical in both placements. No
   reading of this amendment authorises a second source of truth.
4. **The live tables are unreachable, and this amendment does not change that.** Prod has
   `nexalog.projects` (1 row), `project_items` (0), `project_candidates` (0); there is no
   `app/api/projects` directory and no `app/(app)/app/projects` page, and `project_candidates` has
   **zero references anywhere in the tree**. The import mapping in A1.8 depends on that path being
   built. Stating it so no reader mistakes this design for shipping.
5. **`bookmarkTags` is the precedent cited for `parentId`, but it carries no foreign key** —
   `apps/web/lib/db/schema.ts` declares `parentId: uuid("parent_id")` with no `references()`, and no
   committed DDL for `bookmark_tags` exists in the migration chain at all. This amendment therefore
   follows the precedent's *naming and shape* and deliberately **strengthens** it with a real
   self-FK (A1.6), because here the referenced target is a row — unlike `project_items.item_id`, which
   references a git path or a ULID and cannot carry one. (This is also the technical statement of why
   the item layer and the container layer differ.)

## A1.11 Pre-mortem — how this amendment fails

1. **Hierarchy is set through a path that skips the guard.** The offline-sync mutation route
   (`/api/sync/mutations`) writes `projects` through a field allow-list that does **not** include
   `parentId`, so today it cannot create an edge — but that is a property of a five-item list, not an
   invariant, and `/api/sync`'s pull selects whole rows, so clients will transport the column before
   they understand it. *Fallback:* the guard must be called by **every** write path that can set
   `parent_id`, and the allow-list is the enforcement point to check whenever Projects reaches the
   mobile client; a review checklist item asserts "`parentId` is not in a sync field list unless the
   guard runs there".
2. **The guard passes but the tree renders wrong** (orphan/absent parent, cross-workspace row, a
   parent filtered out by the "active only" default) producing a child that silently disappears.
   *Fallback:* A1.4's rule — a parent row is always rendered for any rendered child, and an
   unresolvable parent renders the row as a root with a note. Never drop a row.
3. **A cycle is created by a race** (read-then-write, no serialization). *Fallback:* accepted for
   single-operator traffic; the recursive read is depth-capped (A1.2) so corruption degrades to a
   bounded render rather than a hung request; the R5 test fixture proves the walk actually works.
4. **Depth creeps** — someone raises the limit by editing the guard without touching the UI or the
   rollup. *Fallback:* `MAX_PROJECT_DEPTH` is a single named constant; its test asserts both the
   policy value and both rejection directions, so raising it is a visible, tested act.
5. **The `//` convention spreads** and the operator keeps writing structure into names that the
   system cannot see. *Fallback:* the import mapping (A1.8) treats `//` as a first-class, tested
   convention rather than an accident; the create/rename flows document it; the review queue is where
   a name-encoded intent becomes a real edge.

## A1.12 Consequences

- **Schema:** one nullable column + one index + one self-FK (plus one optional provenance column) on
  a live 1-row table. Additive, idempotent, no backfill, no data movement, hand-applied by the
  operator. **No migration file, no `db:push`, no `db:migrate`.**
- **Code (Phase 3, not this change):** the guard joins the existing batched-guard module; the digest
  value object gains `subProjects`/`parent`; `MAX_PROJECT_DEPTH` lands in the domain module; the tree
  read is one query. `ProjectIntelligencePort`'s **methods are unchanged**.
- **Costs accepted:** the flat list is gone (every read now has a parent/child decision); the
  container layer now has ownership in it, deliberately (A1.9); a depth limit the schema does not
  enforce, so it must be enforced and tested in exactly one place; one invented `draft` row in the
  import, awaiting the operator's confirmation.
- **Deferred (additive, not built now):** deeper nesting (a policy change, not a migration);
  multi-parent sub-projects (A1.1's rejected alternative, still reachable additively); drag-and-drop
  reparenting; rendered read-only rollup sections; mobile tree UI (ADR-0018 Q6 keeps parity after the
  web ship).
