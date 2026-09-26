// Bookmarks page. Two-pane nav.
// Categories = the controlled-vocabulary tag set (clean, bounded — ~25 tags).
// The emergent theme forest is demoted to per-card labels (no longer the nav
// backbone): the old freeform "thousands of tags" problem is gone now that
// tagging is anchored to a small controlled vocabulary.

import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/server";
import { getUserWorkspaces } from "@/lib/workspace";
import { db, schema } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { BookmarksClient } from "./client";
import { getForest } from "@/lib/themes/forest";

export default async function BookmarksPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const workspaces = await getUserWorkspaces(user.id);
  const ws = workspaces[0];
  if (!ws) redirect("/app/dashboard");

    const [forest, tagRows] = await Promise.all([
    getForest(ws.id, null),
    db
      .select({
        id: schema.bookmarkTags.id,
        name: schema.bookmarkTags.name,
        color: schema.bookmarkTags.color,
        count: sql<number>`count(${schema.captureSourceTags.id})::int`,
      })
      .from(schema.bookmarkTags)
      .leftJoin(
        schema.captureSourceTags,
        eq(schema.captureSourceTags.tagId, schema.bookmarkTags.id)
      )
      .where(eq(schema.bookmarkTags.workspaceId, ws.id))
      .groupBy(
        schema.bookmarkTags.id,
        schema.bookmarkTags.name,
        schema.bookmarkTags.color
      )
      .orderBy(sql`count(${schema.captureSourceTags.id}) desc`),
  ]);

  const tags = tagRows.filter((t: { count: number }) => t.count > 0);

  return (
    <BookmarksClient
      initialForest={forest}
      tags={tags}
      totalBookmarks={forest.totalCaptures}
    />
  );
}
