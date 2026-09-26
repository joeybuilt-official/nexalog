// SPDX-License-Identifier: MIT
//
// Upserts the user's history preferences onto the existing per-user
// user_preferences row.
import { getAuthUser } from "@/lib/auth/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import {
  withMissingColumnFallback,
  DEFAULT_HISTORY_PREFS,
} from "@/lib/db/safe-prefs";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const prefs = await withMissingColumnFallback(
    async () =>
      (
        await db
          .select()
          .from(schema.userPreferences)
          .where(eq(schema.userPreferences.userId, user.id))
          .limit(1)
      )[0],
    undefined
  );

  return Response.json({
    savePageVisits: prefs?.savePageVisits ?? DEFAULT_HISTORY_PREFS.savePageVisits,
    historyDenylist: prefs?.historyDenylist ?? DEFAULT_HISTORY_PREFS.historyDenylist,
    historyRetentionDays:
      prefs?.historyRetentionDays ?? DEFAULT_HISTORY_PREFS.historyRetentionDays,
  });
}

export async function PATCH(request: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body?.savePageVisits === "boolean") patch.savePageVisits = body.savePageVisits;
  if (Array.isArray(body?.historyDenylist)) {
    patch.historyDenylist = body.historyDenylist
      .filter((d: unknown): d is string => typeof d === "string")
      .map((d: string) => d.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 200);
  }
  if (Number.isFinite(body?.historyRetentionDays)) {
    patch.historyRetentionDays = Math.min(3650, Math.max(1, Math.floor(body.historyRetentionDays)));
  }

  // Same guard — if the columns aren't there yet, return defaults instead
  // of 500ing the PATCH. The user's edit is silently dropped but the UI
  // does not blow up. After the migration runs, the next PATCH persists
  // normally.
  const updated = await withMissingColumnFallback(async () => {
    await db
      .insert(schema.userPreferences)
      .values({ userId: user.id, ...patch })
      .onConflictDoUpdate({ target: schema.userPreferences.userId, set: patch });

    return (
      await db
        .select()
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, user.id))
        .limit(1)
    )[0];
  }, undefined);

  return Response.json({
    savePageVisits: updated?.savePageVisits ?? DEFAULT_HISTORY_PREFS.savePageVisits,
    historyDenylist:
      updated?.historyDenylist ?? DEFAULT_HISTORY_PREFS.historyDenylist,
    historyRetentionDays:
      updated?.historyRetentionDays ?? DEFAULT_HISTORY_PREFS.historyRetentionDays,
  });
}
