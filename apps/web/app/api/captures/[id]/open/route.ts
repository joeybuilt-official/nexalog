// SPDX-License-Identifier: MIT
/**
 * POST /api/captures/[id]/open
 *
 * One endpoint, two jobs:
 *   1. Always — bump open_count, last_opened_at, last_visited_at, opened_at.
 *      Used by every Nexalog surface that sends the user to a saved URL —
 *      bookmarks list, /watch, /reading, /reference, search, graph, today.
 *   2. First open of an article — fire-and-forget Readability extraction in
 *      the background. If body is long enough, summarize via Plexo Haiku.
 *      Subsequent opens skip extraction (cap one extract + one summary per
 *      row, lifetime).
 *
 * Auth-gated. Cross-workspace IDs return 403.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { getAuthUser } from "@/lib/auth/server";
import { db, schema } from "@/lib/db";
import { getUserWorkspaces } from "@/lib/workspace";
import { and, eq, inArray, sql } from "drizzle-orm";
import { extractArticle } from "@/lib/capture/extractor";
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

  const now = new Date();
  const updated = await db
    .update(schema.captureSources)
    .set({
      lastOpenedAt: now,
      lastVisitedAt: now,
      openedAt: sql`COALESCE(${schema.captureSources.openedAt}, ${now.toISOString()}::timestamptz)`,
      openCount: sql`${schema.captureSources.openCount} + 1`,
    })
    .where(
      and(
        eq(schema.captureSources.id, id),
        inArray(schema.captureSources.workspaceId, workspaceIds)
      )
    )
    .returning({
      id: schema.captureSources.id,
      kind: schema.captureSources.kind,
      url: schema.captureSources.url,
      kindClassified: schema.captureSources.kindClassified,
      extractedText: schema.captureSources.extractedText,
      userId: schema.captureSources.userId,
      openCount: schema.captureSources.openCount,
    });

  if (!updated.length) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const row = updated[0];

  // Background extraction on first open of an article-kind URL.
  if (
    row.url &&
    row.kind === "url" &&
    row.kindClassified !== "homepage" &&
    row.kindClassified !== "social" &&
    !row.extractedText
  ) {
    extractInBackground(row.id, row.url, row.userId, user.email).catch((err) =>
      console.error("extract bg error", row.id, err)
    );
  }

  // V1 enrichment pipeline — fire alongside legacy extract. enrichOne is
  // idempotent and skips fresh rows; the chain only runs when work is needed.
  if (row.url && row.kind === "url") {
    enrichmentChain(row.id).catch((err) =>
      console.error("enrich chain error", row.id, err),
    );
  }

  return Response.json({
    ok: true,
    openCount: row.openCount,
    url: row.url,
    extracted: !!row.extractedText,
  });
}

async function enrichmentChain(captureId: string): Promise<void> {
  const meta = await enrichOne(captureId);
  if (!meta.ok) return;
  const reader = await extractReader(captureId);
  if (!reader.ok) return;
  // summarize removed (v2: Hermes worker)
}

async function extractInBackground(
  captureId: string,
  url: string,
  userId: string,
  email: string | undefined
): Promise<void> {
  const result = await extractArticle(url);
  const updates: Partial<typeof schema.captureSources.$inferInsert> = {
    extractedAt: new Date(),
    paywalled: result.paywalled,
  };
  if (result.text) {
    updates.extractedText = result.text;
    updates.readMinutes = result.readMinutes ?? null;
  }

  await db
    .update(schema.captureSources)
    .set(updates)
    .where(eq(schema.captureSources.id, captureId));

  // Summarization moves to the Hermes inbox worker (v2) — no in-app LLM.

}
