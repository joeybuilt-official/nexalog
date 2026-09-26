// SPDX-License-Identifier: MIT
/**
 * Today-page data loader.
 *
 * Deterministic-only lanes: recency + open-loops + stale links. Synthesis
 * surfaces were cut 2026-06-27 (paired Plexo /api/v1/synthesis cut).
 */

import { db, schema } from "@/lib/db";
import { and, desc, eq, gt, isNotNull, isNull, sql, count } from "drizzle-orm";

export interface StaleCandidate {
  id: string;
  ogTitle: string | null;
  url: string | null;
  urlHost: string | null;
  stalenessScore: number;
  stalenessReason: string | null;
}

export interface ContinueItem {
  id: string;
  title: string | null;
  snippet: string | null;
  updatedAt: string;
}

export interface RecentSave {
  id: string;
  title: string | null;
  url: string | null;
  urlHost: string | null;
  savedAt: string;
}

export interface TodayCardsData {
  /** Deterministic daily-relevance lanes (recency/open-loops). */
  continueItems: ContinueItem[];
  recentSaves: RecentSave[];
  triageCount: number;
  goneStale: StaleCandidate[];
}

export async function loadTodayCards(args: {
  workspaceId: string;
}): Promise<TodayCardsData> {
  const { workspaceId } = args;

  const [staleRows, continueRows, recentSaveRows, triageRows] = await Promise.all([
    db
      .select({
        id: schema.captureSources.id,
        ogTitle: schema.captureSources.ogTitle,
        url: schema.captureSources.url,
        urlHost: schema.captureSources.urlHost,
        stalenessScore: schema.captureSources.stalenessScore,
        stalenessReason: schema.captureSources.stalenessReason,
      })
      .from(schema.captureSources)
      .where(
        and(
          eq(schema.captureSources.workspaceId, workspaceId),
          gt(schema.captureSources.stalenessScore, 0.7),
          isNull(schema.captureSources.smartArchivedAt),
          isNotNull(schema.captureSources.url),
        ),
      )
      .orderBy(desc(schema.captureSources.stalenessScore))
      .limit(8),
    db
      .select({
        id: schema.notes.id,
        title: schema.notes.title,
        content: schema.notes.content,
        updatedAt: schema.notes.updatedAt,
      })
      .from(schema.notes)
      .where(
        and(
          eq(schema.notes.workspaceId, workspaceId),
          isNull(schema.notes.deletedAt),
          sql`NOT EXISTS (SELECT 1 FROM ${schema.captureSources} cs WHERE cs.note_id = ${schema.notes.id} AND cs.kind = 'url')`,
        ),
      )
      .orderBy(desc(schema.notes.updatedAt))
      .limit(6),
    db
      .select({
        id: schema.captureSources.id,
        ogTitle: schema.captureSources.ogTitle,
        derivedTitle: schema.captureSources.derivedTitle,
        url: schema.captureSources.url,
        urlHost: schema.captureSources.urlHost,
        bookmarkedAt: schema.captureSources.bookmarkedAt,
        createdAt: schema.captureSources.createdAt,
      })
      .from(schema.captureSources)
      .where(
        and(
          eq(schema.captureSources.workspaceId, workspaceId),
          eq(schema.captureSources.kind, "url"),
          isNull(schema.captureSources.smartArchivedAt),
        ),
      )
      .orderBy(desc(sql`coalesce(${schema.captureSources.bookmarkedAt}, ${schema.captureSources.createdAt})`))
      .limit(6),
    db
      .select({ value: count() })
      .from(schema.captureSources)
      .where(
        and(
          eq(schema.captureSources.workspaceId, workspaceId),
          eq(schema.captureSources.kind, "url"),
          isNull(schema.captureSources.openedAt),
          isNull(schema.captureSources.smartArchivedAt),
        ),
      ),
  ]);

  const continueItems: ContinueItem[] = continueRows.map((n) => ({
    id: n.id,
    title: n.title,
    snippet: (n.content ?? "").replace(/[#>*_`-]/g, "").trim().slice(0, 120) || null,
    updatedAt: n.updatedAt.toISOString(),
  }));

  const recentSaves: RecentSave[] = recentSaveRows.map((r) => ({
    id: r.id,
    title: r.ogTitle || r.derivedTitle || null,
    url: r.url,
    urlHost: r.urlHost,
    savedAt: (r.bookmarkedAt ?? r.createdAt).toISOString(),
  }));

  const triageCount = triageRows[0]?.value ?? 0;

  return {
    continueItems,
    recentSaves,
    triageCount,
    goneStale: staleRows,
  };
}
