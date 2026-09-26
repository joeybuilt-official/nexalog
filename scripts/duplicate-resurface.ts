// SPDX-License-Identifier: MIT
/**
 * "Worth re-reading" generator. Runs nightly via cron-dispatch.
 *
 * For each evergreen capture last opened >90d ago whose theme is heating
 * up (theme_growth_14d ≥ 3), emit a `bookmark.worth_rereading` synthesis
 * suggestion. Cap 5 per workspace per week to avoid spam.
 *
 * The brief acknowledges that the new synthesis kind requires a Plexo-side
 * enum migration — out of scope here. We:
 *   - persist the marker to `capture_sources.metadata.worth_rereading`
 *     (so the UI can surface even before Plexo's enum lands), AND
 *   - publish an `ext.nexalog.bookmark.worth_rereading` event to Plexo
 *     so that side can react when ready.
 *
 * Usage:
 *   pnpm tsx scripts/duplicate-resurface.ts                     # apply
 *   pnpm tsx scripts/duplicate-resurface.ts --workspace=<uuid>  # one ws
 *   pnpm tsx scripts/duplicate-resurface.ts --dry               # report only
 */

import { db, schema } from "../lib/db";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { plexoPublishEvent, plexoEnsureWorkspace } from "../lib/plexo";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const HEATING_UP_GROWTH = 3;
const PER_WORKSPACE_WEEKLY_CAP = 5;

interface RunOpts {
  dry: boolean;
  workspaceId: string | null;
}

function parseArgs(): RunOpts {
  const argv = process.argv.slice(2);
  const dry = argv.includes("--dry") || argv.includes("--dry-run");
  const wsArg = argv.find((a) => a.startsWith("--workspace="));
  const workspaceId = wsArg ? wsArg.split("=", 2)[1] : null;
  return { dry, workspaceId };
}

interface SuggestionEmit {
  captureId: string;
  themeId: string;
  themeLabel: string | null;
  lastOpenedAt: string | null;
  growth14d: number;
}

async function listWorkspaces(): Promise<string[]> {
  const rows = await db.execute<{ workspace_id: string }>(sql`
    SELECT DISTINCT workspace_id::text AS workspace_id
    FROM nexalog.capture_sources
    WHERE evergreen = true
  `);
  return (rows as unknown as Array<{ workspace_id: string }>).map((r) => r.workspace_id);
}

async function processWorkspace(workspaceId: string, dry: boolean): Promise<{
  workspaceId: string;
  candidates: number;
  emitted: number;
  cappedAt: number;
  sample: SuggestionEmit[];
}> {
  const cutoff = new Date(Date.now() - NINETY_DAYS_MS);
  const fourteenDaysAgo = new Date(Date.now() - FOURTEEN_DAYS_MS);

  // Theme growth (last 14d). Quick + deterministic.
  const growthRows = await db.execute<{ theme_id: string; cnt: string }>(sql`
    SELECT theme_id, COUNT(*)::text AS cnt
    FROM nexalog.capture_sources
    WHERE workspace_id = ${workspaceId}::uuid
      AND theme_id IS NOT NULL
      AND created_at >= ${fourteenDaysAgo.toISOString()}
    GROUP BY theme_id
  `);
  const growth = new Map<string, number>();
  for (const r of growthRows as unknown as Array<{ theme_id: string; cnt: string }>) {
    growth.set(r.theme_id, Number(r.cnt) || 0);
  }

  // Already-emitted-this-week guard via metadata.worth_rereading.emitted_at.
  const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
  const recentEmissionsRow = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
    FROM nexalog.capture_sources
    WHERE workspace_id = ${workspaceId}::uuid
      AND (metadata->'worth_rereading'->>'emitted_at') >= ${sevenDaysAgo}
  `);
  const recentEmittedThisWeek = Number(
    (recentEmissionsRow as unknown as Array<{ count: string }>)[0]?.count ?? 0,
  );
  const remainingCap = Math.max(0, PER_WORKSPACE_WEEKLY_CAP - recentEmittedThisWeek);

  // Candidates.
  const candidates = await db
    .select({
      id: schema.captureSources.id,
      themeId: schema.captureSources.themeId,
      themeLabel: schema.captureSources.themeLabel,
      lastOpenedAt: schema.captureSources.lastOpenedAt,
      url: schema.captureSources.url,
      ogTitle: schema.captureSources.ogTitle,
      userId: schema.captureSources.userId,
    })
    .from(schema.captureSources)
    .where(
      and(
        eq(schema.captureSources.workspaceId, workspaceId),
        eq(schema.captureSources.evergreen, true),
        isNotNull(schema.captureSources.themeId),
        isNotNull(schema.captureSources.url),
        isNull(schema.captureSources.smartArchivedAt),
        // last_opened_at < 90d ago — covers both "opened long ago" and "never opened"
        // (we OR the never-opened branch in via lastOpenedAt IS NULL).
      ),
    );

  const eligible = candidates
    .filter((c) => {
      if (!c.themeId) return false;
      const g = growth.get(c.themeId) ?? 0;
      if (g < HEATING_UP_GROWTH) return false;
      if (c.lastOpenedAt && c.lastOpenedAt > cutoff) return false;
      return true;
    })
    .map((c) => ({
      capture: c,
      growth14d: growth.get(c.themeId!) ?? 0,
    }))
    // Highest-growth themes first.
    .sort((a, b) => b.growth14d - a.growth14d);

  const toEmit = eligible.slice(0, remainingCap);
  const sample: SuggestionEmit[] = toEmit.map((e) => ({
    captureId: e.capture.id,
    themeId: e.capture.themeId!,
    themeLabel: e.capture.themeLabel,
    lastOpenedAt: e.capture.lastOpenedAt?.toISOString() ?? null,
    growth14d: e.growth14d,
  }));

  if (dry) {
    return {
      workspaceId,
      candidates: eligible.length,
      emitted: 0,
      cappedAt: remainingCap,
      sample,
    };
  }

  let emitted = 0;
  let plexoWs: string | null = null;
  for (const item of toEmit) {
    try {
      // Stamp metadata so subsequent runs respect the weekly cap.
      const existing = await db
        .select({ metadata: schema.captureSources.metadata })
        .from(schema.captureSources)
        .where(eq(schema.captureSources.id, item.capture.id))
        .limit(1);
      const meta = (existing[0]?.metadata ?? {}) as Record<string, unknown>;
      const updated = {
        ...meta,
        worth_rereading: {
          emitted_at: new Date().toISOString(),
          theme_id: item.capture.themeId,
          theme_label: item.capture.themeLabel,
          growth_14d: item.growth14d,
          last_opened_at: item.capture.lastOpenedAt?.toISOString() ?? null,
        },
      };
      await db
        .update(schema.captureSources)
        .set({ metadata: updated })
        .where(eq(schema.captureSources.id, item.capture.id));

      // Best-effort Plexo event so synthesis can pick this up once the
      // `bookmark.worth_rereading` enum lands plexo-side.
      if (!plexoWs) {
        try {
          plexoWs = await plexoEnsureWorkspace(item.capture.userId);
        } catch {
          plexoWs = null;
        }
      }
      if (plexoWs) {
        plexoPublishEvent(
          "ext.nexalog.bookmark.worth_rereading",
          {
            nexalogCaptureId: item.capture.id,
            themeId: item.capture.themeId,
            themeLabel: item.capture.themeLabel,
            growth14d: item.growth14d,
            lastOpenedAt: item.capture.lastOpenedAt?.toISOString() ?? null,
            url: item.capture.url,
            title: item.capture.ogTitle,
          },
          plexoWs,
        ).catch(() => null);
      }
      emitted++;
    } catch (err) {
      console.error("worth_rereading emit failed", item.capture.id, err);
    }
  }

  return {
    workspaceId,
    candidates: eligible.length,
    emitted,
    cappedAt: remainingCap,
    sample,
  };
}

async function main(): Promise<void> {
  const opts = parseArgs();
  const targets = opts.workspaceId ? [opts.workspaceId] : await listWorkspaces();
  if (!targets.length) {
    console.log("No workspaces with evergreen captures.");
    return;
  }

  let totalCandidates = 0;
  let totalEmitted = 0;
  for (const ws of targets) {
    const r = await processWorkspace(ws, opts.dry);
    totalCandidates += r.candidates;
    totalEmitted += r.emitted;
    console.log(
      `[${ws}] candidates=${r.candidates} emitted=${r.emitted} cap=${r.cappedAt} dry=${opts.dry}`,
    );
    for (const s of r.sample.slice(0, 5)) {
      console.log(`  resurface: ${s.captureId} (theme=${s.themeLabel ?? s.themeId}, g14d=${s.growth14d})`);
    }
  }
  console.log(`\nTotals: candidates=${totalCandidates} emitted=${totalEmitted} dry=${opts.dry}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
