# in-progress.d — the committed task queue (one fragment per task)

This is the durable queue named by `PANOPLY-OPTIMIZATION.md` §1a. **One file per task**, frontmatter +
body:

```markdown
---
id: <slug>              # matches the filename
title: <short title>
status: open | in-progress | blocked | done
area: <area folder under docs/claude/>
branch: <task/… | wt/… | feat/…>   # the branch the work lands on
order: <int>            # optional
risk: operator-confirm  # optional — data-loss / irreversible-prod
---

<what the task is>

**Next step:** <the exact next action — file to open, command to run, blocker>
```

The rendered `docs/claude/in-progress.md` is a **view** of these fragments (read it; do not
hand-maintain the active rows). A fragment is deleted in the same PR that ships its code, and a
`completed-features.md` row is added there.

Sweep: `~/.claude/phalanx-docs-reconcile.sh <repo>` (dry run) classifies every fragment by its PR
state; `--apply` retires the merged ones. This repo has **not** run the migration sweep, and its
Phalanx loop still reads the root-level `TASKS.md` — so the fragments here are the durable record
while `in-progress.md` is still hand-maintained. Keep both consistent until the sweep lands.

> **Do not confuse these with the root-level `TASKS.md` / `PROGRESS.md`.** Those are machine-local
> Phalanx loop state (untracked and gitignored — they belong to the machine, not the repo) and are
> not the backlog; nothing should plan against them.

**Provenance.** This directory was created 2026‑09‑19 during the Panoply re-adapt. nexalog previously
had a `roadmap.md` but no queue at all, so these fragments are a first reconstruction from
`roadmap.md`, the three existing plan docs under `docs/claude/platform/`, and the root-level
`HANDOFF.md` / `checklist*.md` scratch files. Statuses inferred from a plan doc's own last-written
status line are marked *(unverified)* — re-check against `main` before starting the work.
