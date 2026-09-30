# Documentation & Memory

> **Applies when:** always — this defines where project knowledge lives and how it survives context compaction.
> **Delete this file (and its `@` import in `CLAUDE.md`) if:** never. If the project keeps its knowledge base elsewhere, retarget the paths rather than dropping the module.

## Two tiers of memory

- **`docs/claude/` — team-shared, committed to git.** Facts about the project that any contributor or agent needs: what is being built now, what shipped, why the architecture is the way it is, and the patterns and gotchas that cost someone a day to learn. If a teammate would benefit, it goes here.
- **`~/.claude/` — personal, never committed.** Individual preferences, machine-local setup, per-user workflow habits. Keep it out of `docs/claude/`, because personal preference presented as project doctrine misleads everyone else on the team.

The distinction is not about secrecy, it is about durability: committed docs are versioned alongside the code they describe, so they can be reviewed, corrected, and blamed.

## Read order (start here, in this order)

1. **`docs/claude/in-progress.d/`** — the queue, ONE FILE PER TASK, each carrying that task's status and its exact next step. Always read this first; it tells you what the current work actually is, which is the one thing a fresh context window cannot infer from the code. `docs/claude/in-progress.md` is a GENERATED table view of the directory — read it if the repo renders one, but never edit it.
   > **Nexalog is mid-migration on this.** The fragment set under `docs/claude/in-progress.d/` is the durable record, but `in-progress.md` is still tracked and hand-maintained — the Phalanx reconcile sweep has not run here and the loop still reads its own machine-local state. Treat them as two views of one queue and keep them consistent until the sweep lands; do **not** delete or untrack `in-progress.md`.
2. **`docs/claude/architecture.md`** — the decisions and their reasoning, so you extend the design instead of re-litigating it.
3. **`docs/claude/key-patterns.md`** — conventions, gotchas, and testing practice, so your code matches what is already there.
4. **`docs/claude/infrastructure.md`** — deploy pipeline, hosting, data stores, secrets, background jobs. Read before touching anything that runs outside the dev machine.
5. **`docs/claude/completed-features.md`** — what already exists, so you do not rebuild it.
6. **The relevant area folder** (e.g. `docs/claude/<area>/…`) — active plans and research for the feature you are working on.

Read the specific files that bear on the task, not all of them every time. But never start non-trivial work without at least `in-progress.d/` and the area folder for the thing you are changing.

**Decisions have a long form in this repo.** `docs/claude/architecture.md` is the index; the full record is a numbered ADR at `adr/NNNN-slug.md` — `0001-audit-methodology.md` … `0023-chat-surface-hosted-here-turn-hosted-there.md`. Read the ADR when the index row touches what you are changing; the *why* is there and is not reconstructible from the code.

## The always-current plan & worklog

Four artifacts, four altitudes. Each owns ONE fact-granularity; nothing restates another, so nothing
drifts. This is the anti-redundancy contract — keep to it and the logs cannot contradict each other.

| Altitude | File | Owns | Granularity |
|---|---|---|---|
| Strategic | `docs/claude/roadmap.md` | Initiatives, their band (Now/Next/Later), links down | one initiative |
| Tactical | `docs/claude/in-progress.d/<slug>.md` (one file per task) | The active queue, blocked, parked, per-task Next step | one task/feature |
| Continuous | `docs/claude/worklog.md` **or** the repo's `CHANGELOG`/`HISTORY` `[Unreleased]` | What actually landed | one change |
| Durable | `docs/claude/completed-features.md` | What now exists + its archived plan path | one shipped feature |

A fifth surface, `CHANGELOG.md`/`HISTORY.md` release notes, is **user-facing and derived** — curated
from the worklog at release time, not maintained per-change in parallel. If the repo uses its
`[Unreleased]` section AS the running worklog, there is no separate `worklog.md` (one running log, never two).

**This repo's worklog target is `docs/claude/worklog.md`.** There is no `CHANGELOG.md` and no
`HISTORY.md` here, and do not start one — a second running log splits the record, and `check-docs.sh`
auto-detects the target, so adding one would silently move the gate.

### The same-change update contract (every agent, every provider)

In the SAME commit that lands work — Claude, Codex, Cursor, or any other tool:

1. **Append one worklog line** (to `worklog.md`, or the `[Unreleased]` section) — what changed, where.
2. **Write your task's own fragment** — `docs/claude/in-progress.d/<slug>.md` — with its status and its
   Next-step handoff, or **delete the fragment** on ship — in the SAME PR that ships the code, never
   later (a fragment that outlives its merge is planned against as if still open; leftovers are
   retired from PR state with `phalanx-docs-reconcile.sh`). Never edit a shared table: the queue is one file
   per task precisely so two open PRs cannot collide on it, the same reason the worklog is one file per
   change. `docs/claude/in-progress.md` is a generated view — do not edit it, and do not commit it.
   *(While this repo is mid-migration, item 2's "generated view" half does not hold yet — see Read order
   item 1. Update both, and do not add a new hand-maintained row that contradicts its fragment.)*
3. **On ship**, additionally: add the `completed-features.md` entry, MOVE the `roadmap.md` initiative
   (to Shipped if this was its last plan), and archive the plan folder.
4. **On a new or reprioritised initiative**: add or move its `roadmap.md` row.

This contract is plain-markdown, enforced by review and `/audit-claude-setup` — never a Claude-only
permission gate, so it binds a non-Claude agent exactly as much as a Claude one. It is mirrored into
`AGENTS.md` so every tool reads it. **Shipped-but-unlogged counts as not done** (see below).

### The queue is the ONLY backlog — autonomous drivers included

A project has exactly one answer to "what is next", and it is this directory. An agent that keeps its
own private list — an untracked `TASKS.md`, a session database, a scratch file — has created a second
backlog that nobody else can see, and within a day the two disagree about what is done.

So the fragment is written to be **driven, not just read**. Frontmatter carries what a driver needs;
the body carries what a human needs:

```markdown
---
id: <slug>
status: open | in-progress | blocked | done
order: <int>            # optional; ties break by filename
req: <request-id>       # optional; set by a request-scoped seed
risk: operator-confirm  # optional; data-loss or irreversible-prod work, never auto-executed
---

<what the task is>

**Next step:** <the exact next action — the file to open, the command to run, the blocker>
```

`status` is the queue state (a `- [ ]` checkbox by another name). `risk:` is a halt flag: a driver
stops and asks rather than executing it. **Next step** is the handoff a cold session resumes from, and
it is the one line always worth writing — the person who needs it cannot reconstruct where you stopped
from the code alone.

This is the same contract Phalanx's autonomous loop adopted in its ADR-0004, so a task seeded by the
loop and a task written by hand are the same file. A committed queue is also the only kind a reviewer,
a diff, or a non-Claude agent can see at all.

**`TASKS.md` / `PROGRESS.md` / `HANDOFF.md` at the repo root are not this queue.** They are
machine-local Phalanx loop state — untracked and gitignored. Never plan against them, never `git add`
one back, and never delete one to "clean up": a running loop reads it.

### The landing gate — mechanical enforcement

The contract's deterministic core is enforced by `scripts/check-docs.sh`, which fails any commit that
changes a non-markdown file (source, config, schema, scripts, CI) but not the worklog target in the
same commit. It runs in required CI (`scripts/templates/ci-verify.yml`) and the pre-commit hook, so it
binds every agent in every tool — the provider-neutral floor. The gate enforces **presence**, not
**correctness**: a vague or wrong worklog line passes. Correctness is a review problem, not an
automation problem — the honest limit of any git-native kit. The worklog target is auto-detected
(`CHANGELOG.md`/`HISTORY.md` `[Unreleased]`, else `docs/claude/worklog.md`), overridable via
`DOCS_WORKLOG`.

**Nexalog's copy carries one addition the kit template does not:** a sweep of every tracked file for
unresolved merge-conflict markers. It belongs here because this gate runs in required CI — a marker
committed into a shipped file is a worse outcome than a red check, and nothing else in the pipeline
looks for one. Keep it if you ever re-sync the script from the kit.

## When to write

- **When a plan is made** — persist it to a file under the area folder, from `docs/claude/_templates/plan.md`, and link it from your task's `in-progress.d/` fragment. Plans that live only in chat are erased by compaction.
- **During the build, at the moment of discovery** — when reality contradicts the plan, record it inline with a `> **Build note:**` line. Written later, it is written wrong; written never, the next person rediscovers it the expensive way.
- **When you pause or hand off** — before you stop, write the *exact next action* where the next session looks first: the **Next step** line of your task's `in-progress.d/` fragment, or the `Next step` line of the plan doc for a multi-session feature. Not a topic ("continue the auth work") — the file to open, the function to change, the command to run, the blocker. A cold session resumes from this and nothing else, so it is the one note always worth writing: the person who needs it is not you, and cannot reconstruct where you stopped from the code alone.
- **When a decision is made that a future reader would otherwise question** — add an ADR entry at `adr/NNNN-slug.md` (the next free number in the existing chain), and a one-line row pointing at it in `docs/claude/architecture.md`. The trigger is "someone will wonder why we did this," not "this was hard."
- **Always ADR-worthy: anything that moves a layer boundary or introduces a port.** A new port and the adapter behind it, a rule relocated between layers, a Detail swapped out (database, framework, vendor), or a deliberate decision to let one layer know about another. `lib/intelligence/` is this repo's worked example — `adr/0014-intelligence-port-adapters.md`, `adr/0015-adapter-mesh-protocol.md`, `adr/0017-retire-plexo-exclusive-intelligence.md`. The reasoning is invisible in the diff six months later, so without the entry the next person re-litigates a decision that was already made carefully. See `clean-architecture.md`.
- **When you get burned by a non-obvious behavior** — add it to `key-patterns.md` as a gotcha, with the symptom, not just the fix. The next person will arrive with the symptom.
- **When infrastructure changes** — update `infrastructure.md` in the same PR as the change. Infra docs that lag the infra are worse than none, because they are trusted.

Update the doc in the same PR as the code it describes. A "docs pass later" never happens. **Shipped-but-unlogged counts as not done:** if it is live and the log does not show it, the task is unfinished — finish it by writing the record. The first time the log lags reality, every reader stops trusting it and re-reads the code instead, which is the exact cost this whole file exists to avoid.

## When to archive

After a feature is tested and signed off:

1. Move its entire folder — plan, research, references, everything — into that area's `completed/` subfolder.
2. **Rename the files to describe what shipped**, not generic `plan.md`. A folder of six files named `plan.md` is unsearchable.
3. Add an entry to `completed-features.md`: what shipped, when, and the archived path.
4. Delete the task's `in-progress.d/` fragment (and its row in `in-progress.md` while the two are still hand-kept in step — see Read order item 1).
5. Update any closed issue or milestone descriptions that pointed at the old paths.

Archive, do not delete. The reasoning behind a shipped feature is the context for the next change to it.

## Hygiene

- One fact, one home. If something belongs in `architecture.md`, do not also paste it into a plan file — copies drift, and a reader cannot tell which copy is current.
- **`completed-features.md` is the feature narrative, not a changelog.** It records what a user or
  caller can now do, plus the archived plan path. If the repo keeps a `CHANGELOG.md`/`HISTORY.md`,
  that stays the release/commit line; `completed-features.md` may reference a release but never
  restates the commit log. One fact, one home — across both files, and across the four altitudes above.
- Correct stale docs on sight. Finding an out-of-date statement and leaving it there makes you the reason the next person trusts it.
- Keep entries short and dated. These files are read under context pressure; a wall of prose gets skimmed and misread.
