// SPDX-License-Identifier: MIT
/**
 * Journal — list (paged) + upsert.
 *
 * GET  /api/journal?limit=&before=&workspaceId=
 *      Returns most-recent-first journal entries for the active workspace.
 * POST /api/journal
 *      Upsert today's (or a specified date's) entry. Idempotent on
 *      (user_id, workspace_id, entry_date).
 */

import { getAuthUser } from "@/lib/auth/server";
import { db, schema } from "@/lib/db";
import { surfaceUnavailableIfMissingRelation } from "@/lib/db/surface-unavailable";
import { getUserWorkspaces } from "@/lib/workspace";
import { and, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { userTodayStr } from "@/lib/time/user-tz";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "entry_date must be YYYY-MM-DD");

const listQuery = z.object({
  workspaceId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
  before: isoDate.optional(),
});

const upsertBody = z.object({
  workspaceId: z.string().uuid().optional(),
  entryDate: isoDate.optional(),
  body: z.string().max(50_000).optional(),
  mood: z.number().int().min(1).max(5).nullable().optional(),
  energy: z.number().int().min(1).max(5).nullable().optional(),
  weatherJson: z.record(z.string(), z.unknown()).nullable().optional(),
  voiceSourceId: z.string().max(512).nullable().optional(),
});

async function resolveWorkspaceId(userId: string, requested?: string) {
  const workspaces = await getUserWorkspaces(userId);
  if (!workspaces.length) return null;
  if (!requested) return workspaces[0].id;
  return workspaces.some((ws) => ws.id === requested) ? requested : null;
}

export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    return await listEntries(request, user.id);
  } catch (err) {
    const unavailable = surfaceUnavailableIfMissingRelation(err, "GET /api/journal");
    if (unavailable) return unavailable;
    throw err;
  }
}

async function listEntries(request: Request, userId: string) {
  const url = new URL(request.url);
  const parsed = listQuery.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) {
    return Response.json({ error: "invalid_query", detail: parsed.error.flatten() }, { status: 400 });
  }
  const { workspaceId, limit, before } = parsed.data;

  const targetWorkspaceId = await resolveWorkspaceId(userId, workspaceId);
  if (!targetWorkspaceId) return Response.json({ error: "No workspace found" }, { status: 404 });

  const conditions = [
    eq(schema.journalEntries.userId, userId),
    eq(schema.journalEntries.workspaceId, targetWorkspaceId),
  ];
  if (before) conditions.push(lt(schema.journalEntries.entryDate, before));

  const rows = await db
    .select()
    .from(schema.journalEntries)
    .where(and(...conditions))
    .orderBy(desc(schema.journalEntries.entryDate))
    .limit(limit);

  return Response.json({ entries: rows });
}

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    return await upsertEntry(request, user.id);
  } catch (err) {
    const unavailable = surfaceUnavailableIfMissingRelation(err, "POST /api/journal");
    if (unavailable) return unavailable;
    throw err;
  }
}

async function upsertEntry(request: Request, userId: string) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = upsertBody.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", detail: parsed.error.flatten() }, { status: 400 });
  }
  const { workspaceId, entryDate, body, mood, energy, weatherJson, voiceSourceId } = parsed.data;

  const targetWorkspaceId = await resolveWorkspaceId(userId, workspaceId);
  if (!targetWorkspaceId) return Response.json({ error: "No workspace found" }, { status: 404 });

  const date = entryDate ?? (await userTodayStr());

  // Manual upsert (Drizzle's onConflict requires the unique index name; we
  // do a select-then-insert/update to keep the route schema-light).
  const [existing] = await db
    .select()
    .from(schema.journalEntries)
    .where(
      and(
        eq(schema.journalEntries.userId, userId),
        eq(schema.journalEntries.workspaceId, targetWorkspaceId),
        eq(schema.journalEntries.entryDate, date),
      ),
    )
    .limit(1);

  let entry;
  if (existing) {
    const [updated] = await db
      .update(schema.journalEntries)
      .set({
        body: body ?? existing.body,
        mood: mood === undefined ? existing.mood : mood,
        energy: energy === undefined ? existing.energy : energy,
        weatherJson: weatherJson === undefined ? existing.weatherJson : weatherJson,
        voiceSourceId: voiceSourceId === undefined ? existing.voiceSourceId : voiceSourceId,
        updatedAt: new Date(),
      })
      .where(eq(schema.journalEntries.id, existing.id))
      .returning();
    entry = updated;
  } else {
    const [created] = await db
      .insert(schema.journalEntries)
      .values({
        workspaceId: targetWorkspaceId,
        userId,
        entryDate: date,
        body: body ?? "",
        mood: mood ?? null,
        energy: energy ?? null,
        weatherJson: weatherJson ?? null,
        voiceSourceId: voiceSourceId ?? null,
      })
      .returning();
    entry = created;
  }

  return Response.json(entry, { status: existing ? 200 : 201 });
}
