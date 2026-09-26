# Mobile ↔ web v2 parity

**This is the parity doctrine for the native mobile app.** It replaces the lost
`parity-nexalog.md` — see §0 for why that file is gone and what still points at it.
It is the document a developer consults before adding a `PlaceholderScreen`, before
claiming a screen is "done", and before cutting a release.

- **Ship gate (the rule):** no placeholder or stub screen may ship in an APK. See §1.
- **Governing decision:** `adr/0020-mobile-v2-parity-gate.md` (Proposed — awaiting operator approval).
- **Source of truth:** the running web v2 app. The surface lists in §2 are *derived* from the
  repo, and §2 gives the exact commands that derive them, so this document can be
  regenerated rather than trusted.
- **Recon date:** 2026-09-26, against `origin/main` = `c20238a`.

---

## 0. Why this document exists (the lost-doctrine record)

`mobile/lib/src/features/shared/placeholder_screen.dart` carried this doc comment:

```dart
/// Temporary stand-in for a web surface not yet ported to native. Tracked in
/// parity-nexalog.md; replaced screen-by-screen. Never shipped in an APK — the
/// ship gate (ADR-0006) requires full parity, no placeholders.
```

Both references in that comment were **dangling**, and both were verified dangling
rather than assumed:

1. **`parity-nexalog.md` does not exist anywhere.** Not on `origin/main`, not in the
   `archive/snapshot/2026-06-29-nexalog-old` tag, not in any other ref:

   ```sh
   git ls-files | grep -i parity                      # → no output
   git ls-tree -r --name-only origin/main | grep -i parity          # → no output
   git ls-tree -r --name-only archive/snapshot/2026-06-29-nexalog-old | grep -i parity   # → no output
   ```

   Every ref in the repo was scanned; zero files matching `parity` exist in any of them.

2. **`ADR-0006` is the wrong document.** In this repo's root `adr/` series, `adr/0006-pex-contract-extensions.md`
   is *"Jex contract extensions (the `[X]` prerequisite items)"* — the Pex/Jex cross-app mesh
   protocol, and an **operator gate for PKM-expansion phases 3.2 and 3.5**. It is not a mobile
   ship gate and never was.

3. **The `ADR-0006` collision is not isolated — it is a whole wrong namespace.** Every ADR citation in
   `mobile/` resolves to the wrong root document, because `mobile/` was written against a *different,
   private* ADR series:

   | Cited in mobile | Actual root `adr/` document | What mobile means |
   |---|---|---|
   | `ADR-0001` (`app_db.dart`, `mutation_queue.dart`, `sync_engine.dart`) | `0001-audit-methodology.md` — end-to-end audit methodology | offline sync / delta-pull |
   | `ADR-0002` (`api_client.dart`, `auth_controller.dart` ×2, `auth_store.dart`) | `0002-data-export-portability-format.md` — data export format | better-auth bearer tokens |
   | `ADR-0003` (`app_db.dart`, `sync_engine.dart`) | `0003-embeddings-clustering-ownership.md` — pgvector/embeddings boundary | LWW conflict resolution |
   | `ADR-0006` (`placeholder_screen.dart`) | `0006-pex-contract-extensions.md` — Jex contract | the mobile parity ship gate |

   `mobile/`'s ADR numbering is simply not this repo's ADR numbering.

4. **The number alone is already ambiguous in this repo**, independently of mobile. Two different
   `adr/` directories both start at 0001: root `adr/0001-audit-methodology.md` and
   `docs/claude/platform/projects/adr/0001-nexalog-projects.md`. A bare "ADR-0001" has never had one
   meaning here. See D3 in §6.

**Best-supported explanation (evidence, not proof).** `docs/claude/roadmap.md` records that the
`nexalog-app-plan` and `offline-first-apps-plan` working directories were **archived out of the
repo** on 2026-08-29 ("Planned — never built (folded from stray plan dirs) … the working dirs are
archived, so these rows are the durable record"). Both the missing `parity-nexalog.md` and mobile's
private ADR series most likely lived in those archived plan dirs, which is exactly why they no longer
resolve. The archived dirs are not in git history, so this cannot be confirmed from the repo — treat
it as the leading hypothesis, not a verified fact.

### 0.1 The one-line code follow-up (flagged, deliberately NOT done in this PR)

This PR is docs-only, so the Dart comment is **not** edited. `mobile/lib/src/features/shared/placeholder_screen.dart`
is additionally **dead code** — nothing imports or routes it (§5.4) — so the citation fix and any
deletion belong to whoever owns `mobile/`. The exact replacement text for the comment block is:

```dart
/// Temporary stand-in for a web surface not yet ported to native. Tracked in
/// docs/claude/platform/mobile/parity.md; replaced screen-by-screen. Never
/// shipped in an APK — the ship gate (adr/0020-mobile-v2-parity-gate.md)
/// requires full parity, no placeholders.
```

A companion one-liner for the same fix: every `ADR-000N` citation in `mobile/lib/` should be
re-pointed at its real root document, or dropped. The table in §0 item 3 is the mapping.

---

## 1. The ship gate

**No placeholder, stub, "coming soon", or `PlaceholderScreen` may ship in a release APK.**

The gate is a *release* gate, not a development gate. Stubs are legitimate while a surface is being
built; they become defects the moment a build is signed for distribution. Concretely:

- A `PlaceholderScreen` (or any surface that renders no real data) **fails the release review**.
  It is not "tracked debt you may ship" — the previous comment's phrasing implied a tolerance that
  does not exist.
- The enforcing artifact is `.pushd.yaml`'s post-build verification plus human release review. There
  is **no automated placeholder detector** today; this gate is doctrine plus review, and saying so
  honestly is the point (the repo has a documented habit of gates that pass vacuously — see the
  `depcruise` coverage assertion in `docs/claude/worklog.md`).
- The gate applies to the **whole surface list in §3**, not just to screens with a matching file.
  A web surface with no mobile file at all is the *most* severe parity failure, not an exemption.

**Design parity is part of the gate.** Mobile must implement the **Knowledge Garden** token system,
not a stock Material theme. The live source of truth is `apps/web/app/globals.css` (see §4.2) —
the design-direction document the roadmap names does not exist (see §2.4).

**Offline-first is part of the gate.** The app is offline-first by construction (`sqflite` mirror +
mutation queue + `/api/sync` reconcile). No parity work may regress that — see §4.3.

---

## 2. Source of truth

The web v2 app is the reference implementation. Everything below is **derived** from the repo at
`origin/main = c20238a` (recon 2026-09-26) using the commands given, so anyone can re-derive it and
see exactly what changed.

### 2.1 Web v2 page surfaces — 22 routes

```sh
git ls-files 'apps/web/app/**' | grep 'page\.tsx$' | sed 's|^apps/web/app/||' | sort
```

```text
(app)/app/bookmarks/[id]/reader/page.tsx    (app)/app/review/page.tsx
(app)/app/bookmarks/page.tsx                (app)/app/search/page.tsx
(app)/app/graph/page.tsx                    (app)/app/settings/page.tsx
(app)/app/inbox/page.tsx                    (app)/app/share/page.tsx
(app)/app/journal/[date]/page.tsx           (app)/app/today/page.tsx
(app)/app/journal/page.tsx                  (auth)/login/page.tsx
(app)/app/journal/today/page.tsx            cookie/page.tsx
(app)/app/notes/[id]/page.tsx               inbox/page.tsx
(app)/app/notes/page.tsx                    offline/page.tsx
                                            page.tsx
                                            privacy/page.tsx
                                            refund/page.tsx
                                            terms/page.tsx
```

Note the two **differently-scoped inboxes** — conflating them is the single easiest mistake to make
in this matrix:

- `(app)/app/inbox/page.tsx` — **lifecycle triage** over `notes` (`raw`/`understanding`/`refined`/`active`/`archived`),
  with a kind filter, a 200-row cap, and bookmark-twin exclusion.
- `inbox/page.tsx` — the **capture-review surface**: the operator accept/reject queue for what the
  Hermes worker did, read through `getComposition().listInbox` → `FsGitBrainStore` (the brain repo
  is the source of record), rendering the `nexalog.proposal` block and `status: review`.

### 2.2 Web API route inventory — 44 route directories

```sh
git ls-files 'apps/web/app/api/**' | grep 'route\.ts$' | sed 's|^apps/web/app/api/||;s|/route\.ts$||' | sort
```

```text
auth/[...all]                 journal                       search
auth/keypair                  journal/[date]                settings
auth/passkey/authenticate     notes                         sync
auth/passkey/authenticate-verify   notes/[id]               sync/mutations
auth/passkey/register         notes/[id]/backlinks          today/cards
auth/passkey/register-verify  notes/[id]/links              workspaces
auth/recovery/redeem          notes/[id]/snapshots
bookmarks                     notes/[id]/tags
bookmarks/[id]                notes/[id]/unlinked-mentions
bookmarks/[id]/assign         notes/resolve
bookmarks/backfill            notes/search
bookmarks/collections         review
bookmarks/collections/[id]    capture
bookmarks/tags                captures/[id]/archive
bookmarks/tags/[id]           captures/[id]/find-free-version
export                        captures/[id]/open
graph                         captures/[id]/reader
health                        captures/[id]/review
img                           captures/[id]/touch-extract
```

### 2.3 Mobile surfaces — 15 screens

```sh
git ls-files 'mobile/lib/**' | grep '_screen\.dart$' | sort
```

`auth/sign_in` · `bookmarks/bookmarks` · `bookmarks/reader` · `capture/capture` · `inbox/inbox` ·
`journal/journal_entry` · `journal/journal_list` · `notes/note_editor` · `notes/notes_list` ·
`review/review` · `search/search` · `settings/settings` · `shared/placeholder` · `today/today` ·
`voice/voice_memo`

### 2.4 Two documents the code cites that do not exist

| Referenced by | Status |
|---|---|
| `parity-nexalog.md` | **Absent from every ref** (§0 item 1). Superseded by this document. |
| `docs/design/direction.md` (named in `progress-v2.md` §Phase 1D as the home of the Knowledge Garden tokens) | **Absent.** The entire `docs/design/` directory is absent from every ref. The live design system is `apps/web/app/globals.css`; treat that file as the design spec — see §4.2. |

### 2.5 Mobile's API surface — 18 call sites, 2 of them dead

```sh
git grep -ohE '"/api/[a-zA-Z0-9_${}/:.-]+"' -- mobile/lib | tr -d '"' | sort -u
```

Resolve against §2.2 (**16 live**): `/api/auth/sign-in/email` · `/api/auth/sign-out` ·
`/api/auth/sign-up/email` · `/api/capture` · `/api/captures/{id}/reader` · `/api/notes/{id}/backlinks` ·
`/api/notes/{id}/links` · `/api/notes/{id}/snapshots` · `/api/notes/{id}/tags` ·
`/api/notes/{id}/unlinked-mentions` · `/api/notes/search` · `/api/review` · `/api/search` ·
`/api/sync` · `/api/sync/mutations` · `/api/workspaces`

**Dead (2) — both 404 in production:**

| Call site | Why it is dead |
|---|---|
| `/api/query-views` (`features/search/search_providers.dart` `SavedViewsRepo.list`) | No such route in §2.2. Deleted with the §1.7 route cleanup (`1866c2c`). The `query_views` **table** definition survives in `apps/web/lib/db/schema.ts` (migration `0020_query_views.sql`, operator-gated) — but a table is not a route. Mobile's saved-views list silently degrades to empty, so it fails *quietly*, which is worse than a visible error. |
| `/api/ai/inline` (`features/notes/wysiwyg_note_editor.dart`) | No such route in §2.2. Deleted with §1.7 (the intelligence-port rework). Mobile's inline-AI menu still renders; the call fails. |

---

## 3. The parity matrix

Legend — **status** is about *surface coverage*, not code quality:

- **Matched** — the mobile surface delivers the web surface's function.
- **Matched (other means)** — covered, but by a mechanism that is not a Flutter screen.
- **Partial** — a real screen exists and works; named web capability is missing.
- **Missing** — no mobile surface at all. The most severe class.
- **Not ported** — deliberately out of mobile scope today; no decision recorded yet.
- **N/A** — no mobile equivalent is meaningful.

| # | Web v2 surface | Mobile surface | Status | Gap — what is missing | What "done" means |
|---|---|---|---|---|---|
| 1 | `/app/today` | `today/today_screen.dart` | **Partial** | No `/api/today/cards` call (verified: **zero** references in `mobile/lib`). Missing the whole card stack: `TodayCards` (continue / recentSaves / triageCount / goneStale), `TodayBrief`, `TodayForgotten`, `TodayRelated`, `SmartViewList`, `JournalPromo`. Mobile renders a date header, a text capture bar and 8 recent notes. | Header + capture bar + the full card stack fed by `/api/today/cards`, with an offline fallback for each lane. |
| 2 | `/app/journal` | `journal/journal_list_screen.dart` | **Matched** | None material. Today CTA + recent entries with mood/energy; matches the web list. | — |
| 3 | `/app/journal/today` | router redirect to `/app/journal/<today>` | **Matched** | None. Both are the same redirect. | — |
| 4 | `/app/journal/[date]` | `journal/journal_entry_screen.dart` | **Partial** | Body + mood + energy + debounced autosave all present. Missing: the `voiceSourceId` / `VoiceMemo` attach path the web editor has; and entry **deletion** (web has `DELETE /api/journal/[date]`; mobile never calls it). | Voice memo attach + delete. |
| 5 | `/app/inbox` (lifecycle triage) | `inbox/inbox_screen.dart` | **Partial** | Lifecycle tabs with counts, kind filter, 200 cap and bookmark-twin exclusion are all present and match. Missing: `InboxVoice` (voice capture on the inbox) and `InboxSuggestionChip` (pending suggestions). Read path also differs — mobile reads the offline mirror, web reads Postgres live. | Voice + suggestion chips, and a defined staleness story for the mirror. |
| 6 | `/app/review` (SM-2 spaced repetition) | `review/review_screen.dart` | **Partial** | **Grade set mismatch.** Web offers four grades — `Again`(0), `Hard`(1), `Good`(3), `Easy`(5) (`components/review-card.tsx`). Mobile offers three — `Hard`(1), `Good`(3), `Easy`(5). Grade `0` is unreachable from mobile, so a card a user cannot recall has no honest action. (Mobile's own comment says "4 grade buttons"; the code has 3.) | The four-grade set, or a deliberate, documented decision that mobile grades a 3-point scale and the server honours it. |
| 7 | `/app/notes` | `notes/notes_list_screen.dart` | **Partial** | List + create + query-rebind to `/api/search` all present. Missing: **note templates** — web renders a `NOTE_TEMPLATES` dropdown (`Plus`/`ChevronDown`); `mobile/lib` has **zero** references to templates. Also missing the `ContentFinder` lens switcher's web-side parity on the notes surface. | Template picker on create. |
| 8 | `/app/notes/[id]` | `notes/note_editor_screen.dart` | **Partial** | Stronger than it looks: title + body, 1s-debounced autosave, confirm-twice delete, HTML read-mode render, and **backlinks / unlinked mentions / snapshots / tags** all wired to live routes. Missing: Tiptap rich-text **editing** (the file itself says wikilinks / slash menu / backlinks are "tracked separately"), block transclusion, the note-chat panel, and `/api/ai/inline` (dead, §2.5). Editing is raw-body text, not WYSIWYG — a formatted web note is displayed faithfully but edited as source. | Rich-text editing parity, or an explicit downgrade decision recorded. |
| 9 | `/app/bookmarks` | `bookmarks/bookmarks_screen.dart` | **Partial** | Reads `capture_sources` from the mirror and searches via `/api/search`. Missing **the entire bookmarks API family**: collections (`/api/bookmarks/collections`, `/[id]`), tags (`/api/bookmarks/tags`, `/[id]`), per-item assign (`/[id]/assign`), backfill. Web also has a two-pane layout, a controlled-vocabulary tag nav, and the theme forest — mobile has none of it. **Eight web routes, zero mobile callers.** | Collections + tags + assign, or an explicit scope cut. |
| 10 | `/app/bookmarks/[id]/reader` | `bookmarks/reader_screen.dart` | **Partial** | Text, read-minutes and a paywalled chip are present with a retry. Missing: HTML fidelity (mobile **strips** `html` to text, so inline links and images are lost; web renders sanitised `readerHtml` in a typography article), `ReaderChrome`, `FindFreeVersionButton`, and the web's auto-fire of extraction when `reader_state` is pending/failed. | HTML render + free-version lookup + auto-extract. |
| 11 | `/app/search` | `search/search_screen.dart` | **Partial** | Genuinely close: `POST /api/search`, sort, kind facets, and a list/table/board/calendar lens switcher (the web `content-finder` lenses). Two defects: `/api/query-views` is **dead** (§2.5) so saved smart-views silently return nothing; and web parses a query DSL (`lib/search/query-dsl.ts`) that mobile does not. | Fix or remove the saved-views surface; decide on DSL support. |
| 12 | `/app/settings` | `settings/settings_screen.dart` | **Partial** | Present: email display, dark-mode toggle, sync status, sign-out. Missing most of the web page: **Password** (change), **Billing**, **Workspaces** (management — mobile has a *switcher* in the drawer, not management), **Web History** (save flag / denylist / retention), and **Your data** → `GET /api/export`. Mobile calls `/api/settings` nowhere. | Each web section either implemented or explicitly out of scope. |
| 13 | `/app/graph` | *(none)* | **Missing** | **No mobile screen and no route.** The Knowledge Garden — the signature v2 surface — is entirely absent from the app. No `/api/graph` caller. | A native garden surface, or a recorded decision to defer it (which is a parity-gate exception and needs the operator). |
| 14 | `/app/share` | native `ShareReceiverActivity.kt` | **Matched (other means)** | Covered, but **outside `mobile/lib`** — a translucent Kotlin `ACTION_SEND`/`text/plain` activity that reads the stored bearer token, extracts the first URL, and POSTs `/api/capture`. Extracts URLs only (no text-only shares); no queueing when offline. Note: a `_screen.dart` glob will never see this — do not score this surface "missing". | URL + text shares, offline-queueable. |
| 15 | `/inbox` (**capture review**) | *(none)* | **Missing** | **No mobile screen, and no way to build one today.** The operator accept/reject queue does not exist on mobile, and it is *architecturally blocked* — see §4.1: captures are not a sync entity and there is no HTTP route that lists captures by status. | A native review surface, gated on a captures API (§4.1). |
| 16 | `/login` | `auth/sign_in_screen.dart` | **Partial** | Email + password sign-in/sign-up works, with the bearer token captured from `set-auth-token`. Missing: **passkey / WebAuthn** (`PasskeyLogin`, the ADR-0016 identity root), **Google** sign-in (feature-flagged), and **recovery-code redemption** (`/api/auth/recovery/redeem`). Mobile calls none of the passkey, keypair or recovery routes. | Decide which identity paths mobile must support; passkey is the documented identity root, so absence needs a decision either way. |
| 17 | `/` (marketing) | *(none)* | **N/A** | No mobile equivalent is meaningful. | — |
| 18 | `/offline` | native offline-first (mirror + queue) | **Matched (other means)** | Not a screen — a mechanism. Web uses a service worker + IDB outbox (`adr/0010-offline-strategy.md`); mobile uses `sqflite` + a mutation queue + `/api/sync`. Functionally covered. | — |
| 19 | `/cookie` | *(none)* | **Not ported** | Legal page, no mobile surface. | Decision: link out, or render in-app. |
| 20 | `/privacy` | *(none)* | **Not ported** | Legal page, no mobile surface. **Play Store listings normally require a reachable privacy policy** — this one has a store-compliance implication, not just a parity one. | Decision + a reachable URL. |
| 21 | `/refund` | *(none)* | **Not ported** | Legal page, no mobile surface. | Decision: link out, or render in-app. |
| 22 | `/terms` | *(none)* | **Not ported** | Legal page, no mobile surface. | Decision: link out, or render in-app. |

### 3.1 Row counts

Of **22 web page surfaces**:

| Status | Count | Surfaces |
|---|---|---|
| Matched | **2** | `/app/journal`, `/app/journal/today` |
| Matched (other means) | **2** | `/app/share` (Kotlin), `/offline` (native offline-first) |
| Partial | **11** | today, journal/[date], app/inbox, review, notes, notes/[id], bookmarks, reader, search, settings, login |
| **Missing** | **2** | `/app/graph`, `/inbox` (capture review) |
| Not ported | **4** | cookie, privacy, refund, terms |
| N/A | **1** | `/` |
| **Total** | **22** | |

**Surfaces carrying outstanding work: 17** (11 partial + 2 missing + 4 not ported) — of which 2 are
entirely absent. Fully matched: 2. Covered by another mechanism: 2. N/A: 1.

Plus mobile-only surfaces with no web route to match, tracked separately in §5.

---

## 4. Structural findings that gate the rebuild

### 4.1 Captures are not synced, and there is no route that lists them — the review surface is blocked

This is the single largest mobile-side gap.

- `GET /api/sync` (`apps/web/app/api/sync/route.ts`) carries exactly **five** entities, read from its
  `SYNC_TABLES` map: `notes`, `captureSources`, `journalEntries`, `projects`, `bookmarkCollections`.
  **`captures` is not among them.** (An earlier recon note recorded two entities; the verified
  current set is five. The substantive gap is unchanged: captures are absent.)
- `POST /api/sync/mutations` mirrors that same five-entity scope in its `ENTITY_TABLES` map and its
  field allowlists. Captures are not client-mutable.
- **No HTTP endpoint exists that lists captures by status.** The only reader is the server-rendered
  `apps/web/app/inbox/page.tsx`, which calls `getComposition().listInbox.execute(...)` →
  `FsGitBrainStore` (a filesystem read of `inbox/<ulid>.md` in the brain repo). That use case is
  wired in `apps/web/composition.ts` and **exposed by no route handler** — verified:
  `git grep -n 'listInbox\|ListInbox' -- apps/web/app` returns only `apps/web/app/inbox/page.tsx`
  and a test.
- The per-capture routes that do exist (`/api/captures/[id]/review`, `/archive`, `/open`,
  `/find-free-version`, `/touch-extract`, `/reader`) all require an `id` the client cannot obtain,
  because nothing enumerates captures.

**Consequence:** matrix row 15 (`/inbox`, capture review) is not "a screen someone hasn't written
yet" — it is **blocked on a server-side API that does not exist.** Any plan for a native review
surface must sequence the API first: either add `captures` to `/api/sync`, or add an
`inbox`/captures-list route that projects `ListInbox`.

**Encouraging detail:** `mobile/lib/src/core/offline/app_db.dart` models the mirror generically
(`mirror(entity, id, json, updated_at)`) and `sync_engine.dart` upserts whatever entity names the
server sends. Mobile is therefore *already structured* to receive a `captures` entity the day
`/api/sync` carries one — the blocker is entirely server-side.

### 4.2 The design system is token-driven on web and stock Material on mobile

- Web: `apps/web/app/globals.css` implements Knowledge Garden (direction B) as **semantic tokens
  only**, with the default Tailwind palette disabled via `--color-*: initial`, so `bg-zinc-900`
  and friends fail to compile. Page *type* is the accent system: `--color-type-person`,
  `-company`, `-project`, `-concept`, `-note`, `-source`, `-media`. Light (paper) and dark (ink)
  are both defined.
- Mobile: `mobile/lib/src/theme/app_theme.dart` defines one constant, `kCopper = Color(0xFFC07040)`,
  and derives the whole scheme from `ColorScheme.fromSeed(seedColor: kCopper)`. That is a
  **stock Material 3 theme seeded with a copper accent** — it does not implement the Knowledge
  Garden token set, and type colors do not exist.
- The document that was supposed to be the design authority, `docs/design/direction.md`, **does not
  exist in any ref** (§2.4). `apps/web/app/globals.css` is the only live design source of truth.

Design parity is therefore a real, named piece of the rebuild (§1), and its spec is
`apps/web/app/globals.css` — not the missing roadmap-named file.

### 4.3 Offline-first must be preserved

`adr/0010-offline-strategy.md` covers **web** offline (service worker + IDB outbox). Mobile's
offline-first infrastructure is separate and already built: `sqflite` mirror, `sync_meta` cursor,
`mutation_queue` with idempotent `op_id`, and a connectivity-driven reconcile loop
(`sync_engine.dart`) with LWW conflict resolution. The operator's decision (§6) is explicit that
this is kept. **Corollary for the rebuild:** every new surface must have a mirror-backed read path
and a queueable write path, or it must say why not. A surface that only works online is a partial
regression of a shipped guarantee.

### 4.4 The roadmap row for mobile is stale

`docs/claude/roadmap.md` → "Planned — never built" carries:

```text
| Android app (Play) | Thin Flutter WebView shell wrapping nexalog.com/app, Codemagic-signed on tags | `nexalog-app-plan` | Plan only |
```

That row is **wrong on all three of its claims** (`mobile/CI.md` carries the same stale opening
line — "Thin Flutter WebView shell wrapping https://nexalog.com/app"). Verified against the tree:

- **Not a WebView shell.** The app is native Flutter: `sqflite`, `riverpod`, `go_router`,
  `super_editor`, `speech_to_text`, a mutation queue and a sync engine (`mobile/pubspec.yaml`,
  `mobile/lib/src/core/offline/`). There is no `flutter_inappwebview` dependency at all.
- **Not Codemagic-signed.** Codemagic is gone from the repo. Signing is Pushd via `.pushd.yaml`.
  Pushd had **no branch or tag filter** when this was verified on 2026-09-25, so every push to any
  branch enqueued a full `android-release` build; it **gained one on 2026-09-26** (pushd PR #25,
  a per-entry `on: {tags, branches}` filter), and this repo's entry is now `on: tags: ["v*"]` —
  tag-only, with manual `POST /builds` still available on demand. `release-v*` additionally
  pushes to the Play internal track.
- **Not "Plan only".** The app is built and shipped: release-signed APKs have been delivered
  (`v1.0.28`, versionCode 28, signer `CN=Nexalog, O=Joeybuilt LLC`), and the current
  `mobile/pubspec.yaml` is `1.0.28+28`.

**Recommended replacement row** (recommended in the PR body; not applied in this docs-only PR,
since rewriting a roadmap initiative row is the initiative owner's call):

```text
| Android app (Play) | Native Flutter rebuild of the web v2 surface, offline-first (sqflite mirror + mutation queue + /api/sync); Pushd-signed, `v*` tag → emailed APK, `release-v*` tag → Play internal | platform/mobile/parity.md | Rebuild in progress — parity gate open (adr/0020) |
```

Likewise, `mobile/CI.md`'s opening line should be corrected from "Thin Flutter WebView shell" to a
native-app description. Both are one-line fixes for the mobile owner.

---

## 5. Mobile surfaces with no web counterpart

The reverse direction. These are not parity failures; they are places where mobile carries its own
weight, or where the file list lies about what is shipped.

### 5.1 Reachability — 5 nav tabs, 11 reachable routes

Bottom-nav tabs (`mobile/lib/src/features/shell/app_shell.dart`, `_tabs`): **Today, Notes, Capture,
Bookmarks, Search**. The sidebar drawer adds Journal, Inbox, Review, Voice memo and Settings.
Routed in `mobile/lib/src/router.dart`: `/sign-in`, `/app/today`, `/app/journal`,
`/app/journal/today`, `/app/journal/:date`, `/app/inbox`, `/app/review`, `/app/notes`,
`/app/notes/:id`, `/app/bookmarks`, `/app/bookmarks/:id/reader`, `/app/settings`, `/app/capture`,
`/app/voice-memo`, `/app/search`.

Two consequences worth stating plainly:

- **`shared/placeholder_screen.dart` is unreachable.** It is not routed in `router.dart`, and
  `git grep -n 'placeholder_screen\|PlaceholderScreen' -- mobile` returns **only the file's own
  declaration**. It is dead code, never instantiated. This is *good news for the gate* (nothing
  placeholder-based can reach an APK today) and it means §0.1's comment fix can be a deletion
  instead.
- `voice/voice_memo_screen.dart` **is** reachable — via the drawer's "Voice memo" and the
  `/app/voice-memo` route — even though it is not a bottom-nav tab.

### 5.2 `voice/voice_memo_screen.dart` — mobile-only surface, degraded

Records AAC via `record`, then POSTs `/api/capture` with `kind: "voice"` and
`content: "[Voice recording]"`. The file's own comment records why: **v2 deleted the `/api/voice`
R2 upload route**, so the audio is never uploaded — only a placeholder capture is created. On-device
dictation (`speech_to_text`) is the richer path. This is a real capability downgrade against
mobile's own history, and it is worth a decision rather than an oversight.

### 5.3 Name collisions — do not score these as parity

Two mobile files would look like they answer web surfaces they do not answer:

- `inbox/inbox_screen.dart` = lifecycle triage over an **offline notes mirror**, not the
  capture-review inbox. It matches web `/app/inbox` (matrix row 5), **not** web `/inbox` (row 15).
- `review/review_screen.dart` = **SM-2** grading (`Hard`/`Good`/`Easy` → `/api/review`), not the
  operator accept/reject surface for review captures. It matches web `/app/review` (row 6), **not**
  row 15.

`mobile/CI.md`'s "Thin Flutter WebView shell" and `placeholder_screen.dart`'s "ADR-0006" are the
same class of defect as these: a mobile-side label that does not survive contact with the repo.

---

## 6. Decisions

### D1 — Rebuild natively to the v2 surface; keep offline-first (operator, 2026-09-26)

**Decision.** `mobile/` is rebuilt **natively** against the web v2 surface, and the app **keeps its
offline-first architecture** (sqflite mirror + mutation queue + `/api/sync` reconcile).

**Explicitly rejected.** Replacing the native app with a **thin WebView shell** wrapping
`nexalog.com/app`. This was considered and is **not** the direction. Note the irony worth recording:
the roadmap row in §4.4 still *describes* the rejected WebView approach, and `mobile/CI.md`'s first
line still repeats it — so the two most authoritative-looking mobile docs currently advertise the
architecture the operator rejected.

**Consequence.** The stale WebView/Codemagic descriptions must not be used as a design brief. §4.4
carries the corrected text.

### D2 — The parity gate is a real rule (`adr/0020-mobile-v2-parity-gate.md`)

**Decision.** The ship gate restated in §1 is recorded as ADR 0020, with the design-parity and
offline-first requirements attached to it. Until now the gate existed only as a doc comment pointing
at two documents that do not exist — i.e. it was not a rule at all, it was a sentence.

**Status.** Proposed — awaiting operator approval, consistent with the status marking on the other
Proposed ADRs in this repo.

### D3 — ADRs for this work live in the root `adr/` series

**Decision.** Parity-gate decisions go in **root-level `adr/NNNN-slug.md`**, per the repo's own
rule (`.claude/rules/documentation.md`: "ADRs live in the **root-level `adr/` directory** (not under
`docs/`)"). Hence `adr/0020-mobile-v2-parity-gate.md`, not a nested per-area `adr/` directory.

**Why this matters more than it looks.** A nested series already caused the bug this document fixes:
`docs/claude/platform/projects/adr/0001-nexalog-projects.md` and `adr/0001-audit-methodology.md`
are **both numbered 0001**, so an unqualified "ADR-0001" in this repo is already ambiguous — and
`mobile/` carried a whole private series that collides with the root one on 0001/0002/0003/0006
(§0.3). **Cite ADRs by path, never by number alone.** A bare "ADR-0006" is not a reference.

### D4 — Open items needing a decision (not decided here)

Listed so they are owned, not lost:

1. **Captures API** (§4.1) — the review surface (row 15) is blocked on a server API. Which shape:
   add `captures` to `/api/sync`, or a dedicated list route projecting `ListInbox`?
2. **Legal surfaces** (rows 19–22) — Play listings require a reachable privacy policy. Link out or
   render in-app?
3. **Identity paths** (row 16) — passkey is the documented identity root (`adr/0016`); mobile has
   none. Either implement or record why not.
4. **Graph** (row 13) — the signature surface is absent. Deferring it is a §1 gate exception and
   needs the operator.
5. **Dead API calls** (§2.5) — `/api/query-views` and `/api/ai/inline` fail silently today. Delete
   the call sites or restore the routes.
6. **`mobile/CI.md` + roadmap row** (§4.4) — both still describe a WebView shell.

---

## 7. How to use this document

- **Before writing mobile code:** find your surface in §3. Its "what done means" cell is the
  acceptance criterion.
- **Before cutting a release:** §1. No placeholders; design and offline-first are part of the gate.
- **When the web surface changes:** re-run §2.1 and §2.2, re-derive the matrix, and update §3.1's
  counts. If a row moves, update it in the same change — a parity doc that drifts is how
  `parity-nexalog.md` became a dangling pointer in the first place.
- **When citing an ADR:** cite the **path** (§6 D3).
