// SPDX-License-Identifier: MIT
/**
 * Missing-relation degradation for the carried-over v1 API surfaces.
 *
 * Five v1 routes (`/api/sync`, `/api/sync/mutations`, `/api/notes`,
 * `/api/bookmarks`, `/api/journal`) still query the v1 content model through
 * `{ db }` from `@/lib/db`, i.e. whatever `DATABASE_URL` points at. On the
 * current deployment that database does not carry those tables, so every query
 * raises Postgres `42P01` (`relation "nexalog.notes" does not exist`) and the
 * routes 500 — mobile offline sync fails in production.
 *
 * The underlying data-ownership decision is OPEN and deliberately NOT made
 * here (see `docs/agents/in-progress.d/legacy-v1-routes-stopgap.md`). What this
 * module fixes is the *failure mode*: a missing table is a server-side
 * configuration problem, so it gets its own honest, typed, non-fatal response
 * instead of an unhandled 500, and every unrelated failure keeps propagating.
 *
 * Why 503 and not an empty 200: a `200 {changes:{}, deletes:{}}` would tell the
 * offline client "nothing has changed since your cursor", it would persist that
 * cursor, and the rows would never be pulled again — silent, permanent, and
 * indistinguishable from data loss. A route whose tables do not exist must
 * never report success. 503 is also what the shipped Flutter client already
 * handles safely: `SyncEngine` catches the transport failure and keeps the last
 * synced mirror without advancing the cursor or parking queued mutations.
 */

import { logEvent } from "@/lib/logger";

/**
 * Postgres `undefined_table`. In practice this also covers a wholly absent
 * schema: `search_path` silently ignores a schema that is not there, so the
 * query still fails on the relation, not on the schema. One code, no guessing.
 */
const MISSING_RELATION_CODE = "42P01";

/** Drizzle wraps driver errors (`DrizzleQueryError.cause`); bound the walk. */
const MAX_CAUSE_DEPTH = 5;

const RELATION_NAME_RE = /relation "([^"]+)" does not exist/;

export type MissingRelation = {
  /** Relation named in the driver message, for the log line only. */
  relation: string | null;
};

function codeOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function relationOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const message = (value as { message?: unknown }).message;
  if (typeof message !== "string") return null;
  return RELATION_NAME_RE.exec(message)?.[1] ?? null;
}

/**
 * Walk an error's `cause` chain looking for a missing-relation failure.
 * Drizzle throws `DrizzleQueryError` wrapping the driver's `PostgresError`, but
 * the exact nesting is a detail of the driver version — the `code` is the
 * contract, so match on that at any depth.
 */
export function findMissingRelation(error: unknown): MissingRelation | null {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current != null; depth += 1) {
    if (codeOf(current) === MISSING_RELATION_CODE) {
      return { relation: relationOf(current) };
    }
    if (typeof current !== "object") return null;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * The one place a missing relation becomes a response.
 *
 * Returns `null` when the error is anything else, so callers rethrow and
 * genuinely unexpected failures keep their 500 + stack trace. The relation name
 * is logged, never returned: it is internal schema detail (see
 * `.agents/rules/error-handling.md` → "never leak SQL, internal paths").
 */
export function surfaceUnavailableIfMissingRelation(
  error: unknown,
  surface: string,
): Response | null {
  const missing = findMissingRelation(error);
  if (!missing) return null;

  logEvent("api.surface_unavailable", {
    surface,
    reason: "missing_relation",
    relation: missing.relation,
    status: 503,
  });

  return Response.json(
    {
      error: "surface_unavailable",
      code: "missing_relation",
      surface,
      message:
        "This surface is unavailable on this deployment: its database tables are not present. " +
        "Nothing was returned to the caller. This is a server-side configuration problem, not a " +
        "problem with the request — retry later.",
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
