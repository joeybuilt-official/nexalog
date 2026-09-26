// SPDX-License-Identifier: MIT
/**
 * Backfill script — runs the v1 enrichment pipeline against every existing
 * capture row whose state columns are still 'pending' (or 'failed' with
 * fewer than 5 attempts). Resumable: state columns track progress, so
 * re-running picks up where it left off.
 *
 * Stages, in order:
 *   1. metadata  — fetch OG/oEmbed/canonical, populate v1 columns
 *   2. reader    — Readability extraction (skips homepage/social/video)
 *   3. summary   — Plexo Jex 2-sentence neutral summary
 *
 * Per-host politeness applied via the metadata worker's awaitHost limiter.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-enrichment.ts                 # full run
 *   pnpm tsx scripts/backfill-enrichment.ts --stage=metadata  # one stage
 *   pnpm tsx scripts/backfill-enrichment.ts --workspace=<uuid>
 *   pnpm tsx scripts/backfill-enrichment.ts --limit=200
 *
 * Notes:
 *   - This script is intended to run against a LOCAL database in dev. To
 *     run against production, route via the cron endpoint instead — see
 *     POST /api/cron/enrichment with X-Cron-Secret.
 *   - Output is line-buffered JSON-ish; pipe to `jq` for quick scanning.
 */

import { runMetadataBatch } from "../lib/enrichment/metadata";
import { runReaderBatch } from "../lib/enrichment/reader";
import { runSummaryBatch } from "../lib/enrichment/summary";
import { runEmbedBatch, runClusterPass } from "../lib/enrichment/embeddings";

interface Args {
  stage: "all" | "metadata" | "reader" | "summary" | "embed" | "cluster";
  workspaceId: string | undefined;
  limit: number;
  loops: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    stage: "all",
    workspaceId: undefined,
    limit: 100,
    loops: 50,
  };
  for (const raw of argv.slice(2)) {
    if (raw.startsWith("--stage=")) {
      const v = raw.slice("--stage=".length);
      if (
        v === "all" ||
        v === "metadata" ||
        v === "reader" ||
        v === "summary" ||
        v === "embed" ||
        v === "cluster"
      ) {
        args.stage = v;
      }
    } else if (raw.startsWith("--workspace=")) {
      args.workspaceId = raw.slice("--workspace=".length);
    } else if (raw.startsWith("--limit=")) {
      const n = Number(raw.slice("--limit=".length));
      if (Number.isFinite(n) && n > 0) args.limit = n;
    } else if (raw.startsWith("--loops=")) {
      const n = Number(raw.slice("--loops=".length));
      if (Number.isFinite(n) && n > 0) args.loops = n;
    }
  }
  return args;
}

async function runStage(stage: Args["stage"], opts: { limit: number; workspaceId?: string }): Promise<{ scanned: number; ok: number; failed: number }> {
  if (stage === "metadata") {
    const r = await runMetadataBatch(opts);
    return { scanned: r.scanned, ok: r.enriched, failed: r.failed };
  }
  if (stage === "reader") {
    const r = await runReaderBatch(opts);
    return { scanned: r.scanned, ok: r.ready, failed: r.failed };
  }
  if (stage === "summary") {
    const r = await runSummaryBatch(opts);
    return { scanned: r.scanned, ok: r.ready, failed: r.failed };
  }
  if (stage === "embed") {
    const r = await runEmbedBatch(opts);
    return { scanned: r.scanned, ok: r.ready, failed: r.failed };
  }
  if (stage === "cluster") {
    const r = await runClusterPass();
    return {
      scanned: r.workspacesScanned,
      ok: r.workspacesClustered,
      failed: 0,
    };
  }
  return { scanned: 0, ok: 0, failed: 0 };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  console.log(JSON.stringify({ event: "backfill-start", args }));

  const stages: Args["stage"][] =
    args.stage === "all"
      ? ["metadata", "reader", "summary", "embed", "cluster"]
      : [args.stage];

  for (const stage of stages) {
    let totalScanned = 0;
    let totalOk = 0;
    let totalFailed = 0;
    for (let i = 0; i < args.loops; i++) {
      const result = await runStage(stage, {
        limit: args.limit,
        workspaceId: args.workspaceId,
      });
      totalScanned += result.scanned;
      totalOk += result.ok;
      totalFailed += result.failed;
      console.log(
        JSON.stringify({
          event: "stage-loop",
          stage,
          loop: i,
          ...result,
        }),
      );
      if (result.scanned === 0) break;
    }
    console.log(
      JSON.stringify({
        event: "stage-done",
        stage,
        scanned: totalScanned,
        ok: totalOk,
        failed: totalFailed,
      }),
    );
  }

  console.log(JSON.stringify({ event: "backfill-done" }));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
