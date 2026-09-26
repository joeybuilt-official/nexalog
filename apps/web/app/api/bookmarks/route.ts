// SPDX-License-Identifier: MIT
import { getAuthUser } from "@/lib/auth/server";
import { db, schema } from "@/lib/db";
import { surfaceUnavailableIfMissingRelation } from "@/lib/db/surface-unavailable";
import { getUserWorkspaces } from "@/lib/workspace";
import { eq, and, ilike, or, inArray, sql } from "drizzle-orm";

export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    return await listBookmarks(request, user.id);
  } catch (err) {
    const unavailable = surfaceUnavailableIfMissingRelation(err, "GET /api/bookmarks");
    if (unavailable) return unavailable;
    throw err;
  }
}

async function listBookmarks(request: Request, userId: string) {
  const workspaces = await getUserWorkspaces(userId);
  if (!workspaces.length) return Response.json({ bookmarks: [] });
  const workspace = workspaces[0];

  const { searchParams } = new URL(request.url);
  const collectionId = searchParams.get("collectionId");
  const tagId = searchParams.get("tagId");
  const search = searchParams.get("search");
  const sort = searchParams.get("sort") ?? "newest";

  // Sort by the user's effective save date — `bookmarked_at` if the
  // import preserved it (Telegram, Karakeep, YouTube), else `created_at`
  // (browser ext, manual capture). See drizzle/0008_bookmarked_at.sql.
  const effectiveDate = sql`COALESCE(${schema.captureSources.bookmarkedAt}, ${schema.captureSources.createdAt})`;
  const orderBy = sort === "oldest"
    ? sql`${effectiveDate} ASC`
    : sql`${effectiveDate} DESC`;

  // Build base conditions
  const conditions = [
    eq(schema.captureSources.workspaceId, workspace.id),
    eq(schema.captureSources.kind, "url"),
  ];

  if (search) {
    conditions.push(
      or(
        ilike(schema.captureSources.ogTitle, `%${search}%`),
        ilike(schema.captureSources.url, `%${search}%`),
        ilike(schema.captureSources.ogDescription, `%${search}%`),
        ilike(schema.captureSources.content, `%${search}%`)
      )!
    );
  }

  // If filtering by collection, get IDs first
  if (collectionId) {
    const colEntries = await db
      .select({ captureSourceId: schema.captureSourceCollections.captureSourceId })
      .from(schema.captureSourceCollections)
      .where(eq(schema.captureSourceCollections.collectionId, collectionId));
    const ids = colEntries.map((e) => e.captureSourceId);
    if (ids.length === 0) return Response.json({ bookmarks: [] });
    conditions.push(inArray(schema.captureSources.id, ids));
  }

  // If filtering by tag, get IDs first
  if (tagId) {
    const tagEntries = await db
      .select({ captureSourceId: schema.captureSourceTags.captureSourceId })
      .from(schema.captureSourceTags)
      .where(eq(schema.captureSourceTags.tagId, tagId));
    const ids = tagEntries.map((e) => e.captureSourceId);
    if (ids.length === 0) return Response.json({ bookmarks: [] });
    conditions.push(inArray(schema.captureSources.id, ids));
  }

  const bookmarks = await db
    .select()
    .from(schema.captureSources)
    .where(and(...conditions))
    .orderBy(orderBy);

  // Attach tags and collections for each bookmark
  const bookmarkIds = bookmarks.map((b) => b.id);

  const tagMap: Record<string, typeof schema.bookmarkTags.$inferSelect[]> = {};
  const collectionMap: Record<string, typeof schema.bookmarkCollections.$inferSelect[]> = {};

  if (bookmarkIds.length > 0) {
    const tagRows = await db
      .select({
        captureSourceId: schema.captureSourceTags.captureSourceId,
        tag: schema.bookmarkTags,
      })
      .from(schema.captureSourceTags)
      .innerJoin(schema.bookmarkTags, eq(schema.bookmarkTags.id, schema.captureSourceTags.tagId))
      .where(inArray(schema.captureSourceTags.captureSourceId, bookmarkIds));

    for (const row of tagRows) {
      if (!tagMap[row.captureSourceId]) tagMap[row.captureSourceId] = [];
      tagMap[row.captureSourceId].push(row.tag);
    }

    const colRows = await db
      .select({
        captureSourceId: schema.captureSourceCollections.captureSourceId,
        collection: schema.bookmarkCollections,
      })
      .from(schema.captureSourceCollections)
      .innerJoin(schema.bookmarkCollections, eq(schema.bookmarkCollections.id, schema.captureSourceCollections.collectionId))
      .where(inArray(schema.captureSourceCollections.captureSourceId, bookmarkIds));

    for (const row of colRows) {
      if (!collectionMap[row.captureSourceId]) collectionMap[row.captureSourceId] = [];
      collectionMap[row.captureSourceId].push(row.collection);
    }
  }

  const result = bookmarks.map((b) => ({
    ...b,
    tags: tagMap[b.id] ?? [],
    collections: collectionMap[b.id] ?? [],
  }));

  return Response.json({ bookmarks: result });
}
