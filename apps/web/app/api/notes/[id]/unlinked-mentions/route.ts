// SPDX-License-Identifier: MIT
export const dynamic = "force-dynamic";
import { getAuthUser } from "@/lib/auth/server";
import { db, schema } from "@/lib/db";
import { getUserWorkspaces } from "@/lib/workspace";
import { eq, and, inArray, isNull, ne } from "drizzle-orm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const workspaces = await getUserWorkspaces(user.id);
  if (!workspaces.length) return Response.json({ mentions: [] });
  const workspaceIds = workspaces.map((ws) => ws.id);

  // Load this note (scoped to user's workspaces).
  const [note] = await db
    .select({ id: schema.notes.id, content: schema.notes.content })
    .from(schema.notes)
    .where(
      and(
        eq(schema.notes.id, id),
        inArray(schema.notes.workspaceId, workspaceIds),
        isNull(schema.notes.deletedAt)
      )
    )
    .limit(1);

  if (!note) return Response.json({ error: "Note not found" }, { status: 404 });

  // Notes already linked from this note — exclude them.
  const existing = await db
    .select({ targetNoteId: schema.noteLinks.targetNoteId })
    .from(schema.noteLinks)
    .where(eq(schema.noteLinks.sourceNoteId, id));
  const linkedIds = new Set(existing.map((l) => l.targetNoteId));

  // Candidate notes: other non-deleted notes in the same workspaces.
  // Counts are tiny, so a JS whole-word scan is plenty.
  const candidates = await db
    .select({ id: schema.notes.id, title: schema.notes.title })
    .from(schema.notes)
    .where(
      and(
        inArray(schema.notes.workspaceId, workspaceIds),
        isNull(schema.notes.deletedAt),
        ne(schema.notes.id, id)
      )
    );

  const content = (note.content || "").toLowerCase();
  const mentions: { id: string; title: string }[] = [];

  for (const c of candidates) {
    if (linkedIds.has(c.id)) continue;
    const title = (c.title || "").trim();
    if (title.length < 2) continue;
    const needle = title.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${needle}(?![\\p{L}\\p{N}])`, "u");
    if (re.test(content)) mentions.push({ id: c.id, title });
    if (mentions.length >= 20) break;
  }

  return Response.json({ mentions });
}
