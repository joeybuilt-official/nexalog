// SPDX-License-Identifier: MIT
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/server";
import { db, schema } from "@/lib/db";
import { getUserWorkspaces } from "@/lib/workspace";
import { eq, and, inArray } from "drizzle-orm";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sourceNoteId } = await params;
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaces = await getUserWorkspaces(user.id);
  if (!workspaces.length)
    return NextResponse.json({ error: "No workspace" }, { status: 400 });
  const workspaceIds = workspaces.map((ws) => ws.id);

  // Verify source note belongs to user
  const [sourceNote] = await db
    .select({ id: schema.notes.id })
    .from(schema.notes)
    .where(
      and(
        eq(schema.notes.id, sourceNoteId),
        inArray(schema.notes.workspaceId, workspaceIds)
      )
    )
    .limit(1);

  if (!sourceNote)
    return NextResponse.json({ error: "Note not found" }, { status: 404 });

  const body = await request.json();
  const { targetNoteId, kind = "wikilink" } = body as {
    targetNoteId: string;
    kind?: string;
  };

  if (!targetNoteId)
    return NextResponse.json({ error: "targetNoteId required" }, { status: 400 });

  // Idempotent: ignore duplicate wikilinks
  await db
    .insert(schema.noteLinks)
    .values({ sourceNoteId, targetNoteId, kind, strength: 0.8 })
    .onConflictDoNothing();

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sourceNoteId } = await params;
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaces = await getUserWorkspaces(user.id);
  if (!workspaces.length)
    return NextResponse.json({ error: "No workspace" }, { status: 400 });
  const workspaceIds = workspaces.map((ws) => ws.id);

  const [sourceNote] = await db
    .select({ id: schema.notes.id })
    .from(schema.notes)
    .where(
      and(
        eq(schema.notes.id, sourceNoteId),
        inArray(schema.notes.workspaceId, workspaceIds)
      )
    )
    .limit(1);

  if (!sourceNote)
    return NextResponse.json({ error: "Note not found" }, { status: 404 });

  const body = await request.json();
  const { targetNoteId } = body as { targetNoteId: string };

  if (!targetNoteId)
    return NextResponse.json({ error: "targetNoteId required" }, { status: 400 });

  await db
    .delete(schema.noteLinks)
    .where(
      and(
        eq(schema.noteLinks.sourceNoteId, sourceNoteId),
        eq(schema.noteLinks.targetNoteId, targetNoteId)
      )
    );

  return NextResponse.json({ ok: true });
}
