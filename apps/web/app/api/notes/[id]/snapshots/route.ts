// SPDX-License-Identifier: MIT
// Page snapshot (Ghost Archaeology) — append-only content version history
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/server";
import { getUserWorkspaces } from "@/lib/workspace";
import { db, schema } from "@/lib/db";
import { eq, and, inArray, desc } from "drizzle-orm";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: noteId } = await params;
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaces = await getUserWorkspaces(user.id);
  if (!workspaces.length) return NextResponse.json({ snapshots: [] });
  const workspaceIds = workspaces.map((w) => w.id);

  const [note] = await db
    .select({ id: schema.notes.id })
    .from(schema.notes)
    .where(and(eq(schema.notes.id, noteId), inArray(schema.notes.workspaceId, workspaceIds)))
    .limit(1);
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const snapshots = await db
    .select()
    .from(schema.pageSnapshots)
    .where(eq(schema.pageSnapshots.noteId, noteId))
    .orderBy(desc(schema.pageSnapshots.createdAt))
    .limit(50);

  return NextResponse.json({
    snapshots: snapshots.map((s) => ({
      ...s,
      createdAt: s.createdAt.toISOString(),
    })),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: noteId } = await params;
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaces = await getUserWorkspaces(user.id);
  if (!workspaces.length) return NextResponse.json({ error: "No workspace" }, { status: 400 });
  const workspaceIds = workspaces.map((w) => w.id);

  const [note] = await db
    .select({ id: schema.notes.id, content: schema.notes.content })
    .from(schema.notes)
    .where(and(eq(schema.notes.id, noteId), inArray(schema.notes.workspaceId, workspaceIds)))
    .limit(1);
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json() as { content?: string; rationale?: string };
  const content = body.content ?? note.content;

  const [snapshot] = await db
    .insert(schema.pageSnapshots)
    .values({ noteId, content, rationale: body.rationale ?? null })
    .returning();

  return NextResponse.json({
    snapshot: { ...snapshot, createdAt: snapshot.createdAt.toISOString() },
  }, { status: 201 });
}
