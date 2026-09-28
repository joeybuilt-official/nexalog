// SPDX-License-Identifier: MIT
/**
 * POST /api/bookmarks — save a link.
 *
 * The front door for the bookmark model: a URL in, one `capture_sources` row
 * out (`kind = 'url'`), classified at write time so `/api/search` can see it
 * the moment it is saved (a `kind_classified IS NULL` row is invisible to the
 * search route's `inArray(kindClassified, …)` filter).
 *
 * Contract (JSON — the shape the browser extension, the PWA share target, the
 * quick-capture modal and the in-app Add Bookmark form already speak):
 *
 *   { url: string, workspaceId?: string }
 *
 * Behaviour, in order:
 *   1. authorize (401) and resolve the target workspace from the user's own
 *      memberships — a workspace id from the client is only ever matched
 *      against them, never trusted on its own;
 *   2. `normalizeUrl` (drops utm/fbclid, sorts params, lowercases host, …) and
 *      reject anything that is not http(s) with 400 `invalid_url`;
 *   3. idempotent dedupe on `(workspace_id, url)`. There is **no unique
 *      constraint on `url`** (PK only), so idempotency is this code's job:
 *      an already-saved link returns the existing row with `duplicate: true`
 *      and writes nothing;
 *   4. insert with `bookmarked_at = now` (the display date — see 0008), then
 *      classify (`lib/capture/classifier.ts`) for `kind_classified`,
 *      `url_host`, `url_path`;
 *   5. queue the enrichment chain (og metadata → reader extraction) AFTER the
 *      response, fire-and-forget, so the saved link becomes a searchable body
 *      without the caller waiting on a network fetch.
 *
 * The GET list stays exactly as it was; this adds the missing create half of
 * one resource on one route (same reasoning as the captures review route).
 */

export const dynamic = "force-dynamic";

import { z } from "zod";
import { and, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { getAuthUser } from "@/lib/auth/server";
import { db, schema } from "@/lib/db";
import { surfaceUnavailableIfMissingRelation } from "@/lib/db/surface-unavailable";
import { getUserWorkspaces } from "@/lib/workspace";
import { normalizeUrl } from "@/lib/url-normalize";
import { classifyUrl } from "@/lib/capture/classifier";
import { enrichOne } from "@/lib/enrichment/metadata";
import { extractReader } from "@/lib/enrichment/reader";
import { logEvent } from "@/lib/logger";

/** `strict()` so a misspelled field is a 400, not a silently ignored intent. */
const createBody = z
  .object({
    url: z.string().min(1).max(2048),
    workspaceId: z.string().uuid().optional(),
  })
  .strict();

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

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    return await createBookmark(request, user.id);
  } catch (err) {
    const unavailable = surfaceUnavailableIfMissingRelation(err, "POST /api/bookmarks");
    if (unavailable) return unavailable;
    throw err;
  }
}

async function createBookmark(request: Request, userId: string) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const parsed = createBody.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const url = normalizeUrl(parsed.data.url);
  if (!url) {
    // normalizeUrl refuses anything that is not http(s) — including the
    // `javascript:` and `data:` shapes a pasted string can carry.
    return Response.json({ error: "invalid_url" }, { status: 400 });
  }

  const workspaces = await getUserWorkspaces(userId);
  if (!workspaces.length) {
    return Response.json({ error: "no_workspace" }, { status: 404 });
  }

  // Workspace scoping: the client may name a workspace, but only one the user
  // actually belongs to is accepted. Anything else is a 404 — never a write
  // into someone else's workspace.
  let workspaceId = workspaces[0].id;
  if (parsed.data.workspaceId) {
    const member = workspaces.find((w) => w.id === parsed.data.workspaceId);
    if (!member) return Response.json({ error: "not_found" }, { status: 404 });
    workspaceId = member.id;
  }

  const existing = await db
    .select()
    .from(schema.captureSources)
    .where(
      and(
        eq(schema.captureSources.workspaceId, workspaceId),
        eq(schema.captureSources.url, url),
        eq(schema.captureSources.kind, "url"),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return Response.json({ ok: true, duplicate: true, bookmark: existing[0] });
  }

  const classified = classifyUrl({ url });
  const now = new Date();

  const [row] = await db
    .insert(schema.captureSources)
    .values({
      workspaceId,
      userId,
      kind: "url",
      content: url,
      url,
      state: "raw",
      kindClassified: classified.kind,
      classifiedAt: now,
      urlHost: classified.host || null,
      urlPath: classified.path || null,
      bookmarkedAt: now,
      // metadataState / readerState / summaryState / embeddingState all carry
      // NOT NULL defaults ('pending') in the schema — no state has to be
      // spelled out here, and the enrichment chain below advances them.
    })
    .returning();

  logEvent("bookmark.created", {
    bookmarkId: row.id,
    workspaceId,
    kindClassified: classified.kind,
  });

  // Queue extraction AFTER responding. The caller gets the row id immediately;
  // og metadata lands first (title/description/thumbnail), then the reader pass
  // stores `extracted_text` — the column the FTS index weights — which is what
  // makes a newly saved link findable by its body. Fire-and-forget mirrors
  // `/api/captures/[id]/touch-extract`: a fetch failure must not fail the save.
  queueEnrichment(row.id);

  return Response.json({ ok: true, duplicate: false, bookmark: row }, { status: 201 });
}

function queueEnrichment(captureId: string): void {
  void (async () => {
    try {
      const meta = await enrichOne(captureId);
      if (!meta.ok) return;
      await extractReader(captureId);
    } catch (err) {
      console.error("bookmark.enrich.error", captureId, err);
    }
  })();
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
