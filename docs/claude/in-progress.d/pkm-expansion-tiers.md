---
id: pkm-expansion-tiers
title: PKM expansion Tiers 0–3 (truth, credibility, differentiators, Plexo moat)
status: in-progress
area: platform
order: 2
---

A gate-dense phased arc: Tier 0 truth & cleanup, Tier 1 credibility (table-stakes), Tier 2
differentiators, Tier 3 the Plexo moat. `roadmap.md` records the position as "EXECUTING at fold" —
**unverified**; confirm against `main` before continuing.

Phases are individually tagged `[N]` (no gate, reversible) or `[P]`/⚠ (gated). **Phase 1.4 — data
export / "exit door" was ⚠ GATE: ADR-0002 — and the gate is now CLEARED for scope + format
(2026-09-26).** The ADR is `adr/0019-exit-door-data-export.md`, now **Accepted except deletion**;
all deletion semantics were split out by the operator to `adr/0021-deletion-and-purge-semantics.md`
(**Accepted 2026-09-26** — all five sub-decisions answered; dispositions in its §Open questions).
Deletion implementation is gated behind the export build: no purge flow before the v2 export exists.

**ADR-0019 status (2026-09-26):** `adr/0019-exit-door-data-export.md` is **Accepted for everything
except deletion** — D1 whole-account scope, D2 format (the repo's own files byte-for-byte + a
`manifest.json` with a per-file `sha256`; ZIP via the already-present `archiver`; a `git bundle` as
the **opt-in** second artifact), D3 delivery (stream from the first byte + a configured size cap;
async deferred), D5 the `export_events` record, and D4.1/D4.4 (export deletes nothing; no shadow
archive). **D4.2/D4.3 — the deletion flow, the grace window, the git-history disclosure, the
shared-identity blast radius — were deferred to `adr/0021-*` and are decided there
(Accepted 2026-09-26).** Dispositions of the
eight open questions are recorded in the ADR: Q1–Q4, Q6, Q7 answered (single-user confirmed;
whole-account; git bundle opt-in; stream + cap are the defaults); **Q5 (legacy v1 store in scope)
was ANSWERED 2026-09-26** by the read-only production inspection — `nexalog_v2` holds no v1 content,
the v1 store is the shared `pushd.nexalog` schema, and the approved repo export does not reach it —
and **Q8 (who can export) remains open**. It is numbered **0019** because 0018 was claimed by the Projects Phase 2 design in
the same batch, and because 0002 was already used for this decision on 2026-06-13 and 0009
superseded it on 2026-06-27 — and 0009's version actually shipped (`apps/web/app/api/export/route.ts`,
`85089e0`) against the **v1 Postgres content model**, which the v2 pivot replaced with the brain git
repo. 0019 supersedes 0002 + 0009 *for v2* and leaves both as the historical record.

**Next step:** open `docs/claude/platform/pkm-expansion/plan.md`, read §Operating rules for every
phase, then find the first phase whose exit gate is not yet satisfied and work it. Do not start any
⚠-gated phase. Record what you find in `docs/claude/worklog.md` in the same commit.
