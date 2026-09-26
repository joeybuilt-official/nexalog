// P7 spaced review API.
// GET  → up to 20 due items (review_schedule due + new opens never-scheduled).
// POST → { captureId, grade } → SM-2 update, returns { nextReviewAt, intervalDays }.

import { getAuthUser } from "@/lib/auth/server";
import { logEvent } from "@/lib/logger";
import { db, schema } from "@/lib/db";
import { getUserWorkspaces } from "@/lib/workspace";
import { and, eq, lte, ne, notInArray, isNotNull } from "drizzle-orm";
import { sm2Update } from "@/lib/review/sm2";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  logEvent("route.start", { route: "/api/review", method: "GET" });

  const workspaces = await getUserWorkspaces(user.id);
  const ws = workspaces[0];
  if (!ws) return Response.json({ items: [] });

  const now = new Date();

  // Due rows from review_schedule.
  const dueRows = await db
    .select()
    .from(schema.reviewSchedule)
    .where(
      and(
        eq(schema.reviewSchedule.workspaceId, ws.id),
        lte(schema.reviewSchedule.nextReviewAt, now),
      ),
    )
    .limit(20);

  // Scheduled capture IDs (to exclude from "new" pool).
  const scheduledIds = await db
    .select({ captureId: schema.reviewSchedule.captureId })
    .from(schema.reviewSchedule)
    .where(eq(schema.reviewSchedule.workspaceId, ws.id));
  const scheduledSet = scheduledIds.map((r) => r.captureId);

  // New captures (ever-opened, not yet scheduled) to seed the review queue.
  const newCaptures = scheduledSet.length > 0
    ? await db
        .select({
          id: schema.captureSources.id,
          url: schema.captureSources.url,
          ogTitle: schema.captureSources.ogTitle,
          urlHost: schema.captureSources.urlHost,
          summary: schema.captureSources.summary,
          kindClassified: schema.captureSources.kindClassified,
          themeLabel: schema.captureSources.themeLabel,
        })
        .from(schema.captureSources)
        .where(
          and(
            eq(schema.captureSources.workspaceId, ws.id),
            isNotNull(schema.captureSources.openedAt),
            ne(schema.captureSources.state, "archived"),
            notInArray(schema.captureSources.id, scheduledSet),
          ),
        )
        .limit(10)
    : await db
        .select({
          id: schema.captureSources.id,
          url: schema.captureSources.url,
          ogTitle: schema.captureSources.ogTitle,
          urlHost: schema.captureSources.urlHost,
          summary: schema.captureSources.summary,
          kindClassified: schema.captureSources.kindClassified,
          themeLabel: schema.captureSources.themeLabel,
        })
        .from(schema.captureSources)
        .where(
          and(
            eq(schema.captureSources.workspaceId, ws.id),
            isNotNull(schema.captureSources.openedAt),
            ne(schema.captureSources.state, "archived"),
          ),
        )
        .limit(10);

  // Hydrate due rows with capture info.
  const dueCapturIds = dueRows.map((r) => r.captureId);
  const dueCaptures =
    dueCapturIds.length > 0
      ? await db
          .select({
            id: schema.captureSources.id,
            url: schema.captureSources.url,
            ogTitle: schema.captureSources.ogTitle,
            urlHost: schema.captureSources.urlHost,
            summary: schema.captureSources.summary,
            kindClassified: schema.captureSources.kindClassified,
            themeLabel: schema.captureSources.themeLabel,
          })
          .from(schema.captureSources)
          .where(
            and(
              eq(schema.captureSources.workspaceId, ws.id),
              notInArray(schema.captureSources.id, dueCapturIds),
            ),
          )
          .limit(20)
      : [];

  // Build a captureId → capture map.
  const captureMap = new Map(
    [...dueCaptures, ...newCaptures].map((c) => [c.id, c]),
  );

  const dueItems = dueRows
    .map((row) => {
      const c = captureMap.get(row.captureId);
      return {
        id: row.id,
        captureId: row.captureId,
        title: c?.ogTitle ?? row.captureId,
        url: c?.url ?? null,
        host: c?.urlHost ?? null,
        summary: c?.summary ?? null,
        kind: c?.kindClassified ?? null,
        themeLabel: c?.themeLabel ?? null,
        isNew: false,
      };
    });

  const newItems = newCaptures.map((c) => ({
    id: c.id,
    captureId: c.id,
    title: c.ogTitle ?? c.url ?? c.id,
    url: c.url ?? null,
    host: c.urlHost ?? null,
    summary: c.summary ?? null,
    kind: c.kindClassified ?? null,
    themeLabel: c.themeLabel ?? null,
    isNew: true,
  }));

  return Response.json({ items: [...dueItems, ...newItems] });
}

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  logEvent("route.start", { route: "/api/review", method: "POST" });

  const body = (await request.json()) as { captureId?: string; grade?: number };
  if (!body.captureId || body.grade === undefined) {
    return Response.json({ error: "captureId and grade required" }, { status: 400 });
  }
  const grade = Math.max(0, Math.min(5, Math.round(body.grade)));

  const workspaces = await getUserWorkspaces(user.id);
  const ws = workspaces[0];
  if (!ws) return Response.json({ error: "No workspace" }, { status: 400 });

  const existing = await db
    .select()
    .from(schema.reviewSchedule)
    .where(
      and(
        eq(schema.reviewSchedule.workspaceId, ws.id),
        eq(schema.reviewSchedule.captureId, body.captureId),
      ),
    )
    .limit(1)
    .then((r) => r[0] ?? null);

  const state = existing
    ? {
        intervalDays: existing.intervalDays,
        easeFactor: existing.easeFactor,
        reviewCount: existing.reviewCount,
      }
    : { intervalDays: 1, easeFactor: 2.5, reviewCount: 0 };

  const result = sm2Update(state, grade);

  if (existing) {
    await db
      .update(schema.reviewSchedule)
      .set({
        nextReviewAt: result.nextReviewAt,
        intervalDays: result.intervalDays,
        easeFactor: result.easeFactor,
        reviewCount: existing.reviewCount + 1,
        lastGrade: grade,
        updatedAt: new Date(),
      })
      .where(eq(schema.reviewSchedule.id, existing.id));
  } else {
    await db.insert(schema.reviewSchedule).values({
      workspaceId: ws.id,
      userId: user.id,
      captureId: body.captureId,
      nextReviewAt: result.nextReviewAt,
      intervalDays: result.intervalDays,
      easeFactor: result.easeFactor,
      reviewCount: 1,
      lastGrade: grade,
    });
  }

  return Response.json({
    nextReviewAt: result.nextReviewAt.toISOString(),
    intervalDays: result.intervalDays,
  });
}
