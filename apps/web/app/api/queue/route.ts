// SPDX-License-Identifier: MIT
/**
 * GET /api/queue — the daily-brief lens (ADR-0011 lens 1).
 *
 * WHY THIS ROUTE EXISTS
 * ---------------------
 * `components/today-brief.tsx` and `components/voice-reader/useVoiceQueue.ts`
 * have called this path in production, and it did not exist: no
 * `apps/web/app/api/queue` directory, nothing serving it. Both components render
 * nothing on a failed fetch, so Today's brief block and the voice reader's queue
 * had been silently absent with nobody told. This route is the missing half of
 * that contract.
 *
 * What the callers pin (and this route answers):
 *   `{ items: Array<{ id, url, title, host, reason?, summary? }> }`
 * — `n`, default 5 (the brief), 12 (the voice reader). Both are bounded here.
 *
 * ORDERING, HONESTLY
 * ------------------
 * ADR-0011 describes this lens as "the existing ranker output presented at the
 * right surface". The v2 tree has no ranker: `lib/queue/scoring.ts` was deleted
 * with the v1 surface, `nexalog.queue_weights` is empty and `feedback_signals`
 * has zero rows, so a learned-weight ranker would have nothing to learn from.
 * Rather than invent a second one (which the ADR forbids), the brief orders by
 * the user's effective save date — the deterministic lane, using
 * `COALESCE(bookmarked_at, created_at)` so an import that preserved the original
 * bookmark date does not present years of back-catalogue as today's finds.
 *
 * Every row carries a `reason`, because a resurfacing card that cannot say why
 * it surfaced something is asking the reader to trust a black box.
 *
 * Auth is the neighbouring `/api/captures` + `/api/search` pattern (a validated
 * session; the edge middleware only checks the cookie is PRESENT), and every read
 * is scoped to the caller's own workspaces — an item from someone else's
 * workspace is not filtered out late, it is never selected.
 *
 * Degradation follows the repo's honest ladder: a genuinely absent table is a
 * 503 `surface_unavailable` (never an empty 200 that reads as "nothing to show"),
 * and any other failure is a typed 500 with a log line.
 */

export const dynamic = "force-dynamic";

import { getAuthUser } from "@/lib/auth/server";
import { logEvent } from "@/lib/logger";
import { getUserWorkspaces } from "@/lib/workspace";
import { surfaceUnavailableIfMissingRelation } from "@/lib/db/surface-unavailable";
import { db, schema } from "@/lib/db";
import { displayTitle } from "@/lib/captures/display";
import { and, desc, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  notSnoozedFilter,
  type QueueItem,
} from "@/lib/queue/lenses";

/** Default and maximum rows for the brief lens. */
const DEFAULT_N = 5;
const MAX_N = 50;

function parseN(raw: string | null, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(MAX_N, Math.floor(n));
}

/**
 * The read is a plain indexed query — no ranking model, no second pass, ordered
 * by the same `COALESCE(bookmarked_at, created_at)` key the ORDER BY uses so the
 * plan stays index-driven as the library grows.
 */
async function loadBrief(workspaceIds: string[], n: number): Promise<QueueItem[]> {
  const rows = await db
    .select({
      id: schema.captureSources.id,
      url: schema.captureSources.url,
      ogTitle: schema.captureSources.ogTitle,
      derivedTitle: schema.captureSources.derivedTitle,
      urlHost: schema.captureSources.urlHost,
      summary: schema.captureSources.summary,
      bookmarkedAt: schema.captureSources.bookmarkedAt,
      createdAt: schema.captureSources.createdAt,
      readMinutes: schema.captureSources.readMinutes,
      watchMinutes: schema.captureSources.watchMinutes,
    })
    .from(schema.captureSources)
    .where(
      and(
        inArray(schema.captureSources.workspaceId, workspaceIds),
        // Not archived, not smart-archived, not soft-deleted, and has a URL to
        // open: a card that re-offers something the reader filed away, or that
        // links nowhere, is worse than no card at all.
        sql`${schema.captureSources.state} <> 'archived'`,
        isNull(schema.captureSources.smartArchivedAt),
        isNull(schema.captureSources.deletedAt),
        isNotNull(schema.captureSources.url),
        // The brief is "what you saved and have not got to" — an item already
        // opened is not waiting for you.
        isNull(schema.captureSources.openedAt),
        // …and one you snoozed is waiting by your own instruction.
        notSnoozedFilter(),
      ),
    )
    .orderBy(
      desc(
        sql`COALESCE(${schema.captureSources.bookmarkedAt}, ${schema.captureSources.createdAt})`,
      ),
    )
    .limit(n);

  return rows.map((r) => {
    const title = displayTitle({ ...r, urlHost: r.urlHost });
    const item: QueueItem = {
      id: r.id,
      url: r.url,
      title,
      host: r.urlHost,
      reason: reasonFor(r.bookmarkedAt ?? r.createdAt, r.readMinutes, r.watchMinutes),
    };
    if (r.summary !== undefined) item.summary = r.summary;
    return item;
  });
}

/**
 * The "why this is here" line. It states the actual basis of the pick — the
 * deterministic recency lane — rather than an invented score, so the card never
 * implies a confidence the system does not have.
 */
function reasonFor(
  savedAt: Date,
  readMinutes: number | null,
  watchMinutes: number | null,
): string {
  const age = describeAge(savedAt);
  if (readMinutes && readMinutes > 0) return `unread · ${readMinutes} min`;
  if (watchMinutes && watchMinutes > 0) return `unwatched · ${watchMinutes} min`;
  return age;
}

function describeAge(savedAt: Date): string {
  const days = Math.floor((Date.now() - savedAt.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "saved today";
  if (days === 1) return "saved yesterday";
  if (days < 30) return `saved ${days}d ago`;
  const months = Math.floor(days / 30);
  return `saved ${months}mo ago`;
}

export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const n = parseN(url.searchParams.get("n"), DEFAULT_N);

  logEvent("route.start", { route: "/api/queue", method: "GET", n });

  try {
    const workspaces = await getUserWorkspaces(user.id);
    if (workspaces.length === 0) {
      // A caller with no workspace has no queue — not a failure, and not a
      // reason to read anything.
      return Response.json({ items: [], degraded: false });
    }

    const items = await loadBrief(
      workspaces.map((ws) => ws.id),
      n,
    );
    return Response.json({ items, degraded: false });
  } catch (err) {
    // A missing table is a server-side configuration problem, not an empty
    // queue: reporting 200 with no items would read as "you have nothing
    // waiting", which is a different and false statement.
    const unavailable = surfaceUnavailableIfMissingRelation(err, "GET /api/queue");
    if (unavailable) return unavailable;

    const message = err instanceof Error ? err.message : "queue failed";
    logEvent("queue.brief.failed", { n, error: message });
    return Response.json({ error: "queue_failed" }, { status: 500 });
  }
}
