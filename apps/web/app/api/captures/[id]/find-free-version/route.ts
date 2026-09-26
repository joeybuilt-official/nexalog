// SPDX-License-Identifier: MIT
/**
 * POST /api/captures/[id]/find-free-version
 *
 * On a paywalled capture, runs a Brave search for `<og_title>
 * site:archive.org OR site:web.archive.org -site:<paywalled_host>`
 * and returns up to 3 alternative URLs.
 *
 * Result is cached in `capture_sources.metadata.free_versions[]` and
 * re-served on subsequent calls (cache-bust with `?refresh=1`). Cache TTL
 * is 7 days — past that, the row is re-queried.
 *
 * Auth: same workspace-membership check as `/api/captures/[id]/open`.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { getAuthUser } from "@/lib/auth/server";
import { db, schema } from "@/lib/db";
import { getUserWorkspaces } from "@/lib/workspace";
import { and, eq, inArray } from "drizzle-orm";
import { findFreeVersion, type FreeVersion } from "@/lib/capture/find-free-version";
import { urlHost } from "@/lib/capture/extractor";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface FreeVersionsCache {
  fetchedAt: string;
  query: string;
  versions: FreeVersion[];
  reason: string;
}

export async function POST(request: Request, context: RouteContext) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  if (!id) return Response.json({ error: "missing_id" }, { status: 400 });

  const url = new URL(request.url);
  const refresh = url.searchParams.get("refresh") === "1";

  const workspaces = await getUserWorkspaces(user.id);
  if (!workspaces.length) {
    return Response.json({ error: "no_workspace" }, { status: 404 });
  }
  const workspaceIds = workspaces.map((w) => w.id);

  const rows = await db
    .select({
      id: schema.captureSources.id,
      url: schema.captureSources.url,
      ogTitle: schema.captureSources.ogTitle,
      urlHost: schema.captureSources.urlHost,
      paywalled: schema.captureSources.paywalled,
      metadata: schema.captureSources.metadata,
    })
    .from(schema.captureSources)
    .where(
      and(
        eq(schema.captureSources.id, id),
        inArray(schema.captureSources.workspaceId, workspaceIds),
      ),
    )
    .limit(1);

  if (!rows.length) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const row = rows[0];

  // Read cached free_versions if present and fresh.
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const cached = meta.free_versions as FreeVersionsCache | undefined;
  if (!refresh && cached?.fetchedAt) {
    const age = Date.now() - new Date(cached.fetchedAt).getTime();
    if (age < CACHE_TTL_MS) {
      return Response.json({
        ok: cached.versions.length > 0,
        cached: true,
        reason: cached.reason,
        versions: cached.versions,
        fetchedAt: cached.fetchedAt,
      });
    }
  }

  const host = row.urlHost ?? urlHost(row.url) ?? null;

  const result = await findFreeVersion({
    ogTitle: row.ogTitle,
    paywalledHost: host,
  });

  // Always persist — even an `ok=false` so we don't re-spam Brave on every click.
  const payload: FreeVersionsCache = {
    fetchedAt: new Date().toISOString(),
    query: row.ogTitle ?? "",
    versions: result.versions,
    reason: result.reason,
  };
  await db
    .update(schema.captureSources)
    .set({
      metadata: { ...meta, free_versions: payload },
    })
    .where(eq(schema.captureSources.id, id));

  return Response.json({
    ok: result.ok,
    cached: false,
    reason: result.reason,
    versions: result.versions,
    fetchedAt: payload.fetchedAt,
  });
}
