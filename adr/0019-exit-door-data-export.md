# ADR-0019 — The exit door: data export, portability, and deletion

- **Status**: **Accepted 2026-09-26 for scope, format, delivery and the audit record — EXCEPT
  deletion, which is split out to `adr/0021-deletion-and-purge-semantics.md` (Proposed).** The
  approval covers D1 (whole-account scope), D2 (bundle format, ZIP, git-bundle opt-in), D3
  (streamed delivery + byte cap) and D5 (the `export_events` record) — plus D4.1 and D4.4, which
  are inherited by ADR-0021. **D4.2 and D4.3 — the deletion flow, the grace window, the git-history
  disclosure and the shared-identity question — are NOT approved here and are not implementation
  authority.** Two of the eight open questions are also not answered by this approval: Q5 (legacy
  v1 store) awaits the read-only production inspection, and Q8 (who can export) remains open.
- **Deletion**: split out — see `adr/0021-deletion-and-purge-semantics.md` (Proposed, the
  operator's to decide). A reader looking for deletion lands there.
- **Accepted**: 2026-09-26 (operator; dispositions per §Open questions — operator dispositions)
- **Date**: 2026-09-25 · **Renumbered** from 0018 when the Projects Phase 2 design took that number
  in the same batch.
- **Phase**: PKM expansion Phase 1.4 (data export / "exit door")
- **Owner**: operator (this gate) · build agent (implementation, after approval)
- **One-way door**: the bundle layout, the `manifest.json` keys, and the `export_events` record become a long-term contract that users and external tools depend on. Adding keys is safe; renaming or removing one is breaking.
- **Supersedes (for v2)**: ADR-0002 (data export & portability format) and ADR-0009 (data export format) — both were written against the **v1 Postgres content model**. Neither is deleted; both stay as the historical record, and this ADR does not edit their decisions.
- **Related**: `docs/claude/platform/pkm-expansion/plan.md` §1.4 · ADR-0014/0015 (ports + adapters) · `.claude/rules/clean-architecture.md` · `.claude/rules/database.md` · `.claude/rules/data-modeling.md`
- **Deletion half**: `adr/0021-deletion-and-purge-semantics.md` — the operator's 2026-09-26
  approval split all deletion semantics out of this ADR; D4.2/D4.3 below are the *input* to that
  record, not a decision made here.

## Context

The audit called the missing exit door "the deepest sovereignty deficit … the opposite of Obsidian's pitch" (`audit-2026-06/nexalog-state-report.md` §7, gap matrix row "Plain-file portability / **export**"). Two decisions have already been written against it, and a v1 exporter was built:

| Record | Date | Status |
|---|---|---|
| `adr/0002-data-export-portability-format.md` | 2026-06-13 | Proposed — Options 1/2/3, recommended "markdown zip + full JSON". Never acted on. |
| `adr/0009-export-format.md` | 2026-06-27 | Proposed — "supersedes the operational specifics of ADR-0002". **Implemented**: `85089e0`, merged `03ceda2`. |
| `apps/web/app/api/export/route.ts` + `apps/web/lib/export/*` | on `main` | Streams a ZIP: `notes/<workspace>/<id>-<slug>.md`, `journal/<date>.md`, `captures.csv`, `note_links.json`, `manifest.json`. Settings has a "Download my data" link. |

**Why this needs re-deciding rather than reusing ADR-0009.** Both prior ADRs assume the user's content lives in `nexalog`-schema Postgres tables (`notes`, `captureSources`, `noteLinks`, `journalEntries`) and that the export problem is *serialization* — converting stored HTML and columns into portable files. That is no longer where the data is. Since the v2 pivot:

- **The brain git repo is the system of record.** `nexalog-v2-compose.yml` bind-mounts `/srv/brain/pages` at `/repo` (`BRAIN_REPO=/repo`), and the v2 write path is `FsGitBrainStore` — captures land as `inbox/<ulid>.md` with a `nexalog:` frontmatter block (`nexalog.schema=1`), pages as `<type>/<slug>.md`, binaries as `attachments/YYYY/MM/<base>.<ext>` (`packages/adapters/src/brain-fs-git/fs-git-brain-store.ts`).
- **Postgres is app-state only.** The v2 app-state database `nexalog_v2` is bootstrapped with exactly three tables — `capture_index`, `api_tokens`, `read_state` (`db/migrations/0000_nexalog-v2-bootstrap.sql`) — and its comment is explicit: "no page text, no inbox bodies, no content ever lands here." `capture_index` is *derived* and rebuildable (`ReindexRepo`).
- **Identity is not Nexalog's.** Better Auth points at the **shared** `auth` schema in the shared database ("single login universe — v2 must NOT fork its own auth tables").

So the v2 exit door is a different problem from ADR-0009's. The content is *already* portable files in a git repo; what is missing is a way to **hand them over as a complete, verifiable bundle**, together with the parts of the account that live outside the repo, and an explicit answer to "and then what happens to the server's copy".

Two facts sharpen this and both need the operator's ruling (§Open questions):

1. **Content files carry no user identity.** `serializeCapture` writes `schema, status, kind, source, captured_at, claimed_by, claimed_at, attachments, attachment_kinds, origin_url, proposal` plus `type` and `title` — `claimed_by` is the *agent* (`agent-primary`), not the user. There is no `user_id` in any content file. Per-user scoping is therefore not currently expressible from the repo, and the deployment is configured single-operator (`DISABLE_SIGN_UP: "true"`, `api_tokens.name` = `'agent-primary' | 'agent-secondary'`).
2. **The deployment has two stores right now.** The carried-over v1 routes (`app/api/notes`, `app/api/bookmarks`, `app/api/journal`) still query `apps/web/lib/db/schema.ts` — the 34-table v1 model. Whether those tables exist and hold the operator's real content inside `nexalog_v2` is a **production fact this ADR does not verify** (no DB access from this work). It decides whether the exit door covers one store or two.

## What "the data" is, in v2

| Class | Where it lives | In the export? | Why |
|---|---|---|---|
| Pages / notes (markdown + frontmatter) | brain repo `<type>/<slug>.md` | **Yes, verbatim** | User-authored content; already the portable form. |
| Captures | brain repo `inbox/<ulid>.md` (`nexalog.schema=1`) | **Yes, verbatim** | Includes the worker's `proposal` block and the origin URL. |
| Attachments (binaries) | brain repo `attachments/YYYY/MM/*` | **Yes, raw bytes** | Referenced by path from capture frontmatter; not re-creatable. |
| Links / graph edges | `[[wikilinks]]` + frontmatter in the files; GBrain edges | **Yes, via the files** | Already in the bytes; GBrain's graph is derived from them. |
| Read state (unread markers) | app-state `read_state` | **Yes, as JSON** | User-generated state, not derivable. |
| Captures index | app-state `capture_index` | **No** | Derived from the repo; `ReindexRepo` rebuilds it. |
| API token *metadata* | app-state `api_tokens` | **Metadata only** | Name/prefix/dates/revoked. **Never `token_hash`** — see §Exclusions. |
| Identity (email, passkeys, sessions) | shared `auth` schema (shared DB) | **Account record only, no credentials** | Cross-app; credentials are not portable and must not travel. |
| GBrain index / embeddings / derived themes | GBrain store | **No** | Re-derivable, model-version-specific; ADR-0009 excluded embeddings for the same reason. |
| Chat session history | v1 `chat_*` tables (v2 §1.7 deleted the routes) | **No** | UX state, not authored knowledge — ADR-0009's reasoning still holds. |
| Legacy v1 store | `apps/web/lib/db/schema.ts` tables | **Open question 5** | Depends on what prod actually still holds. |

## Decisions

### D1 — The unit of export is the whole account, and for a single-operator deployment the repo *is* the account

Whole-account is the contract: every page, every capture, every attachment, the user-scoped app-state, and a non-secret account record. Scoped subsets (by type, by date range, by source) may be added later **as labelled conveniences**; they never replace or approximate the whole-account export, and the UI must not present a filtered download as "your data".

Because content files carry no user id (Context §1), per-user scoping is not available today and is **not** invented by this ADR. The decision is either (a) accept whole-account = whole-repo for the single-operator deployment, which is the honest description of the current product, or (b) commit to adding a user field to the frontmatter contract (`nexalog.schema` 2) — a one-way door of its own, with a migration across every existing file. **Recommendation: (a) now, (b) only when a second user actually exists.** Writing an attribution field we do not yet need would put a guess into a contract before there is a fact to base it on.

### D2 — Format: the repo's own files, in a plain archive, described by a manifest

Three artifacts, one bundle:

1. **`pages/` and `inbox/`** — the markdown as it exists on disk, frontmatter included, byte-for-byte. No conversion, no re-serialization, no normalization. This is a deliberate change from ADR-0009, whose central risk was HTML→markdown lossiness; in v2 there is nothing to convert, so the export is lossless **by construction** rather than by promise.
2. **`attachments/`** — the binary files at their existing repo-relative paths (`attachments/YYYY/MM/<base>.<ext>`), so the paths in capture frontmatter resolve inside the bundle without a mapping table.
3. **`manifest.json`** — the completeness contract:
   ```json
   {
     "exportSchemaVersion": 1,
     "appCommit": "<sha>",
     "exportedAt": "<ISO-8601 UTC>",
     "scope": "account",
     "stores": ["brain-repo", "app-state"],
     "contentContract": { "nexalog.schema": 1 },
     "counts": { "pages": 0, "captures": 0, "attachments": 0, "readState": 0 },
     "files": [{ "path": "inbox/01J8….md", "bytes": 0, "sha256": "…" }]
   }
   ```
   The per-file `sha256` is the point, not decoration: an exit door must let the user **prove nothing was withheld**, and let the server's audit record be reconciled against the copy the user holds (D5). A file listed in a capture's `attachments:` array that is absent from the bundle is a bug the manifest can detect.
4. **`account/`** — `identity.json` (non-secret profile fields) and `app-state.jsonl` (one `read_state` row per line; token metadata as objects).

Bundle container: **ZIP**, streamed, one file — universally openable, keeps the directory tree, and `archiver@^8.0.0` is **already** a dependency of `apps/web`, so this needs no dep-add gate. Markdown + YAML frontmatter + raw attachments is also Obsidian's own shape, so the portable tier is compatible by construction; the `nexalog:` block is extra frontmatter Obsidian ignores.

**Git history is a second, optional artifact** — a `git bundle` of the repo, offered alongside the ZIP, never instead of it. History is real fidelity (previous versions of the user's own thinking) but it requires git to open and puts the payload's bytes behind a tool; keeping it opt-in means the default download is something a non-technical user can unzip and read. See §Options considered for the trade-off against shipping both by default.

### D3 — Delivery: stream from the first byte; go async only above a threshold

The delivery path is **Cloudflare Tunnel → Next.js** (`ingress-net` in the compose; a live `app.nexalog.com` is served through it). Cloudflare's proxy read timeout on the non-Enterprise plans is fixed and cannot be raised (~100–125 s), and it is measured as **silence before the first response byte / between reads** — so a response that computes the whole archive before emitting anything is a 524 waiting to happen, and a stream that keeps emitting bytes resets the clock.

Therefore, in priority order:

1. **Streamed `GET /api/export`** (the v1 shape, kept): read the repo, `archive.finalize()`, adapt the Node `Readable` to the web stream, `Content-Type: application/zip`, `Content-Disposition: attachment; filename="nexalog-export-<idShort>-<YYYYMMDD>.zip"`, `Cache-Control: private, no-store`. Never buffer the archive in memory, never compute-then-send. The short id in the filename is deliberate (ADR-0009's reasoning, kept): the user needs to disambiguate their own archives; a downloaded filename is not the place to leak the full account id.
2. **A configured byte cap** (env, default ~2 GiB) above which the streamed route refuses with an honest, specific error rather than dying mid-transfer at a proxy timeout.
3. **Async job + single-use signed link** above the cap. This is the fallback, not the default: it buys unbounded exports at the cost of a job store, a link with its own expiry, and a staging artifact that must be deleted after delivery (D4).

Attachment intake limits bound the realistic size: 25 MB per file and 20 attachments per capture (`packages/core` `CreateCapture`), plus a 10 MB body guard — so the archive is dominated by attachment bytes and is cheap to produce from local disk. **Recommendation: ship (1) and (2) in Phase 1.4 and treat (3) as the follow-up that the cap exists to defer**, because at the current scale the whole repo is a few hundred files (the graph feature reported 60 pages / 37 edges in the live snapshot) and the async machinery would be built for a size the product has not reached.

### D4 — Retention and deletion: the export is a read; deletion is a separate, explicit, two-step act

> **This section was SPLIT OUT by the operator's 2026-09-26 approval.** Only **D4.1** (exporting
> deletes nothing) and **D4.4** (no shadow archive) are approved here. **D4.2 and D4.3 are NOT
> approved** — the deletion flow, the grace window, the git-history disclosure and the
> shared-identity question are deferred to `adr/0021-deletion-and-purge-semantics.md` (Proposed).
> The text below is the input to that record, not a decision made by this ADR.

This is where "exit door" gets decided rather than asserted.

**D4.1 — Exporting deletes nothing.** A download is a read. Conflating export with deletion means one misclick destroys the account, and the house rule already forbids single-click destructive actions (`app/inbox/review-actions.tsx` made *reject* two-step for exactly this reason). The user is told plainly: "this is a copy; your account still exists."

**D4.2 — Deletion is its own flow, and it has to say what it actually deletes.** *→ NOT approved
here; deferred to `adr/0021-deletion-and-purge-semantics.md` (Q1 two-step flow, Q2 grace window).*
Requested deletion is two-step (type/confirm), has a **grace window** (recommend 7–30 days) during which the account still works and the export is re-downloadable, and then executes:

| Layer | Action | Note |
|---|---|---|
| App-state (this app) | Delete the user's `read_state` rows; revoke `api_tokens`; delete any export-job staging | Straightforward, this app's own data. |
| Content (brain repo) | **Only whole-repo or explicitly named files** | Content carries no user id (Context §1), so "delete user X's content" cannot be expressed. Whole-repo deletion is only correct if the deployment is single-user — which it currently is, and which must be confirmed (Open question 2). |
| Identity (shared `auth` schema) | Deactivate vs delete | **Cross-app blast radius** — one login universe across the Joeybuilt apps. Not Nexalog's decision alone (Open question 4). |
| Derived | `capture_index` rows for deleted files; GBrain re-sync | Falls out of the above; nothing extra is stored. |

**D4.3 — Git makes deletion a different promise than it looks like.** *→ NOT approved here;
deferred to `adr/0021-deletion-and-purge-semantics.md` (Q3 git-history disclosure).* The system of record is a **git repository**, so removing a file deletes it from the working tree, not from history: `git log` still serves the content, and every existing clone (the container, the operator's machine, gbrain's bind-mount) still holds it. Honest options are (a) accept and **disclose** that prior versions remain in history until a rewrite, (b) rewrite history (`git filter-repo`-class), which invalidates the shared history and breaks every clone — a step this repo has previously recommended *against* for its own housekeeping, or (c) for a single-user deployment, delete the repo and start a fresh one. **Recommendation: (a) as the stated behavior, with the consequence written in the deletion UI**, and (c) offered when the operator confirms single-user. A deletion flow that quietly leaves the content in history is worse than one that says so.

**D4.4 — No shadow archive.** The server must not retain a second copy of the data as a side effect of exporting: no cached export artifact, no staged archive kept "just in case". If the async path (D3.3) is ever built, its staging file is deleted the moment delivery completes, and that deletion is part of the design, not an operational nicety.

### D5 — Provenance: the audit record stores the *fact*, never the data

A new app-state table `nexalog.export_events`: `id`, `user_id`, `requested_at`, `scope`, `export_schema_version`, `file_count`, `total_bytes`, `manifest_sha256`, `outcome`, `duration_ms`, `requester` (session or token id).

Deliberately absent: content, file paths, and anything that could reconstruct the archive. `manifest_sha256` is the key field — it lets the user hash the manifest they downloaded and check it against the server's record, so "the export happened, and here is what it contained" is provable **without the server keeping what it contained**. Per `data-modeling.md`, this is rows in a table (queried, reported on), with explicit timestamps; per `database.md`, it arrives with a migration in the same change and is applied forward-only through the tooling applier.

### D6 — Layering: use case in `core`, I/O in an adapter, route thin

The export follows the same wall as everything else (`clean-architecture.md`), and it needs one honest addition to do so:

- **Use case — `packages/core/src/application/` (`ExportAccount`).** Orchestrates: enumerate what to include → hand entries to the archiver port → return the manifest. Pure; takes ports and a clock; no fs, no zip library, no db. `core` has **zero runtime deps** (`core-is-pure` is a blocking depcruise rule), so `archiver` may not appear here.
- **Ports — the current `BrainStore` cannot serve this, and that is the real work item.** It can `listCaptures()` (the `inbox/` set) and `getPage(slug)`, but it has **no way to enumerate all pages** and **no way to read attachment bytes** — there is no `readAttachment`, and `saveAttachment` returns a path, not content. The export therefore requires new read capabilities behind the existing port (enumerate pages; read an attachment by repo-relative path). Declared in `core`, implemented in `packages/adapters`.
- **Adapter — the archive/bundle writer** lives with the other infra (`packages/adapters`, next to `FsGitBrainStore`), importing `archiver` and node streams. It is the implementation of the archive port, so `core` stays clean.
- **App-state reads** go through the existing `AppStateRepo` port (`packages/adapters/src/db-drizzle/drizzle-app-state-repo.ts`), **not** a fresh `@/lib/db` import: `apps/web/lib/export/load.ts` is already one of the nine baselined `web-lib-no-direct-db` call sites, and the exit door must not lengthen that ratchet list.
- **Route — `apps/web/app/api/export/route.ts`**: auth via `getAuthUser()`, validate, call one use case, map to a stream + status + headers. `runtime = "nodejs"` (node streams + fs), `dynamic = "force-dynamic"`. The route holds no rules — the "what is included" and "may this user export" decisions live in the use case.
- **Plexo/GBrain optional.** The export reads the local repo and app-state only. It must work standalone with no Plexo, no GBrain, and no network — which is also why the graph is exported as files rather than as a graph API call.

Constraints this respects: shared Postgres (app-state in the `nexalog` schema of `nexalog_v2`; **no app tables in the shared `auth` schema**), Next.js 16 App Router, forward-only migrations, no `db:push`, MIT SPDX header on new files.

## Options considered

**A. Bundle format.**
- *ZIP of the repo tree + manifest + account record* — human-openable, attachments visible, no new dependency, history lost. **Recommended default.**
- *`git bundle` only* — preserves history and is the store's native shape, but requires git to open and hides binaries inside the object store; a user without git cannot read their own memories. Rejected as the only artifact.
- *Both by default* — maximal fidelity, but duplicates the payload, and the bulk **is** the attachments (the repo would grow by its own size). Rejected as default; kept as the opt-in second artifact (D2).

**B. Delivery.**
- *Sync stream* — simplest, no state, matches v1 and the existing architecture; bounded by the fixed Cloudflare timeout on a stream that never stalls. **Recommended default.**
- *Async job + link* — unbounded size, survives a closed browser tab; costs a job store, link expiry, a staging artifact to delete, and a second code path. **Deferred above a cap** rather than built first.
- *In-app copy into the brain repo* — meaningless here: the brain repo **is** the store; copying it into itself is not an exit.

**C. Deletion semantics.**
- *Non-destructive export + separate purge flow* — a read cannot destroy an account; matches the house no-single-click-destructive rule. **Recommended.**
- *Export triggers deletion* — one action, one intent, and one misclick away from an irreversible loss with no confirmed copy. Rejected.
- *Export + immediate purge* — same failure with no grace window; also makes the export's completeness unverifiable after the fact. Rejected.

**D. Scoping.**
- *Whole-account by default* — the only form that satisfies the promise; **recommended** (D1).
- *Per-workspace* — not expressible: v2's content path has no workspaces (the repo is typed by directory: `people/`, `projects/`, `atoms/`, `inbox/`), and the concept survives only in the legacy v1 tables. Not offered.
- *Per-user* — blocked on content attribution that does not exist yet. Deferred (D1).

## Exclusions (deliberate, and stated to the user)

- **`api_tokens.token_hash`** — never exported. It is a plain `sha256` of a live bearer token, so including it would hand an attacker an offline-crackable target for a low-entropy token. Metadata (name, prefix, dates, revoked) is exported; the secret is not.
- **Identity credentials** — password hashes, passkey credential material, and session tokens from the shared `auth` schema never leave it. Not portable to another system, and exporting them is a liability for no benefit.
- **Embeddings and GBrain's index/graph/derived themes** — re-derivable, model-version-specific, and not Nexalog's store.
- **Archive-level encryption** — declined, ADR-0009's reasoning unchanged: there is no zero-knowledge layer, so encrypting the archive with a key the server also knows would be theater.
- **Secrets and environment** — no `AUTH_SECRET`, no connection strings, no vendor keys, ever, in any artifact.

## Consequences

- The bundle layout, `manifest.json` keys, and `export_events` shape become a **public contract** from the first commit that ships them; add keys, bump `exportSchemaVersion` for anything breaking.
- The portable tier is lossless by construction (no conversion in the path), which removes ADR-0009's standing "HTML-in-markdown is ugly" caveat — for v2 content. The legacy store, if it is in scope (Open question 5), keeps v1's conversion risk.
- Deletion is now describable in layers, and one of those layers — git history — means the honest promise is "removed from the working tree and the account, and disclosed in history until a rewrite". The product copy must match that; over-promising deletion is a trust bug. **Whether that promise is the one shipped is `adr/0021-deletion-and-purge-semantics.md`'s decision, not this ADR's.**
- Adding read capabilities to `BrainStore` (`enumerate pages`, `readAttachment`) is a **port change** and therefore ADR-worthy in its own right if it grows beyond those two methods; it is named here so it is not smuggled in as a helper function.
- `export_events` is a **new table**: it needs a migration in the same change as the schema edit, and a prod apply is operator-gated (data touch, not a one-way door).

## Verification (how we will know it works)

1. **Completeness, mechanically:** every path in any capture's `attachments:` array appears in the bundle, and the bundle's file set equals the manifest's. This is a test, not a spot check.
2. **Round-trip sanity** (the plan's §1.4 ship gate): extract the bundle, compare the file set and the `nexalog.schema=1` frontmatter against the source repo — the export is the source of record, so parity is exact equality, not a similarity judgement.
3. **Standalone proof:** the export completes with GBrain unreachable and no Plexo configured.
4. **Deletion proof:** after a requested purge, the account cannot authenticate, the app-state rows are gone, and the audit record still proves the export happened. *(Deferred — the deletion flow is `adr/0021-deletion-and-purge-semantics.md`; this verification item belongs to that record.)*

## Open questions — operator dispositions (approved 2026-09-26)

Approved 2026-09-26 **for everything except deletion**. Dispositions are recorded below; the
deletion questions are explicitly deferred to `adr/0021-deletion-and-purge-semantics.md`, and the
questions that this approval does **not** answer are marked as such rather than filled in.

1. **The ADR number and record.** — **Confirmed:** a new ADR (this one, `0019`) that supersedes
   ADR-0002 and ADR-0009 *for v2*, with both left untouched as the historical record.
2. **Is this deployment single-user?** — **Confirmed single-user.** The deployment is configured
   that way (`DISABLE_SIGN_UP: "true"`), so whole-repo = whole-account (D1) and whole-repo
   deletion is available (→ `adr/0021-deletion-and-purge-semantics.md`).
3. **What does "leave" mean on the server?** — **Split.** The approved half is **"export deletes
   nothing"** (D4.1) — a download is a read, and the user is told "this is a copy; your account
   still exists". The deletion mechanics (two-step flow, grace window) are **deferred to
   `adr/0021-deletion-and-purge-semantics.md`**, not decided here.
4. **Deleting the identity has cross-app blast radius.** — **Deferred in full to
   `adr/0021-deletion-and-purge-semantics.md`** (Q4): the shared `auth` schema, the "delete
   everywhere vs deactivate for Nexalog only" fork, and whose call it is. Not answered here.
5. **Is the legacy v1 content store in scope?** — **NOT answered by this approval.** Whether
   prod's `nexalog_v2` still holds the v1 tables is a production fact this ADR never verified; it
   is being closed by a **read-only production inspection, not assumed from the repo**. Until it
   lands, the legacy store's scope — and the fate of the shipped v1 `apps/web/app/api/export/route.ts`
   — stays open. (Same unknown as `adr/0018-projects-reference-based-containers.md` question 5.)
6. **Git history in the export.** — **Confirmed as the ADR's default: opt-in second artifact.** A
   `git bundle` is offered alongside the ZIP, never instead of it.
7. **Size and time limits.** — **Confirmed as the ADR's default:** ship the **streamed** route plus
   the configured **byte cap** (default ~2 GiB); the async job path stays the follow-up the cap
   exists to defer.
8. **Who can export?** — **NOT answered by this approval.** Web session only, or agents holding
   `api_tokens`, and whether the mobile client needs it in this phase, remain open.

**Scope approved by this approval, stated positively:** whole-account scope (D1); format = the
repo's own files **byte-for-byte** (`pages/`, `inbox/`, raw `attachments/`) plus a `manifest.json`
carrying a **per-file `sha256`** (D2); **ZIP** via the already-present `archiver` (D2); a
`git bundle` as the **opt-in** second artifact (D2); delivery by **streaming from the first byte**
plus a configured size cap (D3); the `export_events` audit record (D5); and **export deletes
nothing** (D4.1) with **no shadow archive** (D4.4). **Everything concerning deletion is out** and
lives in `adr/0021-deletion-and-purge-semantics.md`.

## Out of scope — what this ADR does not commit to

- **Deletion and purge semantics** — the two-step flow, the grace window, the git-history
  disclosure, the shared-identity blast radius and the legacy-store scope. Split out to
  `adr/0021-deletion-and-purge-semantics.md` (Proposed) by the 2026-09-26 approval.
- **Local-first / offline sync and CRDT.** Parked in the plan on an unresolved product/business decision; an export is not a sync protocol.
- **Zero-knowledge / E2E encryption.** Structurally incompatible with server-readable intelligence; a separate product decision.
- **A public plugin API or third-party export format support.** Jex covers inbound integration; a public contract is its own commitment.
- **Continuous/backup replication, delta or incremental exports** — one snapshot per request is the agreed primitive.
- **Adding a user/attribution field to the frontmatter contract** (`nexalog.schema` 2). Named as the prerequisite for per-user scoping (D1) and for per-user content deletion (D4.2), decided elsewhere if at all.
- **Re-importing the export back into Nexalog.** The bundle is designed to be re-importable (it is the source-of-record format), and §Verification uses that, but shipping an import path is not part of this decision.
- **Retiring the v1 exporter and the legacy store.** Open question 5; whichever way it goes, it is a separate change.
