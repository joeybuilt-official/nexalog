// SPDX-License-Identifier: MIT
/**
 * The plan-impact reconciler's SQL fragments and value rules, with no IO of their
 * own — the same split `lib/queue/lenses.ts` uses, for the same reason.
 *
 * WHY THE SQL LIVES HERE AND NOT IN THE RUNNER
 * -------------------------------------------
 * `web-lib-no-direct-db` is an error-adjacent architecture rule (a baselined
 * `warn`): a `lib/<feature>` slice may not import `@/lib/db`. This module imports
 * only `drizzle-orm`'s `sql` tag, so the fragment is unit-testable against BOTH
 * stores' column shapes without a database, and the two places that DO talk to a
 * database — the reconcile runner (the app's `pushd` reads) and the gbrain adapter
 * (`take_proposals`) — stay explicit about which store they are touching. Nothing
 * here executes anything.
 *
 * THE WINDOW IS ON THE EFFECTIVE SAVE DATE
 * ----------------------------------------
 * `COALESCE(bookmarked_at, created_at)` is the date the bookmark list sorts by, and
 * the one `drizzle/0008_bookmarked_at.sql` added the column for. The distinction is
 * load-bearing in both directions:
 *
 *   - `created_at` ALONE would treat every row written by an IMPORT as new today,
 *     even when its save date is months old — one importer run would propose a plan
 *     change for every bookmark it carried, which is the stampede the acceptance
 *     bar's "EXACTLY 1" exists to prevent.
 *   - `bookmarked_at` ALONE would silently skip every row that never carried one
 *     (the column is nullable, and the browser extension / manual-save path writes
 *     no `bookmarked_at` — the route lets the column default, so the row's save
 *     date IS `created_at`).
 *
 * The live index `capture_sources_bookmarked_at_idx` is
 * `(workspace_id, bookmarked_at DESC NULLS LAST, created_at DESC)`, so the order
 * below matches its sort direction.
 *
 * NOT WORKSPACE-SCOPED, STATED PLAINLY
 * ------------------------------------
 * Every request-path read in this app scopes to the caller's workspaces. This one
 * cannot: it runs OUTSIDE a request (a scheduled reconcile pass has no session),
 * and this deployment is the single-operator brain the app is built for — Better
 * Auth with registration disabled, one workspace. If a second workspace ever
 * exists this fragment takes a workspace id and the runner supplies one per
 * workspace; defaulting to the first would silently ignore the rest, which is worse
 * than the current, honest absence.
 */

import { sql, type SQL } from "drizzle-orm";

/** The table the reconcile read walks, spelled out so fragments compose. */
const CAPTURE = sql.raw("nexalog.capture_sources");

/**
 * How far back a reconcile pass with no stored cursor looks. A DAY is the unit
 * that matches how the queue is actually drained: the operator reviews pending
 * proposals in a sitting, and a longer default window would re-offer captures whose
 * decision is a week old.
 */
export const PLAN_IMPACT_WINDOW_HOURS = 24;

/** The most captures one pass considers. Bounded so a backfill cannot stampede. */
export const PLAN_IMPACT_DEFAULT_LIMIT = 25;
export const PLAN_IMPACT_MAX_LIMIT = 200;

/** The effective save instant a capture's window membership is decided on. */
export function effectiveCaptureDate(): SQL {
  return sql`COALESCE(${CAPTURE}.bookmarked_at, ${CAPTURE}.created_at)`;
}

/**
 * A live, readable link capture: not archived, not soft-deleted, and carrying a URL.
 * The last clause matters because this feature's evidence is a URL — a row without
 * one is a note or a voice memo, and its relevance is a different question with a
 * different signal.
 */
export function liveLinkCaptureFilter(): SQL {
  return sql`${CAPTURE}.state <> 'archived' AND ${CAPTURE}.deleted_at IS NULL AND ${CAPTURE}.url IS NOT NULL`;
}

/**
 * The window predicate, on the effective save date (see the header).
 *
 * THE BOUND VALUE IS AN ISO STRING CAST IN SQL, NOT A JS `Date` — and that is not
 * stylistic. Verified by execution against the live databases: drizzle's raw
 * `db.execute` hands a `Date` straight to postgres.js, which rejects it with
 * `ERR_INVALID_ARG_TYPE: The "string" argument must be of type string or an instance
 * of Buffer or ArrayBuffer. Received an instance of Date`. The same statement with
 * `${iso}::timestamptz` runs. A unit test that only asserts the fragment's text
 * cannot catch this — the fragment is textually identical either way — so the form
 * is pinned here and in a test that asserts the CAST is present.
 *
 * (`apps/web/lib/queue/lenses.ts` binds dates the other way and is broken in
 * production for it; that is a separate, pre-existing defect outside this change's
 * scope, reported rather than silently fixed.)
 */
export function planImpactWindow(since: Date): SQL {
  return sql`${effectiveCaptureDate()} >= ${since.toISOString()}::timestamptz`;
}

/**
 * Clamp a caller-supplied limit into the range this pass will actually honour.
 * Pure, so a route can report the clamped value it used rather than the one it was
 * handed.
 */
export function clampPlanImpactLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return PLAN_IMPACT_DEFAULT_LIMIT;
  return Math.min(PLAN_IMPACT_MAX_LIMIT, Math.floor(n));
}

/** The default window start for a pass with no stored cursor. Pure. */
export function planImpactSince(now: Date, hours = PLAN_IMPACT_WINDOW_HOURS): Date {
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

/**
 * The title shown in the claim, in the order the rest of the app displays one
 * (`lib/captures/display.ts`): the LLM-rescued title, then `og:title`, then a
 * host-derived fallback. NEVER the raw URL — a claim reading "Plan change on
 * projects/fylo — add: https://…" is unreadable, and the URL already travels in
 * `plan_diff.rationale` where it belongs.
 */
export function planImpactCaptureTitle(row: {
  derived_title?: string | null;
  derivedTitle?: string | null;
  og_title?: string | null;
  ogTitle?: string | null;
  url_host?: string | null;
  urlHost?: string | null;
}): string {
  const derived = firstNonEmpty(row.derived_title, row.derivedTitle);
  if (derived) return derived;
  const og = firstNonEmpty(row.og_title, row.ogTitle);
  if (og) return og;
  const host = firstNonEmpty(row.url_host, row.urlHost);
  if (host) return `Link on ${host}`;
  return "Untitled capture";
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}
