// SPDX-License-Identifier: MIT
/**
 * GET /api/queue/forgotten — the "stuff you saved and never came back to" lens
 * (ADR-0011 lens 2).
 *
 * `components/today-forgotten.tsx` has called this path in production and it did
 * not exist; the card renders `null` on a failed fetch, so the block had been
 * silently absent with nobody told.
 *
 * The lens, per ADR-0011 and pinned by `lib/__tests__/forgotten-related.test.ts`:
 *
 *   - never opened, OR last opened more than 30 days ago
 *     (`opened_at IS NULL OR opened_at < :cutoff`);
 *   - NOT a homepage, but rows with no `kind_classified` yet are KEPT
 *     (`kind_classified <> 'homepage' OR kind_classified IS NULL`) — a bare
 *     `<>` is NULL-unsafe and would silently drop the unclassified rows;
 *   - not archived / smart-archived / soft-deleted, and not currently snoozed.
 *
 * The fragments themselves live in `lib/queue/lenses.ts`, where the pinned test
 * asserts THEM rather than a copy — a test asserting a copy cannot catch a route
 * that got the shape wrong.
 *
 * Ordering is deterministic (the same effective-save-date key the brief uses),
 * not a score: this lens has no ranker to present, and inventing one here would
 * make the card's ordering unexplainable to the person reading it.
 */

export const dynamic = "force-dynamic";

import { getAuthUser } from "@/lib/auth/server";
import { logEvent } from "@/lib/logger";
import { getUserWorkspaces } from "@/lib/workspace";
import { surfaceUnavailableIfMissingRelation } from "@/lib/db/surface-unavailable";
import { db, schema } from "@/lib/db";
import { displayTitle } from "@/lib/captures/display";
import { and, desc, inArray, sql } from "drizzle-orm";
import {
  forgottenCutoff,
  forgottenFilter,
  liveCaptureFilter,
  notHomepageFilter,
  notSnoozedFilter,
  type QueueItem,
} from "@/lib/queue/lenses";

const DEFAULT_N = 3;
const MAX_N = 50;

function parseN(raw: string | null, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(MAX_N, Math.floor(n));
}

/** Days since the row was opened, for the card's "why" line. */
function describeForgotten(openedAt: Date | null, savedAt: Date): string {
  const DAY = 24 * 60 * 60 * 1000;
  if (openedAt === null) {
    const days = Math.floor((Date.now() - savedAt.getTime()) / DAY);
    return days > 365 ? "never opened" : `never opened · saved ${days}d ago`;
  }
  const days = Math.floor((Date.now() - openedAt.getTime()) / DAY);
  return `last opened ${days}d ago`;
}

export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const n = parseN(url.searchParams.get("n"), DEFAULT_N);

  logEvent("route.start", { route: "/api/queue/forgotten", method: "GET", n });

  try {
    const workspaces = await getUserWorkspaces(user.id);
    if (workspaces.length === 0) return Response.json({ items: [], degraded: false });

    const cutoff = forgottenCutoff(new Date());
    const rows = await db
      .select({
        id: schema.captureSources.id,
        url: schema.captureSources.url,
        ogTitle: schema.captureSources.ogTitle,
        derivedTitle: schema.captureSources.derivedTitle,
        urlHost: schema.captureSources.urlHost,
        summary: schema.captureSources.summary,
        openedAt: schema.captureSources.openedAt,
        bookmarkedAt: schema.captureSources.bookmarkedAt,
        createdAt: schema.captureSources.createdAt,
      })
      .from(schema.captureSources)
      .where(
        and(
          inArray(schema.captureSources.workspaceId, workspaces.map((ws) => ws.id)),
          // The three lens fragments, asserted verbatim by the pinned test.
          sql`${liveCaptureFilter()}`,
          sql`${forgottenFilter(cutoff)}`,
          sql`${notHomepageFilter()}`,
          sql`${notSnoozedFilter()}`,
        ),
      )
      .orderBy(
        desc(
          sql`COALESCE(${schema.captureSources.bookmarkedAt}, ${schema.captureSources.createdAt})`,
        ),
      )
      .limit(n);

    const items: QueueItem[] = rows.map((r) => ({
      id: r.id,
      url: r.url,
      title: displayTitle({ ...r, urlHost: r.urlHost }),
      host: r.urlHost,
      reason: describeForgotten(r.openedAt, r.bookmarkedAt ?? r.createdAt),
    }));

    return Response.json({ items, degraded: false });
  } catch (err) {
    // Never a blanket empty 200: "you have nothing forgotten" and "this surface
    // could not read its data" are different statements, and only one is true.
    const unavailable = surfaceUnavailableIfMissingRelation(err, "GET /api/queue/forgotten");
    if (unavailable) return unavailable;

    const message = err instanceof Error ? err.message : "forgotten failed";
    logEvent("queue.forgotten.failed", { n, error: message });
    return Response.json({ error: "queue_failed" }, { status: 500 });
  }
}
