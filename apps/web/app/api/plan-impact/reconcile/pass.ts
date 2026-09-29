// SPDX-License-Identifier: MIT
/**
 * The plan-impact reconcile pass — the ONE implementation, shared by the route and
 * the operator script.
 *
 * WHY THIS FILE IS NOT UNDER `lib/`
 * ---------------------------------
 * It reads the app's own database (`@/lib/db` → `nexalog.capture_sources`) AND
 * gbrain's (`take_proposals`, through the proposals queue). `apps/web/lib/*` may not
 * import `@/lib/db` — the `web-lib-no-direct-db` architecture rule, baselined at 9
 * warnings, which this change must not widen — so the wiring lives at the edge that
 * is allowed to own IO. It sits beside the route rather than INSIDE it so the route
 * file keeps only transport + auth, and so a CLI can import the pass without pulling
 * `next/headers` in through the route module. Both doors call this one function.
 *
 * THE THREE COLLABORATORS, AND WHICH DATABASE EACH SPEAKS TO
 * ----------------------------------------------------------
 *   1. captures — `nexalog.capture_sources`, in the APP's database (`DATABASE_URL`).
 *   2. projects — the brain's pages, through gbrain's MCP search (read-only).
 *   3. queue    — `take_proposals`, in GBRAIN'S database (`GBRAIN_DATABASE_URL`).
 *
 * Two different Postgres instances are involved and conflating them is the easy
 * mistake: `DATABASE_URL` is not where proposals live, and `GBRAIN_DATABASE_URL` is
 * not where captures live.
 */

import { sql } from "drizzle-orm";

import {
  ReconcilePlanImpact,
  type CaptureReconciliationReader,
  type ReconciliationCapture,
} from "@nexalog/core";
import { GbrainProjectRelevanceIndex } from "@nexalog/adapters";

import { db } from "@/lib/db";
import { getComposition } from "@/composition";
import { getProposalQueue } from "@/lib/proposals/queue";
import {
  clampPlanImpactLimit,
  liveLinkCaptureFilter,
  planImpactCaptureTitle,
  planImpactSince,
  planImpactWindow,
} from "@/lib/plan-impact/lenses";

/** Raw column shape of the capture read below. */
interface CaptureRow extends Record<string, unknown> {
  id: string;
  url: string | null;
  og_title: string | null;
  derived_title: string | null;
  url_host: string | null;
  summary: string | null;
  reader_text: string | null;
  extracted_text: string | null;
}

/**
 * The app-side captures, as `@nexalog/core`'s port declares them.
 *
 * The COALESCE / liveness / ordering clauses come from `@/lib/plan-impact/lenses`,
 * so the window's meaning is asserted in one place and this object owns only the IO.
 */
export const planImpactCaptureReader: CaptureReconciliationReader = {
  async listCapturesSince(input): Promise<ReconciliationCapture[]> {
    const rows = await db.execute<CaptureRow>(sql`
      SELECT nexalog.capture_sources.id,
             nexalog.capture_sources.url,
             nexalog.capture_sources.og_title,
             nexalog.capture_sources.derived_title,
             nexalog.capture_sources.url_host,
             nexalog.capture_sources.summary,
             nexalog.capture_sources.reader_text,
             nexalog.capture_sources.extracted_text
        FROM nexalog.capture_sources
       WHERE ${planImpactWindow(input.since)}
         AND ${liveLinkCaptureFilter()}
       ORDER BY COALESCE(nexalog.capture_sources.bookmarked_at, nexalog.capture_sources.created_at) DESC,
                nexalog.capture_sources.id DESC
       LIMIT ${input.limit}
    `);

    return rows.map((r) => ({
      // The id crosses as the database spells it: a proposal cites it as evidence
      // and a verification greps for it, so it is never reshaped here.
      id: String(r.id),
      url: r.url,
      title: planImpactCaptureTitle(r),
      summary: r.summary,
      excerpt: r.reader_text ?? r.extracted_text ?? null,
    }));
  },
};

export interface ReconcilePlanImpactPassOptions {
  since?: Date;
  limit?: number;
  sourceId?: string;
  /**
   * Injected for tests and for a caller that already holds its own collaborators:
   * a pass can then run with no database and no network.
   */
  overrides?: {
    captures?: CaptureReconciliationReader;
    projects?: ConstructorParameters<typeof ReconcilePlanImpact>[1];
    queue?: ConstructorParameters<typeof ReconcilePlanImpact>[2];
  };
}

export interface ReconcilePlanImpactPassResult {
  /** False when this deployment has no proposal queue to emit into. */
  configured: boolean;
  /** Present only when `configured` is false — a typed reason, never an empty run. */
  reason?: string;
  since: string;
  limit: number;
  scanned: number;
  created: number;
  duplicate: number;
  noProject: number;
  skipped: number;
  proposals: Array<{ id: number; pageSlug: string; captureId: string; cosine: number }>;
}

/**
 * Build the collaborators and run one pass.
 *
 * The queue comes from `getProposalQueue()` — the SAME lazily-built instance the
 * proposals routes use — rather than a second construction here, so a process holds
 * one pooled connection to gbrain's database. (The CLI may inject its own when
 * `GBRAIN_DATABASE_URL` arrives after the process started.)
 *
 * A missing queue is NOT thrown: it is the honest "not configured here" state, the
 * same one the proposals surface reports, and a cron entry must not go red over a
 * deployment that simply has not opted in.
 */
export async function runPlanImpactReconcilePass(
  opts: ReconcilePlanImpactPassOptions = {},
): Promise<ReconcilePlanImpactPassResult> {
  const since = opts.since ?? planImpactSince(new Date());
  const limit = clampPlanImpactLimit(opts.limit);

  const queue = opts.overrides?.queue ?? getProposalQueue();
  if (!queue) {
    return {
      configured: false,
      reason:
        "GBRAIN_DATABASE_URL is unset, so there is no proposal queue to emit into. " +
        "The pass did not run and no capture was examined.",
      since: since.toISOString(),
      limit,
      scanned: 0,
      created: 0,
      duplicate: 0,
      noProject: 0,
      skipped: 0,
      proposals: [],
    };
  }

  let projects = opts.overrides?.projects;
  if (!projects) {
    const client = getComposition().gbrain;
    if (!client) {
      // The relevance signal IS the brain's index. Without it there is no claim to
      // make, and reporting "0 relevant captures" would be a fabricated answer —
      // the same rule the queue routes follow for an unconfigured deployment.
      throw new Error(
        "Plan-impact reconciliation needs the brain's search index (set BRAIN_INDEX=gbrain " +
          "and GBRAIN_API_KEY, or GBRAIN_MCP_URL). No project relevance can be measured without it.",
      );
    }
    projects = new GbrainProjectRelevanceIndex({ client });
  }

  const useCase = new ReconcilePlanImpact(
    opts.overrides?.captures ?? planImpactCaptureReader,
    projects,
    queue,
  );

  const result = await useCase.execute({
    since,
    limit,
    sourceId: opts.sourceId ?? "default",
  });

  return { configured: true, since: since.toISOString(), limit, ...result };
}
