// SPDX-License-Identifier: MIT
/**
 * The queue lenses — the SQL FRAGMENTS and value rules the three `/api/queue*`
 * routes share, with no IO of their own.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Four live components call `/api/queue*` and NO route served any of them:
 * `components/today-brief.tsx`, `today-forgotten.tsx`, `today-related.tsx` and
 * `components/voice-reader/useVoiceQueue.ts`. Each Today card renders `null`
 * when its fetch fails, so three of Today's eight blocks had been silently
 * absent in production and nothing said so.
 *
 * The lens semantics were already specified — by ADR-0011 (the three lenses) and
 * by `lib/__tests__/forgotten-related.test.ts`, which pins the fragment shapes.
 * That test asserted a COPY of the fragments while no route existed, so it could
 * not catch a route that got them wrong. The fragments now live here and the
 * test asserts THEM, which is what makes it a pin instead of a description.
 *
 * TWO QUALIFICATION RULES, BOTH LOAD-BEARING
 * -----------------------------------------
 * 1. The pgvector operator is `OPERATOR(public.<=>)` on a `::public.vector`
 *    literal. An unqualified `<=>` raises SQLSTATE 42883 at runtime ("operator
 *    does not exist: vector <=> vector") because the extension lives in
 *    `public` and the session's search_path does not include it for operators.
 * 2. Columns are qualified `nexalog.capture_sources.<col>`. The app's connection
 *    does NOT set a search_path — the whole schema is addressed explicitly, which
 *    is why drizzle's `pgSchema("nexalog")` emits qualified names — and the
 *    vector query cannot alias the table for the operator expression to stay
 *    readable. Qualifying keeps one fragment usable from both the query builder
 *    and raw SQL. Never add an alias to `nexalog.capture_sources` in a query
 *    that embeds these fragments: an alias hides the original name in Postgres.
 *
 * This module imports nothing from `@/lib/db`: `web-lib-no-direct-db` is a
 * baselined `warn` and this file must not widen that baseline. The routes own the
 * IO; this module owns the rules.
 */

import { sql, type SQL } from "drizzle-orm";

/** Forgetfulness horizon for the `forgotten` lens (ADR-0011: a 30d cliff). */
export const FORGOTTEN_CUTOFF_DAYS = 30;

/** The recent-edit window whose centroid seeds the `related` lens. */
export const RELATED_NOTE_WINDOW_HOURS = 24;

/** Edits inside this window are excluded, so you are not shown what you just touched. */
export const RELATED_EDIT_EXCLUSION_DAYS = 7;

/** Cosine-distance ceiling for a semantic neighbour. */
export const RELATED_COSINE_CEILING = 0.4;

/** How many seeds the `related` lens centroid is computed over. */
export const RELATED_SEED_LIMIT = 50;

/** The wire item every lens returns — the shape the four consumers pinned. */
export interface QueueItem {
  id: string;
  url: string | null;
  title: string;
  host: string | null;
  /** The brief, forgotten and related lenses set it; the cards render it as the "why". */
  reason?: string | null;
  /** The brief sets it; the voice reader speaks it. */
  summary?: string | null;
}

// ── pure predicates ─────────────────────────────────────────────────────────

/** The recency window in which a note edit seeds the `related` lens. */
export function relatedSeedCutoff(now: Date): Date {
  return new Date(now.getTime() - RELATED_NOTE_WINDOW_HOURS * 60 * 60 * 1000);
}

/** Edits at or after this instant are too recent to be a rediscovery. */
export function relatedEditExclusionCutoff(now: Date): Date {
  return new Date(now.getTime() - RELATED_EDIT_EXCLUSION_DAYS * 24 * 60 * 60 * 1000);
}

/** The forgetfulness cliff the `forgotten` lens filters on. */
export function forgottenCutoff(now: Date): Date {
  return new Date(now.getTime() - FORGOTTEN_CUTOFF_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Mean-then-normalize a set of embeddings into ONE unit vector.
 *
 * Mean alone is not enough: pgvector's `<=>` is a cosine distance, so the
 * centroid is a DIRECTION. Averaging pulls the magnitude below 1 and, for
 * near-opposed seeds, toward the origin — a norm near zero makes the direction
 * numerically meaningless, so a degenerate centroid is refused rather than
 * normalized into noise (which would rank arbitrary rows as "related").
 *
 * Returns null when there is nothing to average, when the mean has no usable
 * direction, or when the seeds disagree on dimensionality (a defect upstream —
 * the column is a fixed width — not something to pad).
 */
export function centroidVector(vectors: ReadonlyArray<ReadonlyArray<number>>): number[] | null {
  if (vectors.length === 0) return null;
  const dim = vectors[0].length;
  if (dim === 0) return null;
  for (const v of vectors) {
    if (v.length !== dim) return null;
  }

  const centroid = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) {
      const x = v[i];
      if (!Number.isFinite(x)) return null;
      centroid[i] += x;
    }
  }
  for (let i = 0; i < dim; i++) centroid[i] /= vectors.length;

  let sumSquares = 0;
  for (const x of centroid) sumSquares += x * x;
  const norm = Math.sqrt(sumSquares);
  // A norm that underflows float precision cannot be normalized into a
  // direction; the caller degrades to an honest empty lens instead of querying
  // with a nonsense vector.
  if (!Number.isFinite(norm) || norm < 1e-9) return null;
  for (let i = 0; i < dim; i++) centroid[i] /= norm;
  return centroid;
}

/** Parse a pgvector text literal (``[1,2,3]``) back into numbers. */
export function parseVectorLiteral(raw: string): number[] | null {
  const body = raw.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (body === "") return [];
  const parts = body.split(",");
  const out = new Array<number>(parts.length);
  for (let i = 0; i < parts.length; i++) {
    const n = Number(parts[i]);
    if (!Number.isFinite(n)) return null;
    out[i] = n;
  }
  return out;
}

/**
 * The pgvector text literal a centroid is bound as.
 *
 * Bound as TEXT and cast in SQL (`::public.vector`), never as a JS array:
 * postgres.js serializes a plain array as a Postgres ARRAY (`{1,2,3}`), which
 * pgvector does not accept.
 */
export function toVectorLiteral(vector: ReadonlyArray<number>): string {
  return `[${vector.join(",")}]`;
}

// ── SQL fragments (pure — no IO) ────────────────────────────────────────────

/** The table every lens reads, spelled out for fragment composition. */
const CAPTURE = sql.raw("nexalog.capture_sources");

/**
 * FORGOTTEN: "never opened, OR last opened more than 30 days ago".
 *
 * `opened_at` is the read marker the app writes (`POST /api/captures/[id]/open`).
 * A NULL there means never opened at all — the strongest form of forgotten — and
 * must not be filtered out by the comparison, hence the explicit `IS NULL` arm
 * rather than a bare `col < :cutoff`, which is NULL-unsafe and would drop every
 * never-opened row.
 *
 * Takes the cutoff as a DATE (not an interval) so the caller owns the clock and
 * a test can pin the instant without travelling in time.
 */
export function forgottenFilter(cutoff: Date): SQL {
  return sql`(${CAPTURE}.opened_at IS NULL OR ${CAPTURE}.opened_at < ${cutoff})`;
}

/**
 * FORGOTTEN: exclude homepages, but KEEP rows not yet classified.
 *
 * `kind_classified` is NULL on 73 of the live rows (the classifier has not
 * reached them). A bare `<> 'homepage'` is NULL-unsafe and would drop every one
 * of them, silently shrinking the lens to whatever the classifier happened to
 * have processed.
 */
export function notHomepageFilter(): SQL {
  return sql`(${CAPTURE}.kind_classified <> 'homepage' OR ${CAPTURE}.kind_classified IS NULL)`;
}

/**
 * RELATED: the pgvector cosine distance, schema-qualified because the operator
 * lives in `public` — `public.` is what makes it resolve, and `::public.vector`
 * is what makes the literal a vector.
 */
export function cosineDistance(literal: string): SQL {
  return sql`${CAPTURE}.embedding OPERATOR(public.<=>) ${literal}::public.vector`;
}

/** RELATED: a capture edited this recently is not a rediscovery. */
export function relatedEditExclusion(cutoff: Date): SQL {
  return sql`${CAPTURE}.updated_at < ${cutoff}`;
}

/**
 * The row-level exclusions EVERY lens applies: not archived, not smart-archived,
 * not soft-deleted, and carrying a URL to open. A queue card that re-offers a row
 * the user filed away — or links nowhere — is worse than no card at all.
 */
export function liveCaptureFilter(): SQL {
  return sql`${CAPTURE}.state <> 'archived' AND ${CAPTURE}.smart_archived_at IS NULL AND ${CAPTURE}.deleted_at IS NULL AND ${CAPTURE}.url IS NOT NULL`;
}

/**
 * Snoozed rows stay out until their due time passes. `queue_state` is the
 * behavioural mirror ADR-0011 specified for the snooze/weekend feedback actions;
 * a lens that ignored it would keep re-offering an item the user deferred.
 */
export function notSnoozedFilter(): SQL {
  return sql`NOT EXISTS (
    SELECT 1 FROM nexalog.queue_state qs
     WHERE qs.capture_id = ${CAPTURE}.id
       AND qs.due_at > now()
  )`;
}
