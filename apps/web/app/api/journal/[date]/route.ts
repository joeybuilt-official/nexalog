// SPDX-License-Identifier: MIT
/**
 * Journal — single-entry by date.
 *
 * GET    /api/journal/:date — fetch the entry for a given date (or 404).
 * PUT    /api/journal/:date — full-replace or upsert the entry.
 * DELETE /api/journal/:date — remove the entry.
 */

import { getAuthUser } from "@/lib/auth/server";
import { db, schema } from "@/lib/db";
import { getUserWorkspaces } from "@/lib/workspace";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

const putBody = z.object({
  workspaceId: z.string().uuid().optional(),
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ date: string }> },
) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { date } = await params;
  if (!isoDate.test(date)) {
    return Response.json({ error: "invalid_date" }, { status: 400 });
  }

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? undefined;
  const targetWorkspaceId = await resolveWorkspaceId(user.id, workspaceId ?? undefined);
  if (!targetWorkspaceId) return Response.json({ error: "No workspace found" }, { status: 404 });

  const [row] = await db
    .select()
    .from(schema.journalEntries)
    .where(
      and(
        eq(schema.journalEntries.userId, user.id),
        eq(schema.journalEntries.workspaceId, targetWorkspaceId),
        eq(schema.journalEntries.entryDate, date),
      ),
    )
    .limit(1);

  if (!row) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(row);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ date: string }> },
) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { date } = await params;
  if (!isoDate.test(date)) {
    return Response.json({ error: "invalid_date" }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = putBody.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", detail: parsed.error.flatten() }, { status: 400 });
  }

  const targetWorkspaceId = await resolveWorkspaceId(user.id, parsed.data.workspaceId);
  if (!targetWorkspaceId) return Response.json({ error: "No workspace found" }, { status: 404 });

  const [existing] = await db
    .select()
    .from(schema.journalEntries)
    .where(
      and(
        eq(schema.journalEntries.userId, user.id),
        eq(schema.journalEntries.workspaceId, targetWorkspaceId),
        eq(schema.journalEntries.entryDate, date),
      ),
    )
    .limit(1);

  const { body, mood, energy, weatherJson, voiceSourceId } = parsed.data;

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
        userId: user.id,
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

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ date: string }> },
) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { date } = await params;
  if (!isoDate.test(date)) {
    return Response.json({ error: "invalid_date" }, { status: 400 });
  }

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? undefined;
  const targetWorkspaceId = await resolveWorkspaceId(user.id, workspaceId ?? undefined);
  if (!targetWorkspaceId) return Response.json({ error: "No workspace found" }, { status: 404 });

  await db
    .delete(schema.journalEntries)
    .where(
      and(
        eq(schema.journalEntries.userId, user.id),
        eq(schema.journalEntries.workspaceId, targetWorkspaceId),
        eq(schema.journalEntries.entryDate, date),
      ),
    );

  return Response.json({ ok: true });
}
