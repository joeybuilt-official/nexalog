// SPDX-License-Identifier: MIT
/**
 * GET /api/queue/related — "what you were just working on, and what it connects
 * to" (ADR-0011 lens 3).
 *
 * `components/today-related.tsx` has called this path in production and it did
 * not exist; the card renders `null` on a failed fetch, so the block had been
 * silently absent with nobody told.
 *
 * THE LENS (pinned by `lib/__tests__/forgotten-related.test.ts`):
 *
 *   1. Take every note edited in the last 24 hours, with an embedding.
 *   2. Mean-then-NORMALIZE those embeddings into one unit vector — pgvector's
 *      `<=>` is a cosine distance, so the centroid must be a direction. A
 *      degenerate centroid (norm underflows) is refused, not normalized into
 *      noise; the route then reports an honest empty lens instead of surfacing
 *      arbitrary rows as "related".
 *   3. Rank captures by cosine distance to it, keeping those under the ceiling.
 *   4. Exclude anything edited in the last 7 days — you just touched it, so it is
 *      not a rediscovery.
 *
 * TWO OPERATOR ERRORS THIS ROUTE AVOIDS
 * -------------------------------------
 *   - `OPERATOR(public.<=>)` with an explicit `::public.vector` cast. The
 *     session `search_path` is `nexalog` alone, so an unqualified `<=>` raises
 *     SQLSTATE 42883 at runtime. The `public.` qualification is what makes the
 *     operator resolve.
 *   - The embedding is bound as a TEXT literal cast to `public.vector`, not as a
 *     JS array: postgres.js would serialize a plain array as a Postgres array
 *     (`{...}`), which pgvector does not accept.
 *
 * The centroid and literal helpers are pure functions in `lib/queue/lenses.ts`,
 * unit-tested there; this handler owns the IO.
 */

export const dynamic = "force-dynamic";

import { getAuthUser } from "@/lib/auth/server";
import { logEvent } from "@/lib/logger";
import { getUserWorkspaces } from "@/lib/workspace";
import { surfaceUnavailableIfMissingRelation } from "@/lib/db/surface-unavailable";
import { db, schema } from "@/lib/db";
import { displayTitle } from "@/lib/captures/display";
import { and, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  RELATED_COSINE_CEILING,
  RELATED_SEED_LIMIT,
  centroidVector,
  cosineDistance,
  liveCaptureFilter,
  parseVectorLiteral,
  relatedEditExclusion,
  relatedEditExclusionCutoff,
  relatedSeedCutoff,
  toVectorLiteral,
  type QueueItem,
} from "@/lib/queue/lenses";

const DEFAULT_N = 3;
const MAX_N = 50;

function parseN(raw: string | null, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(MAX_N, Math.floor(n));
}

interface RelatedRow extends Record<string, unknown> {
  id: string;
  url: string | null;
  og_title: string | null;
  derived_title: string | null;
  url_host: string | null;
  summary: string | null;
  dist: number;
}

/** The raw-SQL read: the pgvector distance expression has no drizzle builder. */
async function loadRelated(
  workspaceIds: string[],
  centroidLiteral: string,
  excludeEditedAfter: Date,
  n: number,
): Promise<QueueItem[]> {
  const workspaceList = sql.join(
    workspaceIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

  const rows = await db.execute<RelatedRow>(sql`
    SELECT nexalog.capture_sources.id,
           nexalog.capture_sources.url,
           nexalog.capture_sources.og_title,
           nexalog.capture_sources.derived_title,
           nexalog.capture_sources.url_host,
           nexalog.capture_sources.summary,
           (${cosineDistance(centroidLiteral)})::float8 AS dist
      FROM nexalog.capture_sources
     WHERE nexalog.capture_sources.workspace_id IN (${workspaceList})
       AND ${liveCaptureFilter()}
       AND ${relatedEditExclusion(excludeEditedAfter)}
       AND nexalog.capture_sources.embedding IS NOT NULL
       AND (${cosineDistance(centroidLiteral)}) < ${RELATED_COSINE_CEILING}
     ORDER BY dist ASC
     LIMIT ${n}
  `);

  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    title: displayTitle({
      url: r.url,
      ogTitle: r.og_title,
      derivedTitle: r.derived_title,
      urlHost: r.url_host,
      summary: r.summary,
    }),
    host: r.url_host,
    // The distance IS the reason, stated as a similarity the reader can weigh.
    reason: `similar · ${(1 - Number(r.dist)).toFixed(2)}`,
  }));
}

/**
 * The 24h seed set: embeddings of notes the user just touched. Their centroid is
 * the direction "what am I working on right now".
 */
async function loadSeedVectors(workspaceIds: string[], now: Date): Promise<number[][]> {
  const rows = await db
    .select({ embedding: sql<string | null>`${schema.notes}.embedding::text` })
    .from(schema.notes)
    .where(
      and(
        inArray(schema.notes.workspaceId, workspaceIds),
        isNull(schema.notes.deletedAt),
        isNotNull(sql`${schema.notes}.embedding`),
        sql`${schema.notes}.updated_at >= ${relatedSeedCutoff(now)}`,
      ),
    )
    .limit(RELATED_SEED_LIMIT);

  const vectors: number[][] = [];
  for (const row of rows) {
    if (typeof row.embedding !== "string") continue;
    const parsed = parseVectorLiteral(row.embedding);
    if (parsed && parsed.length > 0) vectors.push(parsed);
  }
  return vectors;
}

export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const n = parseN(url.searchParams.get("n"), DEFAULT_N);

  logEvent("route.start", { route: "/api/queue/related", method: "GET", n });

  try {
    const workspaces = await getUserWorkspaces(user.id);
    if (workspaces.length === 0) return Response.json({ items: [], degraded: false });
    const workspaceIds = workspaces.map((ws) => ws.id);

    const now = new Date();
    const seedVectors = await loadSeedVectors(workspaceIds, now);

    // No recent edits ⇒ there is no "related to what?" to answer. That is an
    // honest empty lens, not a failure and not a reason to invent a seed.
    const centroid = centroidVector(seedVectors);
    if (!centroid) {
      logEvent("queue.related.no_seed", { seeds: seedVectors.length });
      return Response.json({
        items: [],
        degraded: false,
        note:
          seedVectors.length === 0
            ? "No notes were edited in the last 24 hours, so there is nothing to relate to yet."
            : "The recent edits have no usable embedding centroid yet.",
      });
    }

    const items = await loadRelated(
      workspaceIds,
      toVectorLiteral(centroid),
      relatedEditExclusionCutoff(now),
      n,
    );

    return Response.json({
      items,
      degraded: false,
      note: `${seedVectors.length} note${seedVectors.length === 1 ? "" : "s"} edited in the last 24h seeded this lens.`,
    });
  } catch (err) {
    const unavailable = surfaceUnavailableIfMissingRelation(err, "GET /api/queue/related");
    if (unavailable) return unavailable;

    const message = err instanceof Error ? err.message : "related failed";
    logEvent("queue.related.failed", { n, error: message });
    return Response.json({ error: "queue_failed" }, { status: 500 });
  }
}
