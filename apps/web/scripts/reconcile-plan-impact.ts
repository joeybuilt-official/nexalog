// SPDX-License-Identifier: MIT
/**
 * `reconcile-plan-impact` — run one plan-impact reconcile pass by hand or from cron.
 *
 * WHAT IT DOES
 * ------------
 * Walks captures saved in a window and, for each one that is relevant to an
 * existing project page in the brain's own index, emits ONE `kind = 'plan_change'`
 * proposal into gbrain's `take_proposals` — the queue the operator already reviews
 * at `/app/proposals`. It writes no page, edits no plan, and takes no take.
 *
 * IDEMPOTENT BY CONSTRUCTION
 * --------------------------
 * Every field of the proposal is derived deterministically from the capture, so a
 * second run over the same window produces byte-identical tuples and the queue's own
 * unique index refuses them — the pass reports them as `duplicate` and the pending
 * count does not move. That is what makes this safe to run on a timer: a retry, an
 * overlapping cron invocation, or a manual re-run after a crash cannot double-propose.
 *
 * USAGE (cwd must be `apps/web`; `tsx` is an apps/web devDependency)
 * ------------------------------------------------------------------
 *   DATABASE_URL=…  GBRAIN_DATABASE_URL=…  GBRAIN_API_KEY=…  BRAIN_REPO=… \
 *     npx tsx scripts/reconcile-plan-impact.ts --dry-run
 *   … --execute
 *
 *   --dry-run      (default) prints the plan and writes NOTHING. It still performs
 *                  the reads and the searches, because "would this emit?" is the
 *                  question being asked.
 *   --execute      performs the emits.
 *   --hours N      window (default 24)
 *   --limit N      max captures (default 25, clamped to 200)
 *   --json         machine-readable result on stdout
 *
 * A pass with no `GBRAIN_DATABASE_URL` exits 0 with `configured: false` and the
 * reason — a deployment that has not opted in is not a failure.
 *
 * This script and `POST /api/plan-impact/reconcile` call the SAME
 * `runPlanImpactReconcilePass`; neither has its own construction path.
 */

import { runPlanImpactReconcilePass } from "@/app/api/plan-impact/reconcile/pass";
import { clampPlanImpactLimit, planImpactSince } from "@/lib/plan-impact/lenses";

interface Args {
  execute: boolean;
  hours: number;
  limit: number;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { execute: false, hours: 24, limit: clampPlanImpactLimit(undefined), json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--execute") out.execute = true;
    else if (a === "--dry-run") out.execute = false;
    else if (a === "--json") out.json = true;
    else if (a === "--hours") out.hours = Math.max(1, Number(argv[++i]) || 24);
    else if (a === "--limit") out.limit = clampPlanImpactLimit(argv[++i]);
    else if (a === "--help" || a === "-h") {
      console.log(
        "usage: tsx scripts/reconcile-plan-impact.ts [--dry-run|--execute] [--hours N] [--limit N] [--json]",
      );
      process.exit(0);
    } else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const since = planImpactSince(new Date(), args.hours);

  const result = await runPlanImpactReconcilePass({ since, limit: args.limit });

  if (args.json) {
    console.log(JSON.stringify({ mode: args.execute ? "execute" : "dry-run", ...result }, null, 2));
    return;
  }

  console.log(`plan-impact reconcile — ${args.execute ? "EXECUTE" : "DRY-RUN"}`);
  console.log(`  window   : ${result.since} → now (${args.hours}h)`);
  console.log(`  limit    : ${result.limit}`);

  if (!result.configured) {
    console.log(`  NOT CONFIGURED: ${result.reason}`);
    return;
  }

  console.log(`  scanned  : ${result.scanned} captures`);
  console.log(`  created  : ${result.created}`);
  console.log(`  duplicate: ${result.duplicate} (already proposed — a re-run adds nothing)`);
  console.log(`  no project: ${result.noProject} (nothing above the relevance floor)`);
  console.log(`  skipped  : ${result.skipped} (no usable evidence text)`);

  for (const p of result.proposals) {
    console.log(`  + #${p.id} ${p.pageSlug} ← capture ${p.captureId} (cosine ${p.cosine.toFixed(3)})`);
  }

  if (!args.execute) {
    console.log("\nDRY-RUN: nothing was written. Re-run with --execute to emit these proposals.");
  }
}

main().catch((err) => {
  console.error("plan-impact reconcile failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
