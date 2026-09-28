---
id: projects-containers-reconcile
title: Projects — reference-based containers (ADR-0018 APPROVED 2026-09-26; Phase 3 split — core slice may start, migration slice held)
status: open
area: platform
order: 3
risk: operator-confirm
---

First-class Nexalog Project grouping over existing notes/bookmarks by **reference**, with a living
doc and a lifecycle.

**The contradiction is resolved. Verdict: Projects is NOT shipped in this repo — the plan doc was
wrong, the roadmap was right.** `docs/claude/platform/projects/plan.md` carried "SHIPPED + LIVE @
2026-06-12", which is **true of the V1 app at `/srv/nexalog-v1` and false of this tree**.
Commit `1866c2c` (§1.7 deletions) removed every Projects route and page plus `lib/plexo.ts` — the
client ADR-0001's D3 brainstorm contract was built on. What survives is remnants: dead V1 migration
SQL (`drizzle/0012`, `0015`), an orphaned `lib/projects/{domain,store}.ts` with **no importer**, its
still-passing tests, and three `schema.ts` declarations — of which `schema.projects` is **not** dead,
because the live offline-sync routes reference it (`/api/sync`, `/api/sync/mutations`). The plan doc
now carries a ⚠ banner saying exactly this, and `roadmap.md` + `in-progress.md` row 3 agree.

**Phase 2 is CLOSED — the operator approved on 2026-09-26.** `adr/0018-projects-reference-based-containers.md`
is now **Accepted** and carries the dispositions of its six questions in §Operator decisions:
Q2 (member kinds), Q3 (living doc as the page body, one commit per save), Q4 (keep the V1 remnants
until Phase 5) and Q6 (web-first; parity after) all take the ADR's own defaults. Q1 (approve/reject)
is approved. The deliverables for the record are `docs/claude/platform/projects/design.md` and
ADR-0018, which supersedes `platform/projects/adr/0001-nexalog-projects.md` (V1-era, Postgres-first).

**Q5 — `nexalog_v2` provenance — was ANSWERED 2026-09-26** by the read-only production inspection
the approval called for: `nexalog_v2` holds only the 3 v2 app-state tables and **no v1 content at
all**, so Projects DDL there is a `CREATE`, never an `ALTER` — the hold on the migration slice is
released for the DDL question. The **data** half (Projects' member content lives in `pushd.nexalog`)
folded into queue row 5 and the operator's **retire, staged** direction. Shape of Phase 3 now:

- **May start now:** the pure `packages/core` slice — domain (`LifecycleState`, `MemberRef`),
  contracts, use cases, port declarations. Zero-dep, testable with fakes, cannot be wrong about what
  Postgres holds.
- **HELD until Q5 lands:** the migration, the Drizzle adapter, the composition wiring, and the
  routes. No Projects migration can be generated while the `CREATE`-vs-`ALTER` question is open.

**Decisions settled** (unchanged): a project **is** a brain page (`projects/<slug>.md`, `type:
project`, body = living doc, `members:` = flat `"<kind>:<ref>"` strings); membership is a repository
reference, never a DB row id; two **derived, rebuildable** index tables in the `nexalog` PG schema
(never `public`) — `project_index` + `project_members` — reconcile exactly like `capture_index`;
integrity is enforced on write, reconciled on rebuild, and surfaced when broken (no FK is possible
on a git path); lifecycle `draft → active → archived` in a pure domain function; deletion never
cascades to members; the domain lives in `packages/core` (pure, zero-dep) behind ports, not in an
`apps/web/lib/` slice.

**Nothing shipped by this change: no migration written, no `packages/`/`apps/` source touched, no
deploy.** Phase 5 remains operator-gated (push target + deploy + prod migration), and retiring the
V1 remnants stays inside it.

**Next step:** run the read-only `nexalog_v2` inspection to close Q5 (it is the same unknown as the
exit door's Q5), then start Phase 3 on the pure `packages/core` slice — design `§10` phasing, ship
gate `pnpm typecheck` + `pnpm depcruise` + `pnpm test` + `pnpm build` all green.

---

## 2026-09-27 — AMENDMENT A1: sub-projects are in scope (operator directive)

The operator directed hierarchy support before Phase 3 build: **project → sub-project, two levels**.
The decision record is **Amendment A1 appended to `docs/claude/platform/projects/adr/0001-nexalog-projects.md`**
(§A1.1–A1.12), with matching edits to `design.md` (§3.1 note, §3.2, §3.5, §7, §8, §11), `plan.md`
(banner) and this fragment. Locked by the operator: **representation = `parent_id` self-reference**
(one parent, strict tree; reference-based multi-parent via `project_items.item_kind='project'`
recorded as the rejected alternative), **depth = two levels, policy-enforced in the validated write
path** (never a trigger, never a CHECK — a CHECK cannot see another row).

Settled in A1: cycle prevention as one batched guard (R1–R5, including a `WITH RECURSIVE` ancestor
walk, covered by a test) following the `filterOwnedRefs` pattern; lifecycle = **no cascade** —
children keep their state, the UI badges and offers an explicit bulk archive, and an archived parent
is still rendered for any rendered child; living-doc rollup = **computed, never written back** — the
digest value object gains `subProjects`/`parent` and the port's methods do not change; DDL = additive,
idempotent, **manual `psql` only** (`parent_id` + self-FK `ON DELETE SET NULL` + index + optional
`import_ref` unique), with no migration file and no `db:push`/`db:migrate`; UI = a two-level tree in
the existing authed shell; import = the flat 37 land as 35 roots + 1 synthesized `draft` parent + 2
`//`-derived children, with **inferred structure routed through `project_candidates`** for review
while the mechanical mapping imports directly.

Also corrected in the same change: ADR-0001's header read "PROPOSED — awaiting operator approval"
while its own body, `plan.md` and `checklist.md` recorded the gate as passed 2026-06-12; the header
now agrees with the body, and the disagreement is recorded (A1.10 Finding 1). A1.10 Finding 3 records
the ADR-0001↔ADR-0018 supersession and carries A1 into the brain-page placement as
`parent: projects/<slug>` + `parent_slug`. **Nothing shipped: docs only — no code, no migration file,
no DB command, no deploy.**
