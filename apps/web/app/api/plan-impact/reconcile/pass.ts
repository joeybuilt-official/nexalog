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
  PublishProjectBrief,
  BriefPublishError,
  PROJECT_SLUG_PREFIX,
  ReconcilePlanImpact,
  type CaptureReconciliationReader,
  type PublishProjectBriefResult,
  type PublishableBrief,
  type ReconciliationCapture,
} from "@nexalog/core";
import { GbrainProjectRelevanceIndex } from "@nexalog/adapters";

import { db } from "@/lib/db";
import { getComposition } from "@/composition";
import { getProposalQueue } from "@/lib/proposals/queue";
import { getProjectAddress, getProjectNoteTitles } from "@/lib/projects/store";
import {
  PROJECT_TYPE,
  idSegment,
  projectPageSlug,
  projectSlugSegment,
} from "@/lib/projects/publish";
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

// ── publishing a project's BRIEF ────────────────────────────────────────────
//
// The publish pass lives HERE, beside the reconcile pass, for the same reason the
// reconcile pass does: it is the edge that owns IO. Three collaborators, two
// databases:
//
//   1. the project + its linked notes — `nexalog`, in the APP's database;
//   2. the brain's search index      — gbrain, read-only, to resolve the PAGE;
//   3. the proposal queue            — `take_proposals`, in GBRAIN's database.
//
// The pass on the page has already SYNTHESIZED a brief, and that exact brief is
// what gets published: this function never calls a model, so pressing Publish
// twice on one page cannot publish two different texts. What it may do is resolve
// the project's brain page (one read-only search), and that is the only extra work.
//
// The refusals are `@nexalog/core`'s rules, carried out here rather than decided
// here: `BriefPublishError` propagates with its own code so the route maps one
// code to one status.

/**
 * The outcome of a publish, as the route reports it.
 *
 * `created: false` is SUCCESS: the queue already held this exact brief. Reporting
 * it as an error would make the action look unsafe to press twice, which is
 * exactly the property the content hash exists to give.
 */
export interface PublishBriefPassResult {
  duplicate: boolean;
  proposalId: number;
  pageSlug: string;
  modelId: string;
  generatedAt: string;
  contentHash: string;
}

/**
 * Publish one synthesized brief for one project.
 *
 * @param workspaceIds the CALLER's workspaces — the ownership guard, resolved by
 *        the route from the session and never from the request body.
 */
export async function publishProjectBriefPass(input: {
  workspaceIds: string[];
  projectId: string;
  brief: PublishableBrief;
  sourceId?: string;
}): Promise<PublishBriefPassResult> {
  // The refusal happens BEFORE any queue work — a fallback digest is turned away
  // with a typed code and touches nothing.
  if (input.brief.state !== "synthesized") {
    throw new BriefPublishError({
      code: "not_synthesized",
      message:
        "This brief is a mechanical digest of the project's own data rather than a synthesis, " +
        "so it is not published to the brain.",
    });
  }

  const address = await getProjectAddress(input.workspaceIds, input.projectId);
  if (!address) {
    throw new BriefPublishError({
      code: "missing_project",
      message: "No project with that id is visible to you.",
    });
  }

  const queue = getProposalQueue();
  if (!queue) throw new BriefQueueUnavailable();

  const [pageSlug, noteTitles] = await Promise.all([
    resolveProjectPageSlug(address),
    getProjectNoteTitles(input.workspaceIds, input.projectId),
  ]);

  const result: PublishProjectBriefResult = await new PublishProjectBrief(queue).execute({
    brief: input.brief,
    project: {
      id: address.id,
      name: address.name,
      pageSlug,
      sourceId: input.sourceId ?? "default",
    },
    evidenceNoteTitles: noteTitles,
    ...(input.sourceId ? { sourceId: input.sourceId } : {}),
  });

  return {
    duplicate: !result.created,
    proposalId: result.proposalId,
    pageSlug: result.pageSlug,
    modelId: result.modelId,
    generatedAt: result.generatedAt,
    contentHash: result.contentHash,
  };
}

/**
 * Where the project lives in the brain, in three rounds — cheapest and most
 * trustworthy first:
 *
 *   1. the page whose slug IS this project's own id (`projects/<uuid>`), when the
 *      push job has ever recorded one for this project. Asked directly, because
 *      this is a "does this exact page exist" question and no search can answer
 *      it reliably.
 *   2. the page whose slug matches the project's NAME in slug form — the
 *      operator's existing pages are named, and this is what makes publishing
 *      work before any slug column exists. This asks the search for the name and
 *      keeps only a page whose slug matches it exactly, so a high-cosine
 *      NEIGHBOR (the whole project directory is a neighborhood in this brain)
 *      cannot win.
 *   3. otherwise the SYNTHESIZED address from `projectPageSlug`, which is stable
 *      and valid but very likely not a page yet. It is proposed anyway rather
 *      than refused: the proposal is the operator's decision surface, and one
 *      addressed to a page that does not exist yet is readable, rejectable, and
 *      does not silently drop the brief on the floor.
 *
 * A brain that is unreachable does NOT fail the publish: an absent client, a
 * failed lookup and a failed search all fall through to round 3 — the proposal is
 * made with the honest, synthesized address instead of a fabricated match.
 */
async function resolveProjectPageSlug(address: {
  id: string;
  name: string;
  parentName: string | null;
}): Promise<string> {
  const synthesized = projectPageSlug(address);

  const client = getComposition().gbrain;
  if (!client) return synthesized;

  // Round 1 — the id-addressed page, if this project has one.
  const byId = `${PROJECT_SLUG_PREFIX}${idSegment(address.id)}`;
  try {
    const page = await client.getPage(byId);
    if (page && page.slug.trim() !== "") return page.slug.trim();
  } catch {
    // fall through to the name round
  }

  // Round 2 — a page whose slug IS this project's name in slug form.
  const nameSegment = projectSlugSegment(address.name);
  if (nameSegment) {
    const expected = `${PROJECT_SLUG_PREFIX}${nameSegment}`;
    try {
      const hits = await client.search(address.name, { limit: 10, types: [PROJECT_TYPE] });
      const match = hits.find((hit) => hit.slug.toLowerCase() === expected.toLowerCase());
      if (match) return match.slug.trim();
    } catch {
      // fall through to the synthesized address
    }
  }

  return synthesized;
}

/**
 * A typed "no queue here" failure, distinct from a queue error: the route turns
 * it into `503 gbrain_unavailable` with the repo's own `not_configured` code,
 * never into a 500 and never into a fabricated success.
 */
export class BriefQueueUnavailable extends Error {
  readonly code = "not_configured";
  constructor() {
    super(
      "This deployment has no gbrain database configured (GBRAIN_DATABASE_URL is unset), " +
        "so a brief cannot be published here.",
    );
    this.name = "BriefQueueUnavailable";
  }
}

/** The linked-note titles a published brief cites. Title-only; see the store. */
export async function briefEvidenceNoteTitles(
  workspaceIds: string[],
  projectId: string,
): Promise<string[]> {
  return getProjectNoteTitles(workspaceIds, projectId);
}
