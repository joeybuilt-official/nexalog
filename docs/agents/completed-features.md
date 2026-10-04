# Completed Features

The shipped log. One entry per feature, newest first. Read this before proposing work — it is the
cheapest way to avoid rebuilding something that already exists.

Add an entry when a feature is tested and signed off, at the same time you move its folder into
`<area>/completed/`.

## Entry format

```markdown
### <Feature name> — YYYY-MM-DD
- **What shipped:** one or two sentences, in terms of what a user or caller can now do.
- **Area:** `<area>`
- **Archived plan:** `<area>/completed/<feature>/<renamed-file>.md`
- **Notable decisions:** anything that constrains future work; link the ADR in `architecture.md`.
- **Known gaps:** what was deliberately left out, so the next person does not read it as a bug.
```

---

<!-- New entries go directly below this line, newest first. -->

### Agent mirrors are an index, not the ruleset — 2026-10-03
- **What shipped:** every generated tool-native agent file now carries the universal preamble plus a
  generated **index** of the rule modules (name → one-line description → path to read) instead of
  inlining ~134KB of rule bodies. `CLAUDE.md`, `GEMINI.md`, `CONVENTIONS.md`,
  `.clinerules/00-agents.md`, `.github/copilot-instructions.md`, and `.windsurf/rules/00-agents.md`
  dropped from 157,472 to 10,088 bytes each, still naming all 14 modules; `AGENTS.md` dropped from
  152,016 to 13,361. The per-rule `.mdc` files keep each rule's full body and are now scoped by that
  rule's own `Applies when:` line (6 always-on, 8 conditional), and `scripts/doc-map.sh` + its canary
  are ported and wired into `verify` as the context-budget gate.
- **Area:** `platform`
- **Archived plan:** `platform/mirror-index/plan.md`
- **Notable decisions:** the rule bodies keep exactly one home, `.agents/rules/*.md`; the mirrors and
  the `AGENTS.md` rules block render the index, and per-rule `.mdc` files carry the bodies. The
  universal preamble moved from an inlined copy inside `AGENTS.md` to `.agents/preamble.md` because
  the inlined copy pushed the hub 66 bytes past the ~20,000-char cap its loader truncates at —
  a truncated read is silent, so the cap is enforced by `doc-map.sh --check` rather than assumed.
  `alwaysApply` is derived from each module's own declared condition, never a hand-kept list.
  `doc-map.test.sh` was ported with two repo-portability fixes (exclude vendored `node_modules`
  trees from the doc count; pick the first rule module present rather than naming the absent
  `algorithm`).
- **Known gaps:** `scripts/panoply.sh` itself was not refreshed (the repo resolves to the canonical
  kit clone at v1.4.0, which predates the upstream index change), so its `migrate` command and
  `selfstale` exit code are absent; that refresh is its own change. No kit-layout migration was done.

### Projects — per-project BRIEF synthesis — 2026-10-01
- **What shipped:** every project page now carries a BRIEF — a short, structured markdown summary of
  what the project is, its current state, active threads, recent activity and open questions —
  assembled from the project's own record, its linked notes' metadata, its sub-projects and the
  workspace themes its notes match. `GET|POST /api/projects/[id]/brief` reads or regenerates it on
  demand, and the detail page surfaces it with a Regenerate control. With no model configured the
  brief is a clearly-labelled mechanical digest rather than an error.
- **Area:** `platform`
- **Archived plan:** `platform/projects/plan.md` §Project brief (the projects folder stays live —
  this is a sub-feature, not the end of the initiative)
- **Notable decisions:** the model leg is the **IntelligencePort** ADR-0014/0017 already specified
  (`lib/intelligence/{port,embedded-adapter,resolve}.ts`, raw `fetch`, no provider SDK), so no new
  ADR was needed — the port was decided, this is its first implementation. All assembly, ordering,
  truncation and theme-matching is one PURE module (`lib/projects/brief.ts`); no rule lives in a
  component. Prompt and tuning live as a versioned template (`lib/intelligence/prompts.ts`) and the
  model id comes from `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL`, never a literal at a call site.
- **Known gaps:** nothing is persisted — a brief is synthesized on demand, so a Regenerate click is
  a fresh model call and the project page makes that call during render. There is no Plexo federated
  adapter yet (no agreed completion contract in this tree), no provenance row for a synthesized
  brief, and the themes are matched from note embeddings read as raw SQL text (they are READ, never
  recomputed).

### Panoply kit refresh — 2026-09-30
- **What shipped:** the kit is now genuinely current rather than merely stamped. All 14 surviving
  `.agents/rules/` modules were reconciled by hand against kit v1.4.0 (merging the kit's body while
  keeping this repo's layer map, `pnpm depcruise` gate, Plexo notes and shared-Postgres MUST-NOTs),
  every adapt token was filled from this repo's own `package.json` script table, `sync-agents.sh`
  was re-synced to the fixed v1.4.0 body, every tool mirror was regenerated, and `.panoply-version`
  was re-stamped last.
- **Area:** `governance`
- **Archived plan:** n/a — adoption batch, no separate plan folder
- **Notable decisions:** the `MODULE:agent` / agent-readiness module was **pruned**, not adopted —
  this repo builds no MCP server and serves no `/.well-known/agent-card.json`, and a rule kept "just
  in case" is a rule nobody follows. `check-expert-review.sh` was re-synced to the kit's corrected
  body but deliberately **not** wired into CI, because wiring it would silently change the merge
  requirements for every future PR. `init-repo-protection.sh` was left alone: the repo's live
  protection (0 required approvals, admins enforced) is a deliberate single-operator setting that the
  kit's default call would have flipped.
- **Known gaps:** no `/.well-known/agent-card.json`; no endpoint-test coverage checker (the testing
  module describes it as target state, not as live CI); the `docs/agents/` spine is seeded with real
  content but the `in-progress.md` ↔ `in-progress.d/` migration sweep has not run, so both are kept
  in step by hand for now.

### Panoply kit adoption (first pass) — 2026-09-30
- **What shipped:** the doctor (`scripts/panoply.sh`) and its canary, the version stamp, and
  `scripts/check-plan-home.sh`, wired into the `verify` workflow in the same job as the docs-landing
  gate. `panoply.sh check` became the machine surface any harness can run before it writes.
- **Area:** `governance`
- **Archived plan:** PR #29 — see the worklog
- **Notable decisions:** the stamp is written last among the mechanical steps, so a half-finished
  adoption cannot leave a current-looking version.
- **Known gaps:** this pass reached `panoply.sh check` = 0 *without* reconciling the rule modules —
  the doctor inspects five things and would not have noticed 12 of 14 modules having drifted from the
  kit. The refresh entry above is the correction; that is the failure mode the kit's own docs call
  "looks like a doc bug".

### Projects — reference-based containers (vertical slice) — 2026-09-28
- **What shipped:** first-class Projects that group existing notes and bookmarks, with a living doc
  and a proposal-queue path for changes. `/api/projects` (list/create), `/api/projects/[id]`
  (detail/patch/delete), `/api/projects/[id]/items` (add/detach a reference), the
  `app/(app)/app/projects` pages, and a Library-group nav entry in the sidebar + mobile bottom bar.
  Sub-projects are `project_items.item_kind='project'` pointing at the child project.
- **Area:** `platform`
- **Archived plan:** `platform/projects/plan.md` (still active — Phase 5 is operator-gated)
- **Notable decisions:** the nesting policy (one parent, two levels) lives in the domain as
  `MAX_PROJECT_DEPTH` + `assertNestable` and is enforced in the single write path with a 400 carrying
  a machine-readable `code` — never a CHECK constraint, never a depth column. The schema change was
  one additive, idempotent migration hand-applied by the operator; no `db:push` / `db:migrate` /
  `db:generate` runs from this tree.
- **Known gaps:** Phase 5 (operator-gated push target, deploy, prod migration) still stands.

### Brain chat surface — 2026-09-29
- **What shipped:** the brain hosts a chat surface over its own pages, and every citation in an answer
  opens a real page rather than a dead link.
- **Area:** `platform`
- **Archived plan:** `adr/0023-chat-surface-hosted-here-turn-hosted-there.md`
- **Notable decisions:** the surface is hosted here; the turn is hosted there (Plexo) — ADR-0023.
- **Known gaps:** see the ADR.

### Legacy v1 route degradation stopgap — 2026-09-26
- **What shipped:** five carried-over v1 surfaces (`/api/sync`, `/api/sync/mutations`, `/api/notes`,
  `/api/bookmarks`, `/api/journal`) that had been 500-ing with `42P01` now degrade to a typed
  `503 surface_unavailable` instead, so mobile sync fails honestly rather than appearing to work.
- **Area:** `platform`
- **Archived plan:** `in-progress.d/legacy-v1-routes-stopgap.md` (still open — the direction is an
  operator decision)
- **Notable decisions:** the stopgap deliberately does **not** resolve the DB split (v1 content lives
  in the `pushd` database; `DATABASE_URL` here points at `nexalog_v2`). Operator chose **retire,
  staged** — mobile moves to the v2 model.
- **Known gaps:** the shipped v1 `/api/export` route reads through the same path and is therefore
  *not* a working content export. Repoint / migrate / retire is still undecided.

### Knowledge Garden design tokens (mobile) — 2026-09-26
- **What shipped:** the design-token system, the type→colour mapping, and a hardcoded-colour gate for
  the Flutter client (`mobile/lib/src/theme/knowledge_garden_tokens.dart` plus two test files).
- **Area:** `platform`
- **Archived plan:** `platform/mobile/parity.md` §4.2
- **Notable decisions:** colour comes from tokens, never literals — enforced by the hardcoded-colour
  test, so the decision cannot silently erode.
- **Known gaps:** parity row 13 (`/app/graph`) is still **Missing** — no screen, no route, no
  `/api/graph` caller. The remainder needs a build-vs-deferral gate decision before code.

### Project brief → brain publish — 2026-10-01
- **What shipped:** a project's SYNTHESIZED brief can be proposed into gbrain through
  the app's existing proposal queue (`take_proposals`, `kind = 'brief'`). Rules, tests
  and route: `packages/core/src/domain/brief-publish.ts`, `.../application/publish-project-brief.ts`,
  `apps/web/lib/projects/publish.ts`, `POST /api/projects/[id]/brief {intent:"publish"}`,
  and a Publish control on the brief section.
- **Area:** `platform`
- **Notable decisions:** a `fallback` brief is REFUSED (409 `brief_not_synthesized`) —
  a mechanical digest is not a claim and must never enter the brain as one. Publishing
  is an explicit intent, never a side effect of viewing. Idempotency is a content digest
  of the brief itself, so the same brief twice is a no-op and a re-synthesis is a new
  proposal. Provenance (project, model, instant, linked-note titles) rides both the
  claim and a `brief/1` block in the existing `plan_diff` column — no column added to a
  table gbrain owns. Publishing is a PROPOSAL: nothing reaches the brain until the
  operator accepts in `/app/proposals`.
- **Known gaps:** no live deploy and no live model call were exercised from this tree;
  the queue is asserted against a fake keyed exactly as its real unique index keys it.
  The brain-page resolution falls back to a synthesized slug when a project has no page
  yet — Phase 5's push target is what will give sub-projects real pages.
