# Workflow: Change Approval & Planning

> **Applies when:** always — this is the baseline collaboration protocol for every project.
> **Delete this file (and its `@` import in CLAUDE.md) if:** never. If you disagree with a rule, edit it; do not delete the module.

## Pre-flight — before any proposal

You cannot propose a change to a repo whose state you have not read. Before planning anything:

- `git fetch --prune`, then survey branches, worktrees, and open PRs (`git branch -a`, `git worktree list`, `gh pr list --state open`).
- Read the central plan doc (`docs/claude/roadmap.md` in kit repos; the repo's one plan doc where the adapt has set a lighter one), the running worklog, and only then the code you are about to change.
- **Carry forward in-flight work** — continue the queued task or the open PR; never open a parallel track for work already in progress. (Full mechanics: `git-workflow.md` → Pre-flight.)

## Change Approval

- **Describe your proposed changes and get approval before editing code.** State what you plan to change, which files, and why — then stop and wait for confirmation. Editing first and explaining after removes the user's only cheap moment to redirect you.
- **Write the plan into the plan doc and present it before code.** The plan states the goal in one sentence, the phases, and the exit criteria, and it is presented to the owner for an explicit yes/no — in plain language, written for a non-technical reader. A plan that lives only in the chat summary was never approved.
- **This applies to bug fixes exactly as much as to features.** "It's just a fix" is the most common excuse for skipping approval, and fixes are where wrong assumptions do the most damage.
- **Never assume the root cause. State your hypothesis and let the user confirm or redirect.** Say "I believe X is happening because Y — do you want me to fix it there?" rather than silently fixing what you guessed. The user usually knows something about the system you cannot see from the code, and a confident wrong diagnosis costs a full rewrite.
- **Name the layers the change touches** — Entities/Domain, Use Cases/Application, Interface Adapters, Frameworks & Drivers (see `clean-architecture.md`). A proposal written as a list of file paths hides the one thing worth catching early: which way the new dependencies point.
- **If the change would point a dependency outward, raise it before you write it, not after.** At proposal time it is a sentence and a redesign; once the code exists and works, nobody rewrites working code to fix an import direction, and the violation becomes permanent.
- When you find a second problem while fixing the first, surface it — do not fold it into the current change without asking. Scope creep smuggled into an approved change is unreviewable.
- **When the decision is genuinely the owner's, present it as two options plus a recommendation — never as a prose block.** Tappable, decidable in one read: what each option is, what it costs now and later, and which one you recommend and why (`quality-bar.md`). Do not start on either option while the question is open.

### What counts as trivial (no approval needed)

Proceed directly, and mention what you did afterward, when the change is:

- A typo, comment, or string fix with no behavioral effect.
- A one-line change the user explicitly described and asked you to make.
- Formatting, import ordering, or lint autofixes.
- Adding a log line or assertion to diagnose something, with no production behavior change.
- Any change fully contained in a file you were just asked to write.

Everything else — new files, new dependencies, schema/API/interface changes, anything touching more than one file, anything you would need a paragraph to explain — needs approval first. When in doubt, ask; asking costs one message, a wrong rewrite costs an hour.

This carve-out is itself a setting: a project that chose the **strict** protocol at adapt time deletes the list above, and every change — trivial or not — gets described and approved first.

## Planning Workflow

- **A plan is a roadmap row first, never a new directory.** The moment you start work, add a row to the project's `docs/claude/roadmap.md` (Now/Next/Later) — in the same session, even if that row is the only artifact and the plan dies the same day. A dead roadmap row beats a lost plan. Never create a top-level `<name>-plan/`, `<name>-specs/`, or `scratch_*` plan directory; that scatter is exactly what this rule eliminates. Deeper detail goes in `docs/claude/<area>/<slug>/plan.md` inside the repo, linked from the row.
- **The plan doc is the SINGLE place every agent reads and edits plans.** A kit repo's plan home is the `docs/claude/` spine: `roadmap.md` (the single canonical plan doc) with per-task fragments under `docs/claude/in-progress.d/` or area plan docs linked from it. A project too small for that spine may keep ONE lightweight `docs/PLAN.md` (a status table + the worklog) as its plan home — same rule, fewer pieces. What is never the plan home: a root-level `PLAN.md` (that is the stray `check-plan-home.sh` exists to reject), a second parallel plan doc, and **GitHub Issues** — an issue is a note that gets folded into the plan doc, never the doc itself. Before planning anything, read it; when you plan anything, write there. `scripts/check-plan-home.sh` enforces this in CI and pre-commit (`PLAN_HOME_ALLOW` for a legitimate exception, `PLAN_HOME_OFF=1` while adopting a repo with a backlog).

- **Enter plan mode before any non-trivial or multi-step work.** Any feature, milestone, or task spanning more than a couple of files starts with a plan — use the planning tool, not an informal chat summary, so the plan is an artifact rather than a paragraph that scrolls away. Present it to the owner (plain language, above) and let the plan — not the chat memory — be what was approved.
- **ALWAYS persist the plan to a file under `docs/claude/`.** A plan that exists only in chat context dies at the next compaction, and you will silently resume with a different plan than the one that was approved. The file is the source of truth; the chat is not.
  - Copy `docs/claude/_templates/plan.md` as the starting point.
  - Write it into the relevant area folder, not flat in `docs/claude/` — e.g. `docs/claude/<area>/<feature>/plan.md`. See `docs/claude/_templates/feature-area/README.md` for the folder convention.
  - Link the new plan from `docs/claude/in-progress.md` in the same step, or nobody will find it.
- **When a milestone splits into sub-milestones, do not overwrite the parent plan.** Either nest the sub-milestones inline under their parent, or create a sibling file in the same folder and link to it from the parent. The parent plan must stay readable as a high-level overview — that overview is what a future session reads first to reorient, and flattening it into task-level detail destroys it.
- **Re-read the plan file at the start of each milestone.** Do this even if you "remember" the plan; after a compaction your memory of it is a summary of a summary.
- **Update the plan as work completes** — check off finished milestones, and record deviations inline with a `> **Build note:**` line explaining what you found and why the approach changed. Discoveries made during the build are the most valuable content in the file and the first thing lost if you do not write them down.
- If the work turns out to be materially different from the plan, stop and re-plan with the user rather than improvising forward. A plan that no longer matches reality is worse than no plan, because it still looks authoritative.

## Before you propose

The approval you are asking for is only as good as the proposal. Before you describe a change, run
the self-check in `quality-bar.md` — it governs *what* you propose; this file governs *when and how*
you propose it.

## Expert Review (non-trivial changes)

- **Every non-trivial change requires structured expert review before merge.** Trivial changes (per the list above, plus: single file, ≤15 lines added, no schema/API/interface change, or PR labeled `trivial` / commit prefixed `trivial:`) skip this gate.
- **An agent's self-report is not review evidence.** "Tests pass," "done," and "it works" from the agent that wrote the change verify nothing — authorship and evidence must be independent. Non-trivial work is re-reviewed independently (by a second reviewer or a review agent reading only the diff), and the gate below exists because that requirement is easy to claim and easy to skip.
- **Four default personas must be considered:** Security, Performance, Maintainability, UX. Domain-specific personas may be added per project.
- **Review evidence required (checked by `scripts/check-expert-review.sh` in CI):**
  1. `plan.md` exists for the feature area (persisted under `docs/claude/<area>/...`).
  2. `checklist.md` has ≥1 unchecked item at PR open (proves planning happened).
  3. `adr.md` has a new section since the PR base branch (proves architectural decision recorded).
  4. PR description contains sign-off from ≥2 named personas (e.g., `Security: ✓`, `Performance: LGTM`).
- **Process:** Author drafts plan → opens PR → requests review from relevant personas → each persona comments with sign-off → CI gate passes → merge.
- **Conflict escalation:** If personas disagree on a fundamental trade-off, the ADR records both positions and the decision; the operator (human) breaks ties.
- **No rubber stamps:** A sign-off without reading the diff is a process violation. The adversary-review skill (§16) provides the grading rubric.