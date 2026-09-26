# ADR-0020 — Mobile v2 parity gate (native rebuild, design parity, offline-first)

- **Status**: Proposed — **awaiting operator approval**
- **Date**: 2026-09-26
- **Number**: 0020 — twice renumbered while open. Drafted as 0018; moved to 0019 when a
  separate PR landed `adr/0018-projects-reference-based-containers.md`; moved to 0020 when
  `adr/0019-exit-door-data-export.md` landed on `main`. See D5 — the churn is the evidence.
- **Owner**: operator (decision D1), mobile workstream (execution)
- **Related**: `docs/claude/platform/mobile/parity.md` (the document this ADR governs);
  `adr/0010-offline-strategy.md` (web offline — the sibling decision);
  `adr/0016-passkey-webauthn-identity-root.md` (identity root mobile does not yet implement)
- **Supersedes**: the dead citation `ADR-0006` in
  `mobile/lib/src/features/shared/placeholder_screen.dart` — which pointed at
  `adr/0006-pex-contract-extensions.md`, an unrelated Jex-mesh document, and at a
  `parity-nexalog.md` that exists in no ref. There was no real mobile ADR. This is it.

## Context

`mobile/` is a full native Flutter app (`sqflite` mirror, mutation queue, sync engine,
`riverpod`, `go_router`) with a shipped release pipeline. It carries a ship rule in a doc
comment and nothing else:

> *"Never shipped in an APK — the ship gate (ADR-0006) requires full parity, no placeholders."*

Both referenced artifacts are gone or wrong. `parity-nexalog.md` does not exist in any ref in
this repository, and `ADR-0006` is `adr/0006-pex-contract-extensions.md` — the Jex cross-app mesh
contract, an operator gate for PKM-expansion phases 3.2/3.5. A ship gate that cites two
non-existent documents is not a gate; it is a sentence. Meanwhile the mobile comment cites a
private ADR series that collides with the root series on 0001/0002/0003/0006, so *every* ADR
citation in `mobile/lib/` resolves to the wrong document.

Three questions were therefore open and needed a recorded answer, not an oral tradition:

1. **What is the gate, actually?** Nothing stated what "full parity" means, which surfaces it
   covers, or what happens to a web surface mobile has no answer for.
2. **Which surface set is the target?** The web v2 app is the reference, but nothing enumerated
   its surfaces for a mobile author to check against. The roadmap's only mobile row describes a
   *thin WebView shell* and *Codemagic signing* — neither of which is true of the code (the app is
   native; Codemagic is gone; signing is Pushd) — so the most authoritative-looking mobile doc in
   the repo advertises the architecture the operator has since rejected.
3. **What must not be lost in a rebuild?** The app is offline-first by construction. A rebuild
   that quietly makes surfaces online-only would regress a shipped guarantee.

## Decision

### D1 — The parity gate is a real release gate

**No placeholder, stub, "coming soon", or `PlaceholderScreen` may ship in a release APK.**

- It is a **release** gate, not a development gate: stubs are legitimate while a surface is being
  built and become defects when a build is signed for distribution.
- It covers **the whole web v2 surface list** (enumerated by `parity.md` §2.1), not merely the
  surfaces that happen to have a mobile file. A web surface with no mobile answer is the *most*
  severe parity failure, not an exemption.
- It is enforced today by **human release review**. No automated placeholder detector exists, and
  this ADR does not pretend otherwise — the repo has a documented history of gates that passed
  vacuously (see the dependency-cruiser coverage assertion in `docs/claude/worklog.md`), so an
  unenforced claim would be worse than an honest one.
- **"Full parity" is defined operationally in `parity.md` §3**: each row's *what "done" means*
  cell is the acceptance criterion for that surface. The gate is satisfied when no row is
  **Missing** and no shipped surface is **Partial** without a recorded decision — not when the
  counts look acceptable.

### D2 — Design parity: mobile implements Knowledge Garden, not a stock Material theme

Mobile must implement the **same token system** as web, not a seeded Material theme.

- **Source of truth is `apps/web/app/globals.css`.** The roadmap names
  `docs/design/direction.md` as the token home; **that file does not exist in any ref**, and
  neither does the `docs/design/` directory. The live design system is the CSS file — semantic
  tokens with the default Tailwind palette disabled (`--color-*: initial`) and page-type accents
  (`--color-type-person|-company|-project|-concept|-note|-source|-media`), light "paper" and dark
  "ink".
- **Current state fails this requirement.** `mobile/lib/src/theme/app_theme.dart` defines one
  constant (`kCopper = Color(0xFFC07040)`) and derives everything from
  `ColorScheme.fromSeed(seedColor: kCopper)`. That is stock Material 3 with a copper seed; the type
  colors do not exist on mobile at all.
- The design token set is a **specification**, not an aspiration: a surface is not parity-done if
  it renders the right data in the wrong visual language.

### D3 — Offline-first is a permanent property of the app

The `sqflite` mirror + mutation queue + `/api/sync` reconcile loop is **kept**, and no parity work
may regress it.

- Every new surface must have a **mirror-backed read path** and a **queueable write path**, or the
  PR must state why not. A surface that only works online is a regression of a shipped guarantee.
- This is mobile's counterpart to web's service-worker/IDB-outbox decision
  (`adr/0010-offline-strategy.md`); the two mechanisms are separate and mobile's is its own.
- Note the **blocking consequence** recorded in `parity.md` §4.1: `GET /api/sync` carries
  `notes`, `captureSources`, `journalEntries`, `projects`, `bookmarkCollections` — **not
  `captures`** — and **no HTTP route lists captures by status** (`ListInbox` is wired in
  `composition.ts` and exposed by no handler). The capture-review surface (§3 row 15) and the
  per-capture routes behind it are therefore **unbuildable on mobile today**, and any plan for
  them must sequence a server API first. This is a genuine blocker, not a scheduling preference.

### D4 — The rebuild target is native, not a WebView shell (operator, 2026-09-26)

`mobile/` is rebuilt **natively** to the web v2 surface, keeping offline-first.

**Explicitly rejected:** replacing the native app with a thin Flutter WebView shell wrapping
`nexalog.com/app`. That approach appears in `docs/claude/roadmap.md` and in the opening line of
`mobile/CI.md`; both are **stale descriptions, not a brief**, and both should be corrected
(`parity.md` §4.4 carries the recommended replacement text). A WebView shell would forfeit the
offline-first guarantee in D3 outright, which is why it is incompatible with this ADR rather than a
cheaper alternative to it.

### D5 — ADRs are cited by path, never by bare number

Root series lives in `adr/NNNN-slug.md` (`.claude/rules/documentation.md`).

- Reason, from evidence: **two `adr/` directories both number from 0001** — root
  `adr/0001-audit-methodology.md` and `docs/claude/platform/projects/adr/0001-nexalog-projects.md`
  — so an unqualified "ADR-0001" has never had a single meaning in this repo. `mobile/` made the
  failure concrete by citing a private series that collides with the root one on 0001/0002/0003/0006.
- **The root series itself collides in practice, not just in theory — this ADR was renumbered
  twice while it was open.** It was drafted as 0018. A separate PR then landed
  `adr/0018-projects-reference-based-containers.md`, taking 0018, so this became 0019. Then
  `adr/0019-exit-door-data-export.md` landed on `main`, taking 0019, so this became 0020. Nothing
  was wrong with any of those three changes — each was a correct ADR in a repository where two
  workstreams write into one series concurrently. A bare number simply cannot be a stable
  reference under that load. Path-based citations are immune to it.
- **Rule:** write `adr/0020-mobile-v2-parity-gate.md`, not "ADR-0020". A bare number is not a
  reference in this repository.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| **Thin WebView shell** wrapping `nexalog.com/app` | Forfeits offline-first (D3) and native capabilities the app already ships (share receiver, dictation, voice capture). Explicitly rejected by the operator, 2026-09-26. |
| **Leave the gate as the existing doc comment** | It cites two non-existent documents. An unenforceable rule trains readers to ignore rules. |
| **Gate on "no `PlaceholderScreen` in the tree"** | Too weak and also currently vacuous: `placeholder_screen.dart` is dead code with no importer and no route, so a tree-scan would always pass. It says nothing about the 17 surfaces carrying real gaps, including 2 that are entirely absent. |
| **Gate on the file inventory** (a mobile file exists per web route) | Fails the other way: `inbox/inbox_screen.dart` and `review/review_screen.dart` share names with web surfaces they do **not** implement while the surface they do implement is a different one. Name-matching scores these as parity and hides real gaps. The matrix is per *surface*, not per *filename*. |
| **Treat parity as aspirational / best-effort** | The app ships to the Play Store against a live product; "best-effort" is how placeholders reach users. |
| **Record this as an ADR under `docs/claude/platform/mobile/adr/`** | Creates a second series numbering from 0001 — the exact ambiguity that produced this defect (D5). |
| **Fix the `placeholder_screen.dart` comment in this change** | Out of scope for a docs-only PR. Recorded as a one-line follow-up with exact replacement text in `parity.md` §0.1; the file is also dead code, so deletion is likely the better fix and belongs to the mobile owner. |

## Consequences

- **The gate becomes citable.** `mobile/lib/src/features/shared/placeholder_screen.dart` should cite
  `docs/claude/platform/mobile/parity.md` and this ADR **by path**; the exact replacement comment is
  in `parity.md` §0.1. Until that lands, the code still points at two non-existent documents.
- **A real work queue exists.** 17 of 22 web surfaces carry outstanding work: 11 partial, 2 entirely
  missing (the Knowledge Garden, and the capture-review surface), 4 legal pages unported, 1 N/A.
  2 are matched and 2 are covered by other means. Full accounting in `parity.md` §3.1.
- **One surface is blocked on the server, not on mobile effort.** The capture-review surface cannot
  be built until captures are reachable over HTTP (`parity.md` §4.1). This ADR does not authorise
  that server work; it records the dependency so the ordering is deliberate.
- **Design parity is now work, not taste.** Mobile's theme must be rebuilt against
  `apps/web/app/globals.css` (D2). Anyone sizing the rebuild must include it.
- **`parity.md` must be re-derivable, and kept so.** Its surface lists are generated by the `git`
  commands in §2.1–§2.3, so drift is checkable rather than arguable. When the web surface changes,
  the matrix and §3.1's counts move in the same change — silent drift is precisely how
  `parity-nexalog.md` became a dangling pointer.
- **Stale mobile docs stay defects until fixed.** `docs/claude/roadmap.md`'s "Android app (Play)"
  row and `mobile/CI.md`'s opening line both still describe the rejected WebView shell. Recorded;
  not fixed here (docs-only, and the roadmap row is the initiative owner's call).

## Status note

**Proposed.** Consistent with the other Proposed ADRs in this repo (`adr/0002`, `adr/0003`,
`adr/0006`), this needs explicit operator approval before it binds. The decisions it records are
either the operator's already (D4, given 2026-09-26) or derived from the repo's own conventions
(D5, from `.claude/rules/documentation.md`). D1–D3 need the operator's sign-off to become the
enforceable gate the lost comment claimed to have.
