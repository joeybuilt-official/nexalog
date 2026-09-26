# ADR-0021 — Deletion and purge semantics

- **Status**: **Proposed — awaiting operator approval. Nothing in this ADR is decided.**
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

## Decisions required (NOT decided — awaiting the operator)

### Q1 — The two-step flow. What exactly does "delete my account" ask the user to do?

Carried forward: ADR-0019's recommendation is that requested deletion is two-step (type/confirm),
never a single click, matching the house rule against single-click destructive actions.
Undecided: the exact confirmation mechanics, the wording, and what the UI says happens next.

### Q2 — The grace window. How long, and what still works during it?

Carried forward: ADR-0019 recommends a 7–30 day window during which the account still works and
the export is re-downloadable. Undecided: the length, whether the account is read-only or fully
usable during the window, whether the window is cancellable, and what happens to anything the
worker captures while it runs.

### Q3 — The git-history disclosure. Removing a file does not remove it from history.

Because the system of record is a **git repository**, removing a file deletes it from the working
tree, not from history: `git log` still serves the content, and every existing clone (the
container, the operator's machine, gbrain's bind-mount) still holds it. The options carried
forward are: **(a)** accept and **disclose** that prior versions remain in history until a rewrite;
**(b)** rewrite history (`git filter-repo`-class), which invalidates the shared history and breaks
every clone — a step this repo has previously recommended against for its own housekeeping; or
**(c)** for a single-user deployment, delete the repository and start a fresh one. ADR-0019
recommends (a) as the stated behaviour with the consequence written into the deletion UI, plus (c)
offered now that single-user is confirmed. **Undecided.**

### Q4 — The shared `auth` identity and its cross-app blast radius.

The `auth` schema is shared with the other Joeybuilt apps (one login universe; the v2 bootstrap
SQL forbids forking it). Deleting the identity therefore affects more than Nexalog. Undecided:
does "delete my account" mean the identity is **deleted everywhere**, or **deactivated for Nexalog
only** — and is that decision the operator's alone or does it belong to the fleet? (This is
ADR-0019's open question 4, carried forward unchanged.)

### Q5 — Is the legacy v1 content store in scope for deletion?

The carried-over v1 routes still read the 34-table v1 model in `apps/web/lib/db/schema.ts`.
Whether prod's `nexalog_v2` still holds that content is **a production fact this ADR does not
verify** — it is being closed by a **read-only production inspection, not assumed from the repo**
(the same unknown as `adr/0018-projects-reference-based-containers.md` operator question 5 and
`adr/0019-exit-door-data-export.md` open question 5). Until that answer lands, this ADR cannot say
whether the deletion surface covers one store or two, nor the fate of the shipped v1
`apps/web/app/api/export/route.ts`. **Undecided.**

## Open questions for the operator

1. Do you accept the two-step flow as the shape (Q1), and with what confirmation mechanics?
2. What grace window do you want (Q2), and what should still work during it?
3. Which git-history behaviour do you want (Q3): disclose, rewrite, or fresh repo?
4. Identity (Q4): delete everywhere, or deactivate for Nexalog only — and whose call is it?
5. When the read-only inspection lands, is the legacy v1 store in deletion scope (Q5)?

## What this ADR deliberately does NOT decide

- It does not re-open D4.1 or D4.4 — those are approved in `adr/0019-exit-door-data-export.md`.
- It does not decide any of Q1–Q5. Where it repeats an ADR-0019 recommendation, that is a
  recommendation carried forward for the operator's consideration.
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
