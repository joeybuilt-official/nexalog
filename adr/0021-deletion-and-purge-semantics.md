# ADR-0021 — Deletion and purge semantics

- **Status**: **Accepted 2026-09-26 — the operator answered all five sub-decisions (Q1–Q5);
  dispositions in §Open questions — operator dispositions.** The approval decides the semantics;
  it is not implementation authority — the v2 export (ADR-0019, Phase 1.4) must exist before any
  purge flow is built, or the grace window's re-download guarantee is empty (§Coupling).
- **Accepted**: 2026-09-26 (operator; dispositions per §Open questions — operator dispositions)
- **Date**: 2026-09-26
- **Number**: 0021 — allocated centrally and re-verified free on `origin/main` immediately before
  this file was written. This repo has had **four** ADR-number collisions because agents picking
  numbers on isolated branches cannot see each other's numbers; allocate centrally, and re-verify,
  for every future ADR.
- **Owner**: operator (every decision below is his; the draft is the agent's)
- **Split from**: `adr/0019-exit-door-data-export.md` — the operator approved that ADR on
  2026-09-26 **for everything except deletion**, and deferred all deletion semantics to this record.
- **Inherits (does not re-open)**: `adr/0019-exit-door-data-export.md` §D4.1 (exporting deletes
  nothing — a download is a read) and §D4.4 (no shadow archive), plus the layer framing in §D4.2.
- **Related**: `adr/0016-passkey-webauthn-identity-root.md` (identity root);
  `db/migrations/0000_nexalog-v2-bootstrap.sql` (the shared-`auth` note — "single login universe");
  `adr/0018-projects-reference-based-containers.md` (deletion never cascades to a member);
  `docs/claude/in-progress.d/pkm-expansion-tiers.md` (the queue fragment for the exit door).

## Context

`adr/0019-exit-door-data-export.md` (the exit door) settles the **export** half of the problem:
what "the data" is, how it leaves as a bundle, how it is delivered, and what is excluded. It does
**not** settle what happens to the server's copy, and the operator's 2026-09-26 approval
deliberately did not decide that half. The deletion questions have dependencies Nexalog does not
own alone — a shared identity schema across the Joeybuilt apps, a git repository whose history is
not modified by removing a file, and a legacy store whose production contents are still
unverified.

This ADR exists to decide that half. It records what ADR-0019 already establishes (inherited, not
re-opened), what must newly be decided, and the options and recommendations carried forward. It
**decides nothing** the operator has not decided — where it repeats an ADR-0019 recommendation,
that is a recommendation, not a decision.

## Inherited from ADR-0019 §D4 — accepted, not re-opened

- **D4.1 — Exporting deletes nothing.** A download is a read. Conflating export with deletion
  means one misclick can destroy the account, and the house rule already forbids single-click
  destructive actions (`apps/web/app/inbox/review-actions.tsx` made *reject* two-step for exactly
  this reason).
- **D4.4 — No shadow archive.** The export side must not retain a second copy of the data as a
  side effect: no cached export artifact, no staged archive kept "just in case". If the async
  delivery path (`adr/0019-exit-door-data-export.md` §D3.3) is ever built, its staging file is
  deleted the moment delivery completes, as a designed step.
- **The layer framing.** Deletion has to be described in layers, because the layers are not the
  same act: app-state (`read_state` rows, `api_tokens`, export-job staging), content (the brain
  git repo), the identity (the shared `auth` schema), and derived data (`capture_index` rows and
  the GBrain re-sync, which fall out of the above).
- **The context facts §D4 rests on** (all unchanged): the brain git repo is the system of record
  (`BRAIN_REPO=/repo`; captures as `inbox/<ulid>.md`, pages as `<type>/<slug>.md`, binaries as
  `attachments/YYYY/MM/*`); content files carry **no user id**, so "delete user X's content" is
  not expressible from the repo; and the deployment is configured single-operator — **confirmed
  single-user by the operator on 2026-09-26**, which is what makes whole-repo = whole-account
  true and whole-repo deletion available.

## Decisions required (answered by the operator 2026-09-26 — dispositions in §Open questions)

### Q1 — The two-step flow. What exactly does "delete my account" ask the user to do?

Carried forward: ADR-0019's recommendation is that requested deletion is two-step (type/confirm),
never a single click, matching the house rule against single-click destructive actions.
Undecided at drafting — **decided 2026-09-26: typed confirmation; disposition 1.**

### Q2 — The grace window. How long, and what still works during it?

Carried forward: ADR-0019 recommends a 7–30 day window during which the account still works and
the export is re-downloadable. Undecided: the length, whether the account is read-only or fully
usable during the window, whether the window is cancellable, and what happens to anything the
worker captures while it runs. **Decided 2026-09-26: 30 days, fully usable, cancellable,
worker keeps capturing; disposition 2.**

### Q3 — The git-history disclosure. Removing a file does not remove it from history.

Because the system of record is a **git repository**, removing a file deletes it from the working
tree, not from history: `git log` still serves the content, and every existing clone (the
container, the operator's machine, gbrain's bind-mount) still holds it. The options carried
forward are: **(a)** accept and **disclose** that prior versions remain in history until a rewrite;
**(b)** rewrite history (`git filter-repo`-class), which invalidates the shared history and breaks
every clone — a step this repo has previously recommended against for its own housekeeping; or
**(c)** for a single-user deployment, delete the repository and start a fresh one. ADR-0019
recommends (a) as the stated behaviour with the consequence written into the deletion UI, plus (c)
offered now that single-user is confirmed. **Decided 2026-09-26: (a)+(c), (b) rejected;
disposition 3.**

### Q4 — The shared `auth` identity and its cross-app blast radius.

The `auth` schema is shared with the other Joeybuilt apps (one login universe; the v2 bootstrap
SQL forbids forking it). Deleting the identity therefore affects more than Nexalog. Undecided:
does "delete my account" mean the identity is **deleted everywhere**, or **deactivated for Nexalog
only** — and is that decision the operator's alone or does it belong to the fleet? (This is
ADR-0019's open question 4, carried forward unchanged.) **Decided 2026-09-26: split ownership
— disposition 4.**

### Q5 — Is the legacy v1 content store in scope for deletion?

The carried-over v1 routes read the 34-table v1 model in `apps/web/lib/db/schema.ts`, and the
**2026-09-26 read-only production inspection resolved the store question**: prod's `nexalog_v2`
holds **only the 3 v2 app-state tables** (`api_tokens`, `capture_index`, `read_state`) and **no v1
content tables at all**, while the entire v1 model — all 34 tables, with live data (3,769 notes,
4,446 `capture_sources`) — lives in the **shared `pushd` database's `nexalog` schema**. So the
deletion surface is unambiguously **two stores in two databases**, and the v1 store is the shared
one.

What is **still undecided here is the policy**, not the topology: whether deleting a Nexalog account
touches the `pushd` content at all, and what happens to the shipped v1
`apps/web/app/api/export/route.ts` — which reads through the same `{ db }` → `DATABASE_URL` path as
the five stopped-up routes, so it **42P01s against the deployed configuration** and is not a working
content export. Both are part of the **retire, staged** direction the operator chose for queue row 5.
**Policy decided 2026-09-26: out of scope — disposition 5.**

## Open questions — operator dispositions (approved 2026-09-26)

Approved 2026-09-26: the operator answered all five sub-decisions. Each disposition records the
decision; the option analysis above each question stands as its rationale. The approval decides
semantics and is **not** implementation authority: the v2 export (ADR-0019, Phase 1.4) must exist
before any purge flow is built — a purge shipped first has an empty grace window.

1. **The two-step flow (Q1).** — **Decided: typed confirmation.** The user types the account's
   sign-in identifier on a review screen, then confirms. Single click stays excluded by the
   inherited house rule (D4.1); a click-through two-step was judged insufficient friction for the
   one unrecoverable act in the set. The review screen states, in one view: the layers deleted, the
   purge date, the Q3 history disclosure, that export deletes nothing and stays re-downloadable
   during the window, and that the request is cancellable. The five-point screen list is part of the
   decision (proposed in the decision brief, accepted by the operator); exact wording is tunable,
   the five facts are not.
2. **The grace window (Q2).** — **Decided: 30 days, fully usable, cancellable at any time,
   worker keeps capturing.** The window is the only reversible stage between request and purge, so
   it takes the long end of the carried-forward 7–30 range; no read-only mode is invented (the ADR
   describes none, and it would add state for no benefit); a grace window that cannot be exited is
   not a grace window, so cancellable; a worker freeze would need a queue/drop policy the ADR does
   not describe, so captures continue. The purge is a point-in-time whole-repo act: everything
   present at the purge date goes. The Q1 screen carries the honest line — anything captured during
   the window is destroyed at purge unless re-exported or the request is cancelled.
3. **Git history (Q3).** — **Decided: (a) disclose, as the shipped behaviour and wording, plus
   (c) delete-and-fresh as the purge mechanism. (b) rewrite is rejected.** Disclosure is
   non-negotiable: the product copy is the contract, and a deletion flow that quietly leaves content
   in history is worse than one that says so. Delete-and-fresh achieves what rewrite is usually
   chosen for — the server no longer holding the history — by replacing the repository instead of
   rewriting it, at no cost to any clone; (b) breaks every clone and contradicts this repo's own
   housekeeping precedent. Known gap carried into implementation: what delete-and-fresh does to each
   named clone (the container, the operator's machine, gbrain's bind-mount) is not enumerated here,
   so the UI may claim only what will be verifiably true after the purge.
4. **The shared `auth` identity (Q4).** — **Decided: split ownership.** "Delete my account"
   **deactivates the identity for Nexalog only**, performed by Nexalog's flow; erasing the identity
   from the shared login universe is a **separate, fleet-level act** the fleet owns, and the deletion
   UI must state the difference — the copy must not imply fleet-wide erasure (that over-promise is
   the trust bug ADR-0019 names). Nexalog's deletion surface is exactly the layers Nexalog owns:
   app-state, content (whole-repo, available), derived data; the identity is a dependency, not a
   possession. This disposition is the template the other Joeybuilt apps inherit. First
   implementation question: the mechanism for app-scoped deactivation — whether the shared schema
   can express it or Nexalog keeps its own state — constrained by the ban on forking `auth`.
5. **The legacy v1 store (Q5).** — **Decided: out of scope, stated as such.** A Nexalog deletion
   flow must **not** delete from `pushd.nexalog` — the shared database is another app's dependency,
   not a Nexalog possession, and the same cross-boundary reasoning as Q4 applies to it. The copy
   names the legacy store as separate so the expectation is set at request time. The store's
   eventual fate rides the operator's **retire, staged** direction (queue row 5): when that lands,
   the store stops existing rather than being deleted by this flow. Honesty costs nothing here — the
   approved v2 export never reaches `pushd`, so the v2 deletion surface is already complete for
   everything the export can carry.

**Still open after this approval (recorded so nothing claims them):** the app-scoped identity
deactivation mechanism (Q4); the per-clone effect of delete-and-fresh (Q3); an `export_events`
retention rule (ADR-0019 §Verification 4 requires the audit record to survive the purge; neither
ADR states one); and whether anything besides the signed-in user — e.g. an agent holding an
`api_token` — may request deletion (the export-side twin, ADR-0019 Q8, remains open).

## What this ADR deliberately does NOT decide

- It does not re-open D4.1 or D4.4 — those are approved in `adr/0019-exit-door-data-export.md`.
- It decided none of Q1–Q5 before the operator's 2026-09-26 approval; where it repeats an
  ADR-0019 recommendation, that was a recommendation carried forward for the operator's
  consideration. The approval answers all five (§Open questions — operator dispositions).
- It commits to no implementation: no route, no UI, no migration, no schema change, and no DB
  command of any kind.
- It does not set a timeline, and it does not gate the export half of the exit door — Phase 1.4's
  scope and format proceed under `adr/0019-exit-door-data-export.md` regardless of this record.

## Out of scope

- **Export, portability and the bundle format** — settled by
  `adr/0019-exit-door-data-export.md`.
- **Local-first / offline sync and CRDT, zero-knowledge encryption, re-import** — see
  `adr/0019-exit-door-data-export.md` §Out of scope; unchanged.
- **`nexalog_v2` migration provenance** — the repo-wide DDL question being closed by the read-only
  inspection; this ADR consumes its answer (Q5) rather than deciding it.
