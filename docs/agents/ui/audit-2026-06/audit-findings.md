# Nexalog — UI/UX/Functionality Audit Findings

---

# Run 2 — fresh end-to-end audit (2026-06-11)

**Scope:** All ~34 routes, 32 components, super-admin + app + auth + marketing route groups, **plus the uncommitted `web-history` WIP** (page + `page_visits` schema + settings/sidebar/middleware edits).
**Method:** Local dev server off the *working tree* (so the in-progress feature is covered) + authed headless Chromium at **768 + 1024** (the widths Run 1 skipped); console + network + horizontal-scroll capture across 16 app routes; dev-server runtime-error log; 3 read-only static subagents (state/functionality/a11y sweep, prior-open-findings re-verification, WIP shippability); DB schema check. Two prior docs cross-referenced so nothing already-fixed is re-reported.

**What's clean (verified this run):**
- **Responsive at 768/1024:** zero horizontal scroll on all 16 audited routes; no overlap/clipping. (Run 1 covered 390/1440.)
- Run 1 fixes hold: no dead `href="#"`, settings billing gated, chat auto-titles, icon-button aria-labels, history skeleton.
- Cmd-K now searches notes+bookmarks+themes (prior open item, fixed by c8bae18).
- Note edit/delete now cascade to the graph (`purgeItemFromGraph`) — two prior open pipeline items fixed.

**Open decisions blocking Phase 3 fix-scope (need operator call):**
- **D1 — graph/find/pipeline depth:** 10 items from `nexalog-app-findings.md` (2026-06-10) are still open (listed in §R2-G below). Most are pipeline blast-radius / already-gated (entity-typing, two-graph reconcile). **Include in this fix run, or keep this run UI-only and leave those to their own gated phases?**
- **D2 — the web-history WIP:** uncommitted, **not deployable as-is** (migration 0010 unapplied). **Audit-only and leave for its own finish, or fix/finish it as part of this run?**

## §R2-A — New findings (this run)

### [P0] Uncommitted schema change crashes Settings + every `user_preferences` read until migration 0010 is applied
Screen/route: `/app/settings` (and anything reading prefs — dashboard prefs, web-history)
Repro: Run the working tree against a DB that hasn't had `drizzle/0010_page_visits.sql` applied → load `/app/settings`.
Expected: Code and its migration ship together; no prefs read 500s.
Actual: `lib/db/schema.ts:348-350` adds `save_page_visits` / `history_denylist` / `history_retention_days` to `user_preferences`, but those columns don't exist in the DB (migration 0010 unapplied). Drizzle selects them → `PostgresError: column "save_page_visits" does not exist` → **500, settings white-screens.** Prod is currently safe *only because it still runs the old committed schema.* The moment this code deploys without 0010 applied first, settings + prefs reads break app-wide.
File(s): `lib/db/schema.ts:348-350`, `drizzle/0010_page_visits.sql` (complete: adds both the table and the three columns — just unrun).
Fix approach: Operational, not code — ensure the deploy applies 0010 *before/with* this code. Confirm the deploy path runs drizzle migrations (it has historically NOT auto-run them for the sibling Plexo stack — see ops memory). Gate the merge on migration-applied. (Scope = D2.)

### [P1] `/app/web-history` has no error boundary — missing table/columns throw an unhandled white-screen
Screen/route: `/app/web-history`
Repro: Load before 0010 is applied (table `page_visits` absent).
Expected: Graceful empty/error state, not a crash.
Actual: `app/(app)/app/web-history/page.tsx:24-33` selects from `schema.pageVisits` with no try/catch and no `error.tsx` boundary in the route → unhandled server error. (Same root as P0; called out separately because even post-migration a transient DB error here has no recovery UI.)
File(s): `app/(app)/app/web-history/page.tsx:24-33`.
Fix approach: Add a route `error.tsx` (or try/catch returning an empty/error state). (Scope = D2.)

### [P1] web-history delete is fire-and-forget — optimistic removal never rolls back on failure
Screen/route: `/app/web-history`
Repro: Click row-delete or "Clear all" while `/api/history` DELETE errors (offline/5xx).
Expected: On failure, restore the row(s) + show an error; the prior audit fixed exactly this pattern elsewhere.
Actual: `history-client.tsx:44-61` — `remove()` and `clearAll()` both `setVisits(...)` optimistically then `await fetch(...)` with no `.ok` check, no catch, no rollback. A failed delete looks successful but the data persists (reappears on reload). `clearAll` at least has a `confirm()` guard.
File(s): `app/(app)/app/web-history/history-client.tsx:44-61`.
Fix approach: Check `res.ok`; on failure restore prior state + inline error. (Scope = D2.)

### [P2] `voice-memo` uses raw `alert()` on mic-permission denial
Screen/route: Voice memo capture (global)
Repro: Deny microphone permission.
Expected: Inline error state, consistent with the app's messaging (Run 1 removed `alert()` from import + chat for this exact reason).
Actual: `components/voice-memo.tsx:125` — `alert("Microphone access denied.")`. The lone remaining raw `alert()` in the app.
File(s): `components/voice-memo.tsx:125`.
Fix approach: Replace with the component's inline error state.

### [P2] Bookmark archive: fire-and-forget DELETE + direct opacity DOM hack, no error rollback
Screen/route: `/app/bookmarks`
Repro: Archive a bookmark while `/api/bookmarks/[id]` DELETE errors.
Expected: On failure, undo the visual change + surface an error.
Actual: `components/bookmarks/bookmark-list-card.tsx:171-181` — `handleArchive` does `await fetch(... DELETE)` with no `.ok`/catch, then sets `el.style.opacity = "0.4"` via `document.querySelector`. A failed archive still dims the card (looks gone) but the item reappears on next refetch. Direct DOM mutation also sidesteps React state.
File(s): `components/bookmarks/bookmark-list-card.tsx:171-181`.
Fix approach: Check `res.ok`; lift removal to a parent callback (state) instead of opacity DOM hack; restore + error on failure.

### [P2] web-history search input has no accessible name
Screen/route: `/app/web-history`
Actual: `history-client.tsx:86` — `<input type="search">` with placeholder only, no `aria-label`/`<label>`.
File(s): `app/(app)/app/web-history/history-client.tsx:86`.
Fix approach: Add `aria-label="Search your history"`. (Scope = D2.)

### [P2] Settings history controls: labels not programmatically associated
Screen/route: `/app/settings` (history section)
Actual: `settings-view.tsx:257-274` — the denylist `<textarea>` and retention `<input type="number">` have visible `<label>` text as siblings but no `htmlFor`/`id` association, so screen readers don't tie label→control.
File(s): `app/(app)/app/settings/settings-view.tsx:257-274`.
Fix approach: Add matching `id`+`htmlFor` (or wrap the control in the `<label>`). (Scope = D2.)

### [P2] `/app/bookmarks` still emits external-resource console errors at load
Screen/route: `/app/bookmarks`
Repro: Load bookmarks at 1024 → 2 console errors (`ERR_NAME_NOT_RESOLVED`, `ERR_HTTP2_PROTOCOL_ERROR`).
Expected: Run 1's favicon fix promised zero failed-resource errors here.
Actual: Still 2 errors from external hosts. Likely the `backfill-favicons` script (Run 1 #7) was never run against the prod `nexalog` schema, so stale bad favicon URLs remain; or dead content-image hosts. Lower severity than Run 1's 5-7 but not zero.
File(s): `app/api/img/route.ts` + the favicon backfill script (run-once, may be pending).
Fix approach: Run `scripts/backfill-favicons.mjs` against prod; confirm `displayFavicon` returns null for unvalidated.

### [P3] `synthesis-peek` Accept swallows promise rejection
Screen/route: `/app/synthesis` peek panel
Actual: `components/synthesis-peek.tsx:84-86` — `onClick={() => { void onAccept(); }}`. If `onAccept` rejects, nothing is shown. Low confidence — verify the parent surfaces errors before fixing.
Fix approach: `await` + inline error, or confirm parent handles it.

### [P3] Graph right-rail ships a disabled "coming soon" affordance
Screen/route: `/app/graph`
Actual: `app/(app)/app/graph/right-rail.tsx:129` — `"Promote to Page coming soon"` — an unfinished feature surfaced as disabled UI copy.
Fix approach: Hide until implemented, or finish.

## §R2-G — Prior graph/find/pipeline items still open (from nexalog-app-findings.md, re-verified vs HEAD) — Scope = D1
1. **[P1]** Graph explorer edges near-invisible — `components/.../explorer-graph.tsx:72` stroke `#ffffff18` (~9% opacity). STILL-OPEN.
2. **[P1]** Node labels hidden when `nodes.length > 80` until zoom > 1.3 — `explorer-graph.tsx:233-237,351-354`. STILL-OPEN.
3. **[P1]** Every edge typed `RELATES_TO`; real meaning (`r.fact`) only on hover — `cypher-defaults.ts:29`, `explorer-graph.tsx:302-304`. STILL-OPEN.
4. **[P1]** Every node bare `entity` (no typed entities) — `cypher-graph.ts:44`, `graph-ingest.ts:79`. STILL-OPEN. (gated decision)
5. **[P1]** Two disconnected graph views (themes-forest vs cypher) — `app/api/graph/route.ts:29-52`. STILL-OPEN. (gated decision)
6. **[P1]** Search ignores the knowledge graph — `app/api/search/route.ts:55-63` (notes+bookmarks only). STILL-OPEN.
7. **[P1]** Chat never cites sources — `app/api/chat/[sessionId]/messages/route.ts:269-320` flat context, no citations. STILL-OPEN.
8. **[P2]** @-mentions exclude graph entities/themes — `messages/route.ts:40-114` `resolveAtRefs`. STILL-OPEN.
9. **[P2]** Empty/title-less bookmarks marked ingested forever (`episodeId=null`) — `lib/graph-ingest.ts:190`. STILL-OPEN.
10. **[P2]** Imports create captures with no note + no enrichment — `app/api/import/route.ts:167-176`. STILL-OPEN.
> Verified fixed since 2026-06-10: Cmd-K bookmarks/themes (c8bae18), note-edit re-ingest + note-delete cascade (`purgeItemFromGraph`).

## §R2 Summary
- **P0:** 1 — deploy-ordering blocker (schema vs unapplied migration 0010).
- **P1:** 2 new (web-history error boundary, fire-and-forget delete) + 6 still-open graph/find (D1).
- **P2:** 4 new (voice alert, bookmark archive, web-history input a11y, settings label a11y) + bookmarks console errors + 3 still-open (D1).
- **P3:** 2 (synthesis-peek void, graph "coming soon").
- **Responsive:** clean at 768/1024 (new coverage). **Live render:** clean except the schema-crash on settings/prefs reads + external-host favicon errors on bookmarks.

## §R2 Phase 3 — fixes applied (operator approved D2=fix web-history, D1=include all)
Status legend: ✅ fixed+verified · 🔧 fixed (typecheck only) · ⛔ gated on operator · ↩ reclassified.

**§R2-A new findings:**
- ✅ **P1 web-history error boundary** — added `app/(app)/app/web-history/error.tsx`; browser-verified: route now renders "Couldn't load your web history right now / Try again" instead of a white-screen crash.
- 🔧 **P1 web-history fire-and-forget delete** — `history-client.tsx` `remove()`/`clearAll()` now snapshot prior state, check `res.ok`, roll back + show inline `role="alert"` error on failure.
- 🔧 **P2 voice-memo `alert()`** — replaced with inline `error` state span (`components/voice-memo.tsx`).
- ✅ **P2 bookmark archive** — `bookmark-list-card.tsx`: removed `document.querySelector` opacity hack; now `archived` React state set only on `res.ok`, `if (archived) return null` (true optimistic removal); on failure the card stays for retry. Synthesis/bookmarks browser-verified rendering clean.
- 🔧 **P2 web-history search input** — added `aria-label="Search your web history"`.
- 🔧 **P2 settings history controls** — added `id`+`htmlFor` to denylist textarea + retention input.
- 🔧 **P3 synthesis silent accept** — root-caused beyond the peek: `actOne` (`synthesis/client.tsx`) now catches + returns `boolean` + sets a dismissible `actionError` banner (instead of throwing/replacing the whole body); peek closes only on success; card-accept path also covered. Prop types widened to `void | Promise<unknown>` (client + `synthesis-card.tsx`). tsc green.
- ⛔ **P0 settings/prefs crash** — the fix is applying migration `drizzle/0010_page_visits.sql` to the prod `nexalog` schema (additive columns + table; old code unaffected). **Needs operator OK to touch prod DB.** Until applied, deploying the new schema breaks settings.
- ⛔ **P2 bookmarks external-favicon console errors** — fix is running `scripts/backfill-favicons.mjs` against prod (NULLs unvalidated favicons). **Needs operator OK to touch prod data.**
- ↩ **P3 graph right-rail "coming soon"** — NOT a defect: it's a legitimately disabled button with an explanatory tooltip for non-SCL clusters, not a dead control.

**§R2-G graph/find/pipeline (D1) — re-verification corrected the stale 2026-06-10 claims:**
- ↩ **D1-1 edges invisible** — largely already addressed: default edge stroke is now `#ffffff55` (~33%, visible); the `#ffffff18` is the intentional *search-dim* state for non-matching edges, not the default. No change needed.
- ↩ **D1-2 labels hidden** — already addressed: hub labels are always shown (`d.isHub ? null : "none"`); only non-hub labels declutter until zoom. Reasonable.
- ⛔ **D1-3 `fact` on-canvas edge labels** — design decision (on-canvas edge labels risk clutter in a force graph); `fact` currently surfaces on hover. Needs product direction.
- ⛔ **D1-4 typed entities / D1-5 two-graph reconcile** — pipeline blast-radius (graphiti re-ingestion) + product-architecture decisions. Surface, do not improvise (per brief Phase-3 rule).
- ⛔ **D1-6 search includes graph / D1-7 chat citations / D1-8 @-mentions graph** — feature-sized; need format/ranking direction (note: search already covers notes+bookmarks+themes; raw bare-"entity" nodes are low quality per D1-4, so surfacing them is itself a quality call).
- ↩ **D1-9 empty-bookmark ingest** — edge case, arguably not a defect (no title AND no url = nothing to ingest; marking done avoids re-processing junk each cron).
- ⛔ **D1-10 imports create note** — pipeline-design change.

**Net:** all clearly-correct UI/functionality fixes shipped (7) + tsc green. Remaining are 2 prod-data authorizations (P0 migration, favicon backfill) and the D1 feature/design items — which per the brief's own Phase-3 rule ("design decision / schema change → stop and ask") are surfaced, not improvised.

---

# Run 1 — UI-layer audit (2026-06-09)

**Date:** 2026-06-09
**Scope:** All user-facing routes (~30 screens), 58 API routes, 32 components. Audited live `https://nexalog.com` (authed) at 390px + 1440px via headless Chromium, plus static code review.
**Method:** Every route loaded + screenshotted at both widths; console errors + failed network requests captured; static read of every page/component for state-handling, validation, a11y, dead-ends.

## Resolution status (Phase F — operator approved fix-all 2026-06-09)
| # | Title | Severity | Status |
|---|-------|----------|--------|
| 1 | Settings billing dead-end (404) | P1 | ✅ Fixed — section gated by `isBillingEnabled()` |
| 2 | Quick-capture silent save failure | P1 | ✅ Fixed — error state + catch |
| 3 | Workspace-switcher dead controls | P1 | ✅ Fixed — dropdown removed (switching unimplemented); static label |
| 4 | Chat/note-chat silent errors + alert() | P1 | ✅ Fixed — error states, input restore, alert removed |
| 5 | Import raw alert() errors | P1 | ✅ Fixed — inline error state |
| 6 | Icon close buttons missing aria-label | P1 | ✅ Fixed — quick-capture + search + note-chat |
| 7 | Bookmarks favicon proxy 502 | P2 | ✅ Fixed — enrichment validates favicons (isReachableImage) + stops guessing /favicon.ico; displayFavicon returns stored-or-null; backfill script nulls invalid stored favicons (run post-deploy) |
| 8 | Chat sessions all "New Chat" | P2 | ✅ Fixed — auto-title from first message (client + server) |
| 9 | ConfirmButton timeoutMs=1 flaky dismiss | P2 | ✅ Fixed — plain single-click dismiss button |
| 10 | Dead href="#" links | P2 | ✅ Fixed — non-anchor when url null (capture-list + dashboard) |
| 11 | History no skeleton | P2 | ✅ Fixed — skeleton rows |
| 12 | Title-less notes "Untitled" | P2 | ❎ Not a defect — `noteDisplayTitle` already derives from body; those notes are genuinely empty |
| 13 | Bookmark reader broken copy | P2 | ✅ Fixed — reworded |
| 14 | themes/[themeId] TODO stubs | P3 | ✅ Fixed — removed |
| 15 | Bookmark reader no retry | P3 | ✅ Fixed — Refresh link added |
| 16 | /app/share → today | P3 | ❎ Not a defect — intended PWA share-target redirect when no payload |

**Ship-gate:** `tsc --noEmit` clean · `vitest run` 24/24 pass · `next build` (see Phase F log).

**#7 resolution (operator approved root-cause fix):** No schema migration was needed — a null `favicon_url` already means "show glyph". Changes: (a) `lib/enrichment/metadata.ts` validates each favicon candidate via `isReachableImage` (GET + image content-type, 5s timeout) and stores only a confirmed image, dropping the blind `/favicon.ico` guess; (b) `lib/captures/display.ts` `displayFavicon` returns stored-or-null (no more domain guess); (c) `scripts/backfill-favicons.mjs` re-validates existing stored favicons and NULLs the bad ones — run once against the prod `nexalog` schema after deploy. Net: the UI only ever loads validated favicon images, so no failed-resource/ORB console errors; bad/absent favicons render the kind glyph.

**Pre-existing (out of audit scope, not fixed):** `app/(app)/app/themes/[themeId]/page.tsx:44` — `memberIds` should be `const` (lint error, unrelated to findings).


## Summary
- **P0:** 0 — no data-loss, no blocked critical flow, no security leak. Core capture/note/bookmark/graph/chat/search flows all load 200 and render.
- **P1:** 6 — dead-end to a 404, silent failures with no error feedback, dead controls, a11y blockers.
- **P2:** 7 — broken images, indistinguishable titles, flaky confirm, dead `#` links, missing skeletons.
- **P3:** 3 — unimplemented TODO stubs, missing retry affordance, redirect to verify.

**Render health:** every route returned 200 except `/app/billing` and `/super-admin/coupons` (both intentional `notFound()` — see P1-1). Zero console errors on all screens except `/app/bookmarks` (favicon proxy 502s, see P2-1). Auth, super-admin guard, modal focus-trap, and dark/light theme all working.

---

### [P1] Settings advertises Billing but the link 404s
Screen/route: `/app/settings` → `/app/billing`
Repro: Open Settings → "Billing" section shows "Free plan" + "Manage billing" button → click → 404.
Expected: When billing is disabled, no billing UI is shown (or it explains billing is unavailable).
Actual: `/app/billing` calls `notFound()` because `isBillingEnabled()` is false (Stripe not configured in this deploy), but Settings renders the Billing section + link unconditionally → dead-end.
File(s): `app/(app)/app/settings/settings-view.tsx:155-174` (ungated section); `app/(app)/app/settings/page.tsx` (server — must pass `billingEnabled`); `app/(app)/app/billing/page.tsx:13` (`notFound()`).
Fix approach: In `settings/page.tsx` read `isBillingEnabled()` and pass as prop; wrap the Billing `<section>` in `settings-view.tsx` in `{billingEnabled && (...)}`. (Super-admin nav already does exactly this at `app/super-admin/layout.tsx:36-38` — mirror it.)

### [P1] Quick-capture fails silently — no error feedback on save failure
Screen/route: Global quick-capture modal (⌘-triggered, all app screens)
Repro: Open quick capture, type content, Save while `/api/capture` errors (5xx / offline).
Expected: Inline error ("Couldn't save — retry"), modal stays with content, retry possible.
Actual: `handleSubmit` only acts on `res.ok` true; on `res.ok` false or a thrown fetch there is no branch — `submitting` resets, button returns to idle, no message. User cannot tell the capture failed and may assume it saved.
File(s): `components/quick-capture-modal.tsx:74-95`.
Fix approach: Add `error` state; set it in an `else` (non-ok) and a `catch` (network); render the message in the modal; keep content for retry.

### [P1] Workspace switcher dropdown controls do nothing
Screen/route: Sidebar workspace switcher (renders only when >1 workspace)
Repro: With ≥2 workspaces, open switcher → click another workspace, or "New workspace".
Expected: Selecting a workspace switches active workspace; "New workspace" opens create flow.
Actual: Both handlers only call `setOpen(false)` — no navigation, no state change, no API call. Latent today (the operator has 1 workspace, so the static-label branch renders), but the multi-workspace path ships broken.
File(s): `components/workspace-switcher.tsx:46-65`.
Fix approach: Wire option click to set active workspace (route/cookie/server action per app's workspace model) and "New workspace" to the create flow — or, if multi-workspace is not yet supported, remove the dropdown affordance so it isn't a dead control.

### [P1] Chat & note-chat: silent error handling + raw browser `alert()`
Screen/route: `/app/chat`, note chat panel
Repro: Send a message while the API errors; open chat in an unsupported browser.
Expected: Inline error state + retry; no raw `alert()`.
Actual: `chat-client` swallows fetch errors (no user feedback) and uses `alert()` for the unsupported-browser case; `note-chat-panel` removes the optimistic message on failure with no error shown — message just disappears.
File(s): `app/(app)/app/chat/chat-client.tsx:89-93,121-129,166`; `components/note-chat-panel.tsx:74-75`.
Fix approach: Surface an inline error row + keep/restore the failed message with a retry; replace `alert()` with the app's existing inline messaging.

### [P1] Import errors shown via raw `alert()`, no error state
Screen/route: `/app/import`
Repro: Trigger an upload/patch failure.
Expected: Inline, contextual error ("Upload failed: <reason>") with retry.
Actual: `alert("Upload failed")` — generic browser dialog, no context, no in-page state; PATCH path has no error UI at all.
File(s): `app/(app)/app/import/import-client.tsx:57,84`.
Fix approach: Replace `alert()` with inline error state carrying the server reason.

### [P1] Icon-only close buttons missing accessible names (a11y)
Screen/route: Quick-capture modal, Search modal
Repro: Screen reader / keyboard — the X close button announces as unlabeled "button".
Expected: `aria-label="Close"` on icon-only controls.
Actual: Close buttons wrap a bare `<X/>` icon with no `aria-label`. (Dialog containers have labels; the buttons do not. Note: VoiceReader does this correctly — has aria-labels — use it as the pattern.)
File(s): `components/quick-capture-modal.tsx:126-127`; `components/search-modal.tsx:133-134`. Also check title input label at `app/(app)/app/notes/[id]/note-editor.tsx:102-109`.
Fix approach: Add `aria-label="Close"` to each icon button; add `aria-label`/`<label>` to the note title input.

---

### [P2] Bookmarks: favicon image proxy returns 502 → broken images
Screen/route: `/app/bookmarks`
Repro: Load bookmarks; several favicons fail.
Expected: Favicon renders or a clean fallback glyph; no console errors.
Actual: `/api/img?url=…/favicon.ico` returns 502 for multiple hosts (midjourney, tmdb, karakeep.example.com, brainvolt, getplexo); one also `ERR_BLOCKED_BY_ORB`/`NotSameOrigin`. 5–7 console errors per load — the only screen with console errors.
File(s): `app/api/img/route.ts`; favicon-rendering bookmark card (`components/bookmarks/*`).
Fix approach: Investigate the proxy 502 (upstream fetch/timeout/headers); ensure a deterministic fallback icon so a failed favicon never logs an error or shows a broken image.

### [P2] Chat sessions all titled "New Chat"
Screen/route: `/app/chat`
Repro: Sidebar lists 3 sessions, all labeled "New Chat" — indistinguishable.
Expected: Auto-title from first user message (or timestamp) so sessions are distinguishable.
Actual: Sessions never get a derived title.
File(s): `app/(app)/app/chat/chat-client.tsx`; `app/api/chat/sessions/route.ts`.
Fix approach: On first message, set session title to a truncated first prompt (or show created-at as fallback in the list).

### [P2] Title-less notes show "Untitled" everywhere — indistinguishable
Screen/route: `/app/dashboard` (Recent notes), `/app/notes`
Repro: Recent-notes list shows 5 rows all "Untitled".
Expected: Derive a label from the note body's first line when there's no title.
Actual: All title-less notes render the literal "Untitled" — users can't tell them apart in lists.
File(s): notes list rendering + dashboard recent-notes.
Fix approach: Fallback label = first non-empty body line (truncated) when title is empty; keep "Untitled" only for genuinely empty notes.

### [P2] `ConfirmButton timeoutMs={1}` makes suggestion-dismiss flaky
Screen/route: `/app/synthesis` (suggestion cards)
Repro: Click the dismiss (X) on a suggestion.
Expected: Reliable dismiss. (This is a non-destructive hide — arguably needs no two-step at all.)
Actual: `timeoutMs={1}` arms then disarms in 1ms, so the confirming second click almost never lands in-window; `confirmLabel` is the same X icon, giving no "armed" feedback. Dismiss feels broken/unresponsive.
File(s): `components/synthesis-card.tsx:155-163`; `components/confirm-button.tsx`.
Fix approach: For a non-destructive dismiss, use a plain single-click button; if a guard is wanted, use a sane `timeoutMs` (e.g. 3000) and a distinct armed label.

### [P2] Dead `href="#"` links when a URL is missing
Screen/route: `/app/dashboard` (recent bookmarks), capture lists
Repro: A bookmark/capture with null url renders a link to `#` → clicking scrolls/no-ops.
Expected: Render non-interactive (no anchor) when there's no destination.
Actual: `href={… ?? "#"}` produces a link to nowhere.
File(s): `components/capture-list.tsx:37`; `app/(app)/app/dashboard/page.tsx:136`.
Fix approach: Conditionally render a non-anchor element (or omit the link) when url is null.

### [P2] History list shows bare "Loading…" text (no skeleton)
Screen/route: `/app/history`
Repro: Load while conversations fetch.
Expected: Skeleton rows reserving layout (no shift on resolve).
Actual: Plain "Loading…" text, then content pops in.
File(s): `app/(app)/app/history/*` (around the fetch/render at ~43-44).
Fix approach: Replace with skeleton rows matching the resolved card height.

### [P2] Bookmark reader: ungrammatical copy
Screen/route: `/app/bookmarks/[id]/reader`
Repro: Open a bookmark whose reader text isn't extracted.
Expected: "Click **Open the original** to read it on the source."
Actual: "Use Open the original to read it on the source" (broken sentence).
File(s): `app/(app)/app/bookmarks/[id]/reader/page.tsx:165` (approx).
Fix approach: Reword the copy.

---

### [P3] `themes/[themeId]` has commented-out TODO features
Screen/route: `/app/themes/[themeId]`
Actual: Two commented TODOs (Levio task search, Plexo chats) — partially-built, unfinished.
File(s): `app/(app)/app/themes/[themeId]/page.tsx:188-189`.
Fix approach: Remove dead TODO scaffolding or finish; at minimum don't ship commented stubs.

### [P3] Bookmark reader "Reader text not available yet" has no retry
Screen/route: `/app/bookmarks/[id]/reader`
Actual: Placeholder state with no refresh/retry affordance — user must manually reload.
File(s): `app/(app)/app/bookmarks/[id]/reader/page.tsx:152-158` (approx).
Fix approach: Add a "Retry extraction" / refresh button.

### [P3] `/app/share` redirects to `/app/today` — confirm intent
Screen/route: `/app/share`
Actual: Loading `/app/share` (no share payload) lands on `/app/today`. Likely a PWA share-target handler; flagged only to confirm this is intended and not a swallowed route.
File(s): `app/(app)/app/share/page.tsx`.
Fix approach: If intended, no change. If `/app/share` is meant to render something standalone, fix the redirect.

---

## Audited & clean (no findings)
Super-admin auth guard + billing-aware nav; modal focus-trap + `aria-modal` (quick-capture, search); dark/light theme; graph + graph/explorer render; notes/notes[id], today, inbox, queue, reading, reference, sites, watch, journal, synthesis, login, landing, privacy/terms/refund/cookie — all 200, render correctly at 390 + 1440, no console errors.

## Screenshots
`/tmp/nx-audit/*.png` (`<route>__390.png` / `<route>__1440.png`), machine report at `/tmp/nx-audit/report.json`.
