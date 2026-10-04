# Plan: Agent mirrors ship the rule INDEX, not the corpus

- **Area:** `platform`  ·  **Started:** 2026-10-03  ·  **Status:** In progress
- **Owner:** Dustin Olenslager
- **Next step:** run the gates (below) on this change, then merge.
- **Roadmap initiative:** none — a fix inside the existing Panoply mirror pattern, not a new
  initiative. Same change class as the kit's own `governance/context-budget` plan.
- **Spec:** none — this is a **fix inside an existing pattern**, not a structural change to the
  system. The mechanism (`render_index` + a mirror builder) already exists in the kit; this extends
  it to the six generated mirrors that were left behind. No new requirement, no new layer, no
  user-facing surface.
- **Parent plan:** none

## Goal

Every generated single-file agent mirror drops from **~157 KB of inlined rule bodies to an index of
~9 KB**, so a tool that loads one at session start reads something that both fits its loader's cap
and names every rule module. The full rule text keeps exactly one home: `.agents/rules/*.md`.

After this ships: `CLAUDE.md`, `GEMINI.md`, `CONVENTIONS.md`, `.clinerules/00-agents.md`,
`.github/copilot-instructions.md`, and `.windsurf/rules/00-agents.md` each render the preamble plus a
one-line-per-module index; `AGENTS.md`'s `PANOPLY:RULES` block renders the same index instead of the
bodies; and the per-rule `.mdc` files (`.cursor/rules/*.mdc`, `.agents/rules/*.mdc`) still carry each
rule's full body, scoped by the rule's own `Applies when:` line. It worked if the gates below pass
and each mirror is under 10 KB naming all 14 modules.

**Out of scope:** any kit-layout migration; porting the rest of the kit's gate suite; regenerating
committed mirrors (they stay gitignored); a code map.

## Context

The kit this repo adopted (`v1.4.0`) inlines every rule body into every mirror *and* into
`AGENTS.md`'s `PANOPLY:RULES` block. Measured here before the change:

| File | Bytes | Rule bodies inlined | Truncation risk |
|---|---|---|---|
| `AGENTS.md` | 152,016 | yes (+ ~134 KB of bodies) | read whole by Hermes, capped ~20,000 chars |
| `CLAUDE.md` / `GEMINI.md` / `CONVENTIONS.md` / `.clinerules/00-agents.md` / `.github/copilot-instructions.md` / `.windsurf/rules/00-agents.md` | 157,472 each | yes | read whole by their tool, capped by that tool |

Three facts make that shape wrong:

1. **The norm is not the corpus.** A session almost never needs every rule — it needs the two or
   three that govern what it is about to touch. Serving 47 K tokens to reach 8 K of relevance is the
   cost.
2. **`AGENTS.md` is read whole under a hard cap.** Inlining bodies pushed it to 152 KB against a
   ~20 K cap, so the reader got a *silent prefix* — the rules index itself was inside the truncated
   region. A file that is neither small nor complete while claiming both is worse than a small one.
3. **The kit already decided this.** Upstream `panoply@dd696e6` (`fix(kit): truncation budget, and an
   honest statement of what each mirror is`) converted `AGENTS.md` to an index and left the six
   mirrors behind; its own plan records the same reasoning (`governance/context-budget/plan.md`,
   "a file that states the reason inlining fails, then does it five more times"). The `.mdc`
   `alwaysApply` fix from the same commit is what makes the `.mdc` half correct and is included here.

The rule text lives once, under `.agents/rules/*.md`; the mirrors become a map to it.

## Architecture

- **Layers touched:** none — this is `scripts/` tooling plus generated artifacts at the repo edge.
  Nothing under `apps/`, `packages/`, or `lib/` is involved.
- **New ports (interfaces):** none. `sync-agents.sh`'s CLI (`--check` for CI) already exists; the
  `doc-map.sh` CLI (`--json`, `--check`, `--dir`) is a command surface, not an architectural port.
- **Boundary data:** none crossing a layer. The generated index shape is
  `` - `<module>` — <one-line description> — `.agents/rules/<module>.md` ``.
- **Dependency direction:** inward-only by construction — POSIX `sh` + `awk`, no packages. The tools
  cannot introduce a dependency because none is available to them.
- **Swap test:** not applicable — nothing is replaced; the rule bodies keep their single home.

## The Algorithm pass

- **Question** — the repo owner, following the same change landed in the kit: the generated mirrors
  spend ~47 K tokens at session start re-shipping rule text that already has a canonical home, and
  the largest of them is under a loader cap it exceeds. The constraint it serves: **the agent-facing
  surface must fit the harness that reads it, and must name where the rules are.**
- **Delete** — six candidates named below; three deleted outright, two rejected with a replacement,
  one narrowed. The most important deletion is the **second copy of the rule bodies** (in
  `AGENTS.md`): it is the one whose absence nobody notices, because the artifact it leaves behind is
  the lack of a 134 KB block.
- **Simplify** — the least shape: **reuse the kit's existing `render_index()`** in the mirror
  builder rather than write a second index renderer; the `AGENTS.md` refill already had the same
  change upstream, so the two paths converge on one function. The mirror change is a substitution in
  `build_mirror`, not a subsystem.
- **Accelerate** — measured, before → after (this repo):

  | File | Before | After | Factor |
  |---|---|---|---|
  | `AGENTS.md` | 152,016 B | 13,361 B | 11.4x |
  | each single-file mirror | 157,472 B | 10,088 B | 15.6x |

  - **Bottleneck named:** it was never the shell — it was the rule bodies being copied into seven
    files instead of read on demand. The measured rate that matters is *bytes a harness loads at
    session start*. `AGENTS.md` also had to lose the inlined preamble (below) to get under the
    ~20,000-char cap its loader truncates at; the first cut of this change left it at **20,066 B —
    over the cap** — which is why the cap is now a gate rather than an assumption.
- **Automate** — last, and only what survived: the kit's own canary (`doc-map.test.sh`) wired into
  `verify`, and the existing `sync-agents.sh --check` gate. Deliberately NOT automated: a committed
  generated index (it would drift), or a dashboard measuring whether the map helps (no named number
  → no dashboard).

### Deletion candidates

| Candidate | Removed? | Why | What we do instead |
|---|---|---|---|
| The **second copy of the rule bodies in `AGENTS.md`** (the `PANOPLY:RULES` block inlines ~134 KB) | **yes** | Contradicts "one fact, one home" and exceeds the ~20 K cap of the loader that reads it whole, so the middle is silently dropped — a file neither small nor complete while claiming both | `AGENTS.md`'s block renders the index; the bodies stay canonical under `.agents/rules/*.md` |
| The **rule bodies inlined into each single-file mirror** (6 × ~134 KB of bodies) | **yes** | Same defect, one file per tool: ~47 K tokens at session start to reach 8 K of relevance, under a truncating cap | `build_mirror` renders the index |
| The prose in `AGENTS.md` that **claims the mirrors inlined the complete ruleset** | **yes** | It is false after this change and was already misleading before it (the inlined copy was truncated); documentation that describes behaviour that does not exist is worse than none | The prose now states the format split (index for single-file mirrors, full body per `.mdc`) |
| A committed generated `docs/INDEX.md` | rejected | Needs regenerating, drifts silently, becomes a second copy of a constantly-changing truth | The index is generated on demand by `sync-agents.sh` |
| `alwaysApply: true` on *every* `.cursor/rules/*.mdc` | rejected (was fixed upstream; **this repo has no `.cursor/rules/`**) | Universal rules would load only if the tool guessed to ask if all were scoped | The module's own declared `Applies when:` decides — 7 always-on, 7 scoped here |
| Inlining the bodies *only* into mirrors, leaving the `AGENTS.md` block as an index | rejected | Effectively two behaviours to reason about; the same argument that killed the `AGENTS.md` copy applies to the mirrors | One rendering function, one shape |
| Porting the rest of the kit's gate suite (`check-conflict-markers`, `check-coverage`, `check-rule-fork`, `check-spec`, `check-milestone-evidence`, `check-wireframe`) | rejected | Out of scope by the task's own constraint; each adds a merge requirement, which is an operator decision, and unrelated gates now would have to be maintained | Only `doc-map.sh` + its canary, which are the ones this change's defect class needs |

## Milestones

- [x] **M1 — mirrors render an index, not the corpus** — `build_mirror` calls the existing
  `render_index`; all 14 modules named in each single-file mirror; bodies keep one home under
  `.agents/rules/`. Evidence: `scripts/sync-agents.sh`
- [x] **M2 — `AGENTS.md` renders the index** — the `PANOPLY:RULES` refill uses the index renderer
  rather than the concatenated bodies; the block no longer duplicates rule text.
  Evidence: `scripts/sync-agents.sh`
- [x] **M3 — `.mdc` scoping derives from the module** — `build_cursor_module` reads each rule's own
  `Applies when:` line; no hand-kept second list. Evidence: `scripts/sync-agents.sh`
- [x] **M4 — the prose matches the behaviour** — `AGENTS.md` no longer claims self-contained mirrors.
  Evidence: `AGENTS.md`
- [ ] **M5 — the truncation budget is checked** — `doc-map.sh --check` refuses an `AGENTS.md` at or
  over its loader's ~20,000-char cap, and its canary proves the check can fail.
  Evidence: `scripts/doc-map.sh`, `scripts/doc-map.test.sh`

## Open questions

None blocking.

## Build notes

> **Build note:** 2026-10-03 — layout version. This repo is on the **NEW kit layout**
> (`docs/agents/` + `.agents/rules/`, `_PANOPLY_GENERATION="layout-agents-2"` in
> `scripts/panoply.sh`; the legacy `docs/claude/` + `.claude/rules/` trees do not exist). So the
> change is not a migration — it is the `.agents/rules` → mirror rendering path only.

> **Build note:** 2026-10-03 — **the first cut left `AGENTS.md` at 20,066 bytes, 66 over the cap its
> loader truncates at.** The index alone did not fit because the hub also carried an inlined copy of
> the `MIRROR` preamble — text addressed to tools that never open `AGENTS.md`. That copy was the
> last duplicate in the file, so the preamble moved to **`.agents/preamble.md`** (one home, rendered
> into every mirror from there) and the hub now points at it. 20,066 → 13,361 B; `doc-map.sh --check`
> red → green. Recorded because the near-miss is the point: without the cap as a *gate*, shipping
> 66 bytes over would have been invisible, and the truncated read it causes is silent.

> **Build note:** 2026-10-03 — the kit source this repo resolves to is the **canonical clone at
> `/opt/data/panoply-kit` (v1.4.0)**, which predates the upstream index change
> (`panoply@dd696e6`). `scripts/panoply.sh version` therefore reports `v1.4.0` and `check` reads the
> stamp, not the newer repo. **Uncertainty recorded rather than papered over:** `panoply.sh check`
> reaching exit 0 after this change proves the mirror/doctor/sync triad is *self-consistent*, not
> that the change is present in the kit version the repo stamps. Refreshing `panoply.sh` itself from
> `panoply@dd696e6` would add `migrate` and the `selfstale` verdict (exit 15) — a separate, larger
> change, deliberately not folded in here.

> **Build note:** 2026-10-03 — `doc-map.sh` is ported with two repo-specific canary fixes, both of
> which failed here for correct repo state rather than for a defect: (1) the "indexes the same number
> of docs as on disk" case counted `node_modules/**/README.md` (1,767 files vs the 92 the map
> correctly indexes — panoply has no `node_modules`), so the count now excludes vendored trees
> exactly as `should_list` does; (2) the extractor case grepped for `rules/algorithm.md`, which this
> repo does not have (the module set was reconciled to kit v1.4.0, which has no `algorithm`), so it
> now picks the first rule module present. Both are portability fixes, not weakened assertions.

## On ship

Move this folder into `platform/completed/`, add the `completed-features.md` entry, append the
worklog line, and remove any queue row — in the same commit as the change.
