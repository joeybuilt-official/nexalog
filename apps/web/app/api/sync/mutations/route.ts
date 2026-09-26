/**
 * Offline Mutation-Push (LWW — ADR-0001/0003)
 *
 * POST /api/sync/mutations
 *   body: { ops: [{ opId, entity, op:create|update|delete, id, payload, clientTs }] }
 *   → { results: [{ opId, status:applied|rejected, row?, reason? }] }
 *
 * Each op is idempotent by opId (ledger nexalog.sync_mutation_log). PKM data
 * uses last-write-wins by updatedAt: on an update whose server row is NEWER than
 * the client's clientTs the server copy wins (we keep it and return the
 * authoritative row) — no destructive clobber, no user-facing conflict. Deletes
 * are soft (deletedAt). Every query scoped to the authenticated user.
 *
 * Auth: getAuthUser (cookie OR bearer token).
 *
 * Failure mode: this route writes the carried-over v1 content model, which is
 * not present in the database the deployment points this process at. A missing
 * relation fails the whole request with an explicit 503 rather than being
 * reported per-op as `rejected` — see below and `lib/db/surface-unavailable.ts`.
 */
import { getAuthUser } from "@/lib/auth/server";
import { db, schema } from "@/lib/db";
import { findMissingRelation, surfaceUnavailableIfMissingRelation } from "@/lib/db/surface-unavailable";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const opSchema = z.object({
  opId: z.string().min(1).max(200),
  entity: z.string().min(1),
  op: z.enum(["create", "update", "delete"]),
  id: z.string().min(1).optional().nullable(),
  payload: z.record(z.string(), z.unknown()).optional(),
  clientTs: z.string().optional(),
});

const bodySchema = z.object({ ops: z.array(opSchema).max(500) });

// In-scope entities + their client-mutable fields. Anything not listed is
// dropped from the payload (server-owned / immutable).
const ENTITY_TABLES = {
  notes: {
    table: schema.notes,
    fields: ["workspaceId", "title", "content", "kind", "lifecycleState", "date"],
  },
  captureSources: {
    table: schema.captureSources,
    fields: ["workspaceId", "kind", "content", "url", "state", "noteId", "ogTitle", "ogDescription"],
  },
  journalEntries: {
    table: schema.journalEntries,
    fields: ["workspaceId", "entryDate", "body", "mood", "energy", "weatherJson", "voiceSourceId"],
  },
  projects: {
    table: schema.projects,
    fields: ["workspaceId", "name", "description", "lifecycleState", "livingDoc"],
  },
  bookmarkCollections: {
    table: schema.bookmarkCollections,
    fields: ["workspaceId", "name", "description", "color", "icon", "sortOrder"],
  },
} as const;

type Entity = keyof typeof ENTITY_TABLES;

function isInScope(e: string): e is Entity {
  return e in ENTITY_TABLES;
}

type OpResult = {
  opId: string;
  status: "applied" | "rejected";
  row?: unknown;
  reason?: string;
};

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const results: OpResult[] = [];
  try {
    for (const op of parsed.data.ops) {
      try {
        results.push(await applyOp(user.id, op));
      } catch (err) {
        // A missing relation is a server-side condition, not a verdict on this
        // op: every following op would fail identically. Reporting it as
        // `rejected` would tell the client the write is terminally unapplyable,
        // and the shipped Flutter client parks a rejected op as a conflict
        // (`MutationQueue.markConflict`) — the user's queued write would be
        // silently dropped for good. So it escapes the per-op catch and becomes
        // the 503 below, which the client retries on the next sync.
        if (findMissingRelation(err)) throw err;
        console.error("[sync/mutations] op failed", op.opId, err);
        results.push({
          opId: op.opId,
          status: "rejected",
          reason: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }
  } catch (err) {
    const unavailable = surfaceUnavailableIfMissingRelation(
      err,
      "POST /api/sync/mutations",
    );
    if (unavailable) return unavailable;
    throw err;
  }
  return Response.json({ results });
}

async function applyOp(
  userId: string,
  op: z.infer<typeof opSchema>,
): Promise<OpResult> {
  if (!isInScope(op.entity)) {
    return { opId: op.opId, status: "rejected", reason: `Out-of-scope entity: ${op.entity}` };
  }

  // Idempotency: a seen opId is a replay → no-op.
  const prior = await db
    .select({ opId: schema.syncMutationLog.opId })
    .from(schema.syncMutationLog)
    .where(eq(schema.syncMutationLog.opId, op.opId))
    .limit(1);
  if (prior.length > 0) return { opId: op.opId, status: "applied" };

  const { table, fields } = ENTITY_TABLES[op.entity];
  const allowed = new Set<string>(fields);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = table as any;

  const pick = (payload: Record<string, unknown> | undefined) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload ?? {})) {
      if (allowed.has(k)) out[k] = v;
    }
    return out;
  };

  const fetchOwned = async (id: string) => {
    const rows = await db
      .select()
      .from(table)
      .where(and(eq(t.id, id), eq(t.userId, userId)))
      .limit(1);
    return rows[0] as Record<string, unknown> | undefined;
  };

  if (op.op === "create") {
    const values: Record<string, unknown> = { ...pick(op.payload), userId };
    if (op.id) values.id = op.id;
    const inserted = await db.insert(table).values(values as never).returning();
    await logOp(userId, op, (inserted[0] as { id?: string })?.id);
    return { opId: op.opId, status: "applied", row: inserted[0] };
  }

  if (op.op === "update") {
    if (!op.id) return { opId: op.opId, status: "rejected", reason: "update requires id" };
    const existing = await fetchOwned(op.id);
    if (!existing) return { opId: op.opId, status: "rejected", reason: "Row not found" };

    // LWW: if the server row is newer than the client's edit, server wins.
    if (op.clientTs) {
      const clientTs = new Date(op.clientTs);
      const serverUpdated = existing.updatedAt as Date | null;
      if (serverUpdated && !Number.isNaN(clientTs.getTime()) && serverUpdated > clientTs) {
        await logOp(userId, op, op.id);
        return { opId: op.opId, status: "applied", row: existing };
      }
    }

    const setValues: Record<string, unknown> = { ...pick(op.payload), updatedAt: new Date() };
    const updated = await db
      .update(table)
      .set(setValues as never)
      .where(and(eq(t.id, op.id), eq(t.userId, userId)))
      .returning();
    await logOp(userId, op, op.id);
    return { opId: op.opId, status: "applied", row: updated[0] };
  }

  // delete → soft tombstone.
  if (!op.id) return { opId: op.opId, status: "rejected", reason: "delete requires id" };
  const existing = await fetchOwned(op.id);
  if (!existing) return { opId: op.opId, status: "rejected", reason: "Row not found" };
  const deleted = await db
    .update(table)
    .set({ deletedAt: new Date(), updatedAt: new Date() } as never)
    .where(and(eq(t.id, op.id), eq(t.userId, userId)))
    .returning();
  await logOp(userId, op, op.id);
  return { opId: op.opId, status: "applied", row: deleted[0] };
}

async function logOp(
  userId: string,
  op: z.infer<typeof opSchema>,
  targetId: string | undefined,
) {
  await db
    .insert(schema.syncMutationLog)
    .values({
      opId: op.opId,
      userId,
      entity: op.entity,
      op: op.op,
      targetId: targetId ?? op.id ?? null,
    })
    .onConflictDoNothing({ target: schema.syncMutationLog.opId });
}
