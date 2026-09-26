---
id: second-brain-remediation-p05
title: Second-brain remediation — Phase 0.5/0.6 deploy-gap reconciliation
status: open
area: platform
order: 1
risk: operator-confirm
---

Close the daily-driver-trust gaps in the second-brain pipeline: survive signal loss, recover the
forgotten, and report what it actually did. `roadmap.md` lists this initiative as Now and calls the
current position "P0.5 deploy-gap reconciliation open".

The plan is gate-dense and has an explicit **"Phase 0.5/0.6 immediate next steps (before P1)"**
section plus a separate **"Operator-gated steps (will not run autonomously)"** section. Nothing in
Phase 1 should start until 0.5/0.6 is reconciled.

**Next step:** open `docs/claude/platform/second-brain-remediation/plan.md`, read §Operator-gated
steps *first* so you know which steps you are not allowed to run, then work §Phase 0.5/0.6 immediate
next steps in order. Confirm each phase's §Per-phase exit gate before moving on. Verify the plan's
status lines against `main` — they were last written before 2026‑09‑19 and may be stale.
