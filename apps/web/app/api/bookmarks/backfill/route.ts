import { getAuthUser } from "@/lib/auth/server";
import { db, schema } from "@/lib/db";
import { getUserWorkspaces } from "@/lib/workspace";
import { fetchUrlPreview } from "@/lib/og-metadata";
import { normalizeUrl, bookmarkScore } from "@/lib/url-normalize";
import { and, eq, inArray, isNull, or } from "drizzle-orm";

/**
 * POST /api/bookmarks/backfill
 *
 * Three passes (all idempotent):
 *   1. Canonicalize: rewrite each bookmark's URL through normalizeUrl
 *      (strips utm/fbclid/etc., sorts params, lowercases host).
 *   2. Dedupe: group rows by canonical URL, keep the most-complete row
 *      (highest bookmarkScore — most non-null preview fields), reassign
 *      tag + collection links to the keeper, delete the rest.
 *   3. Preview: refetch og metadata for any keeper still missing og_image.
 *
 * Returns counts so the caller knows what changed.
 */
export async function POST(_request: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const workspaces = await getUserWorkspaces(user.id);
  if (!workspaces.length) {
    return Response.json({ canonicalized: 0, deduped: 0, refetched: 0, skipped: 0 });
  }
  const workspaceIds = workspaces.map((w) => w.id);

  // ── Pass 1: canonicalize ─────────────────────────────────────────────────
  const allRows = await db
    .select({
      id: schema.captureSources.id,
      url: schema.captureSources.url,
      content: schema.captureSources.content,
      ogTitle: schema.captureSources.ogTitle,
      ogDescription: schema.captureSources.ogDescription,
      ogImage: schema.captureSources.ogImage,
      faviconUrl: schema.captureSources.faviconUrl,
      createdAt: schema.captureSources.createdAt,
      workspaceId: schema.captureSources.workspaceId,
    })
    .from(schema.captureSources)
    .where(
      and(
        inArray(schema.captureSources.workspaceId, workspaceIds),
        eq(schema.captureSources.kind, "url"),
      ),
    );

  let canonicalized = 0;
  const canonicalById = new Map<string, string>();
  for (const row of allRows) {
    const original = row.url ?? row.content;
    const canonical = normalizeUrl(original);
    if (!canonical) continue;
    canonicalById.set(row.id, canonical);
    if (canonical !== row.url) {
      await db
        .update(schema.captureSources)
        .set({ url: canonical })
        .where(eq(schema.captureSources.id, row.id));
      canonicalized++;
    }
  }

  // ── Pass 2: dedupe per workspace ─────────────────────────────────────────
  let deduped = 0;
  const groups = new Map<string, typeof allRows>();
  for (const row of allRows) {
    const canonical = canonicalById.get(row.id);
    if (!canonical) continue;
    const groupKey = `${row.workspaceId}|${canonical}`;
    const arr = groups.get(groupKey) ?? [];
    arr.push({ ...row, url: canonical });
    groups.set(groupKey, arr);
  }

  for (const dups of groups.values()) {
    if (dups.length < 2) continue;
    dups.sort((a, b) => {
      const sa = bookmarkScore(a);
      const sb = bookmarkScore(b);
      if (sa !== sb) return sb - sa;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
    const keeper = dups[0];
    const losers = dups.slice(1);
    const loserIds = losers.map((l) => l.id);

    // Reassign tag + collection links from losers to keeper
    await db
      .update(schema.captureSourceTags)
      .set({ captureSourceId: keeper.id })
      .where(inArray(schema.captureSourceTags.captureSourceId, loserIds))
      .catch(() => null);
    await db
      .update(schema.captureSourceCollections)
      .set({ captureSourceId: keeper.id })
      .where(inArray(schema.captureSourceCollections.captureSourceId, loserIds))
      .catch(() => null);

    await db
      .delete(schema.captureSources)
      .where(inArray(schema.captureSources.id, loserIds));

    deduped += losers.length;
  }

  // ── Pass 3: refetch preview for keepers still missing og_image ───────────
  const stillMissing = await db
    .select({ id: schema.captureSources.id, url: schema.captureSources.url })
    .from(schema.captureSources)
    .where(
      and(
        inArray(schema.captureSources.workspaceId, workspaceIds),
        eq(schema.captureSources.kind, "url"),
        or(isNull(schema.captureSources.ogImage), eq(schema.captureSources.ogImage, "")),
      ),
    );

  let refetched = 0;
  let skipped = 0;
  for (const row of stillMissing) {
    if (!row.url) { skipped++; continue; }
    try {
      const preview = await fetchUrlPreview(row.url);
      if (!preview || (!preview.image && !preview.title)) { skipped++; continue; }
      await db
        .update(schema.captureSources)
        .set({
          ogTitle: preview.title,
          ogDescription: preview.description,
          ogImage: preview.image,
          faviconUrl: preview.favicon,
        })
        .where(eq(schema.captureSources.id, row.id));
      refetched++;
    } catch {
      skipped++;
    }
  }

  return Response.json({
    total: allRows.length,
    canonicalized,
    deduped,
    refetched,
    skipped,
  });
}
