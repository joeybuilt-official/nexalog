// SPDX-License-Identifier: MIT
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/server";
import { getUserWorkspaces } from "@/lib/workspace";
import { db, schema } from "@/lib/db";
import { eq, and, inArray } from "drizzle-orm";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: noteId } = await params;
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaces = await getUserWorkspaces(user.id);
  if (!workspaces.length) return NextResponse.json({ tags: [] });
  const workspaceIds = workspaces.map((w) => w.id);

  const [note] = await db
    .select({ id: schema.notes.id })
    .from(schema.notes)
    .where(and(eq(schema.notes.id, noteId), inArray(schema.notes.workspaceId, workspaceIds)))
    .limit(1);
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rows = await db
    .select({
      id: schema.bookmarkTags.id,
      name: schema.bookmarkTags.name,
      color: schema.bookmarkTags.color,
    })
    .from(schema.noteTags)
    .innerJoin(schema.bookmarkTags, eq(schema.noteTags.tagId, schema.bookmarkTags.id))
    .where(eq(schema.noteTags.noteId, noteId));

  return NextResponse.json({ tags: rows });
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
    .select({ id: schema.notes.id })
    .from(schema.notes)
    .where(and(eq(schema.notes.id, noteId), inArray(schema.notes.workspaceId, workspaceIds)))
    .limit(1);
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json() as { tagId?: string; name?: string; color?: string };

  let tagId: string;
  if (body.tagId) {
    tagId = body.tagId;
  } else if (body.name) {
    // Create tag in first workspace if not providing tagId
    const workspaceId = workspaceIds[0];
    const [existing] = await db
      .select({ id: schema.bookmarkTags.id })
      .from(schema.bookmarkTags)
      .where(and(eq(schema.bookmarkTags.workspaceId, workspaceId), eq(schema.bookmarkTags.name, body.name)))
      .limit(1);
    if (existing) {
      tagId = existing.id;
    } else {
      const [newTag] = await db
        .insert(schema.bookmarkTags)
        .values({ workspaceId, name: body.name, color: body.color ?? "#6366f1" })
        .returning({ id: schema.bookmarkTags.id });
      tagId = newTag.id;
    }
  } else {
    return NextResponse.json({ error: "tagId or name required" }, { status: 400 });
  }

  await db
    .insert(schema.noteTags)
    .values({ noteId, tagId })
    .onConflictDoNothing();

  return NextResponse.json({ ok: true, tagId });
}

export async function DELETE(
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
    .select({ id: schema.notes.id })
    .from(schema.notes)
    .where(and(eq(schema.notes.id, noteId), inArray(schema.notes.workspaceId, workspaceIds)))
    .limit(1);
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json() as { tagId: string };
  if (!body.tagId) return NextResponse.json({ error: "tagId required" }, { status: 400 });

  await db
    .delete(schema.noteTags)
    .where(and(eq(schema.noteTags.noteId, noteId), eq(schema.noteTags.tagId, body.tagId)));

  return NextResponse.json({ ok: true });
}
