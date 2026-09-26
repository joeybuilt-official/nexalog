// SPDX-License-Identifier: MIT
/**
 * POST /api/captures/[id]/touch-extract
 *
 * Beacon endpoint fired by client-side "Open" handlers. Idempotent:
 *   - if reader_state is already 'ready', no-op
 *   - else trigger the v1 enrichment chain in the background
 *     (metadata → reader → summary)
 *
 * Distinct from /api/captures/[id]/open, which also bumps open_count and
 * runs the legacy `extractArticle` pipeline. Front-ends that already call
 * `/open` get extraction for free; this endpoint is the lightweight
 * alternative for surfaces (search, synthesis, today) that just want to
 * make sure a reader-mode snapshot exists without bumping open metrics.
 *
 * Auth-gated. Returns immediately; does not await the chain.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { getAuthUser } from "@/lib/auth/server";
import { db, schema } from "@/lib/db";
import { getUserWorkspaces } from "@/lib/workspace";
import { and, eq, inArray } from "drizzle-orm";
import { enrichOne } from "@/lib/enrichment/metadata";
import { extractReader } from "@/lib/enrichment/reader";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  if (!id) return Response.json({ error: "missing_id" }, { status: 400 });

  const workspaces = await getUserWorkspaces(user.id);
  if (!workspaces.length) {
    return Response.json({ error: "no_workspace" }, { status: 404 });
  }
  const workspaceIds = workspaces.map((w) => w.id);

  const [row] = await db
    .select({
      id: schema.captureSources.id,
      readerState: schema.captureSources.readerState,
      metadataState: schema.captureSources.metadataState,
    })
    .from(schema.captureSources)
    .where(
      and(
        eq(schema.captureSources.id, id),
        inArray(schema.captureSources.workspaceId, workspaceIds),
      ),
    )
    .limit(1);

  if (!row) return Response.json({ error: "not_found" }, { status: 404 });

  // No-op if reader is terminal-ready and metadata is enriched.
  if (row.readerState === "ready" && row.metadataState === "enriched") {
    return Response.json({ ok: true, state: "ready", skipped: true });
  }

  // Fire-and-forget. Don't await — the client just needs the beacon to land.
  (async () => {
    try {
      const meta = await enrichOne(id);
      if (!meta.ok) return;
      const reader = await extractReader(id);
      if (!reader.ok) return;
      // summarize removed (v2: Hermes worker)
    } catch (err) {
      console.error("touch-extract chain error", id, err);
    }
  })();

  return Response.json({ ok: true, state: "queued" });
}
