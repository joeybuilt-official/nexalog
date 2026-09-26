// SPDX-License-Identifier: MIT
/**
 * GET  /api/captures/[id]/reader — fetch extracted reader content for a row.
 * POST /api/captures/[id]/reader — force re-extract (idempotent).
 *
 * Returns the same shape both ways:
 *   { ok, state, html, text, fetchedAt, paywalled, readMinutes }
 *
 * Auth-gated; cross-workspace IDs return 404.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { getAuthUser } from "@/lib/auth/server";
import { db, schema } from "@/lib/db";
import { getUserWorkspaces } from "@/lib/workspace";
import { and, eq, inArray } from "drizzle-orm";
import { extractReader } from "@/lib/enrichment/reader";

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function loadRow(id: string, userId: string) {
  const workspaces = await getUserWorkspaces(userId);
  if (!workspaces.length) return { error: "no_workspace" as const };
  const workspaceIds = workspaces.map((w) => w.id);

  const [row] = await db
    .select({
      id: schema.captureSources.id,
      url: schema.captureSources.url,
      readerHtml: schema.captureSources.readerHtml,
      readerText: schema.captureSources.readerText,
      readerState: schema.captureSources.readerState,
      readerFetchedAt: schema.captureSources.readerFetchedAt,
      extractedText: schema.captureSources.extractedText,
      paywalled: schema.captureSources.paywalled,
      readMinutes: schema.captureSources.readMinutes,
    })
    .from(schema.captureSources)
    .where(
      and(
        eq(schema.captureSources.id, id),
        inArray(schema.captureSources.workspaceId, workspaceIds),
      ),
    )
    .limit(1);

  if (!row) return { error: "not_found" as const };
  return { row };
}

export async function GET(_request: Request, context: RouteContext) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const result = await loadRow(id, user.id);
  if ("error" in result) {
    return Response.json(
      { error: result.error },
      { status: result.error === "not_found" ? 404 : 400 },
    );
  }

  const row = result.row;
  return Response.json({
    ok: true,
    state: row.readerState,
    html: row.readerHtml ?? null,
    // Mirror legacy column when readerText hasn't been backfilled yet.
    text: row.readerText ?? row.extractedText ?? null,
    fetchedAt: row.readerFetchedAt?.toISOString() ?? null,
    paywalled: row.paywalled ?? false,
    readMinutes: row.readMinutes ?? null,
  });
}

export async function POST(_request: Request, context: RouteContext) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const result = await loadRow(id, user.id);
  if ("error" in result) {
    return Response.json(
      { error: result.error },
      { status: result.error === "not_found" ? 404 : 400 },
    );
  }

  const extracted = await extractReader(id);
  return Response.json({
    ok: extracted.ok,
    state: extracted.state,
    reason: extracted.reason,
  });
}
