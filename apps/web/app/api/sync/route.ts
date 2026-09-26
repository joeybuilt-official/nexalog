/**
 * Offline Delta-Pull (ADR-0001)
 *
 * GET /api/sync?since=<ISO|0>
 *   → { serverTime, changes:{entity:[row]}, deletes:{entity:[id]}, nextSince }
 *
 * Returns every row the authenticated user owns that changed since their last
 * pull, plus the ids of rows tombstoned since then. The native client persists
 * `nextSince` and replays it next pull. Scoped by userId (covers all of the
 * user's workspaces); each row carries its own workspaceId so the client can
 * filter per active workspace.
 *
 * Auth: getAuthUser — accepts the web cookie OR `Authorization: Bearer <token>`
 * via the better-auth bearer plugin (ADR-0002).
 *
 * Failure mode: this route reads the carried-over v1 content model, which is
 * not present in the database the deployment points this process at. A missing
 * relation degrades to an explicit 503 (`surface_unavailable`) instead of an
 * unhandled 500 — see `lib/db/surface-unavailable.ts`. It deliberately does NOT
 * return an empty delta: an empty 200 would advance the client's cursor past
 * rows it never received, which is indistinguishable from data loss.
 */
import { getAuthUser } from "@/lib/auth/server";
import { db, schema } from "@/lib/db";
import { surfaceUnavailableIfMissingRelation } from "@/lib/db/surface-unavailable";
import { and, eq, gt, isNull, isNotNull } from "drizzle-orm";

const SYNC_TABLES = {
  notes: schema.notes,
  captureSources: schema.captureSources,
  journalEntries: schema.journalEntries,
  projects: schema.projects,
  bookmarkCollections: schema.bookmarkCollections,
} as const;

type SyncEntity = keyof typeof SYNC_TABLES;

function parseSince(raw: string | null): Date {
  if (!raw || raw === "0") return new Date(0);
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    return await pullDelta(request, user.id);
  } catch (err) {
    const unavailable = surfaceUnavailableIfMissingRelation(err, "GET /api/sync");
    if (unavailable) return unavailable;
    throw err;
  }
}

async function pullDelta(request: Request, userId: string) {
  const { searchParams } = new URL(request.url);
  const since = parseSince(searchParams.get("since"));
  // Snapshot the server boundary up front so a row written mid-request is not
  // skipped on the next pull.
  const serverTime = new Date();

  const changes: Record<string, unknown[]> = {};
  const deletes: Record<string, string[]> = {};

  // One guard for the whole pull, not one per entity: all five tables live in
  // the same schema, so the first missing relation means the set is unusable.
  // A partial delta would be worse than none — the client would advance its
  // cursor having received only some of the entities.
  for (const entity of Object.keys(SYNC_TABLES) as SyncEntity[]) {
    const table = SYNC_TABLES[entity];

    const rows = await db
      .select()
      .from(table)
      .where(
        and(
          eq(table.userId, userId),
          gt(table.updatedAt, since),
          isNull(table.deletedAt),
        ),
      );
    changes[entity] = rows;

    const tombstoned = await db
      .select({ id: table.id })
      .from(table)
      .where(
        and(
          eq(table.userId, userId),
          isNotNull(table.deletedAt),
          gt(table.deletedAt, since),
        ),
      );
    deletes[entity] = tombstoned.map((r) => r.id);
  }

  return Response.json({
    serverTime: serverTime.toISOString(),
    changes,
    deletes,
    nextSince: serverTime.toISOString(),
    hasMore: false,
  });
}
