// SPDX-License-Identifier: MIT
/**
 * POST /api/plan-impact/reconcile — run one plan-impact reconcile pass.
 *
 * WHY THIS IS A ROUTE AND NOT ONLY A SCRIPT
 * -----------------------------------------
 * The reconciler has to run on a schedule, and a schedule needs an address. This is
 * the schedulable form: a cron entry POSTs it, an operator can trigger it by hand,
 * and the result is a JSON document rather than scrollback. The manual/development
 * entry point remains `apps/web/scripts/reconcile-plan-impact.ts`. BOTH call
 * `runPlanImpactReconcilePass` in `./pass.ts` — one implementation, two doors; this
 * file owns only transport, auth and error mapping.
 *
 * AUTH
 * ----
 * `X-Cron-Secret` against `CRON_SECRET` (the contract the middleware already
 * documents for `/api/cron/*`; this route is not under that prefix, so it validates
 * here), or the operator's own session. With no `CRON_SECRET` configured the route
 * REFUSES anonymous callers rather than running open — a schedule endpoint that
 * becomes world-executable because an env var is missing is worse than one that
 * 401s.
 *
 * A NO-OP IS NOT AN ERROR
 * -----------------------
 * Zero captures in the window, and an unconfigured queue, both return 200 with the
 * counts. A cron entry that goes red because there was nothing to do is an entry
 * people learn to ignore.
 */

export const dynamic = "force-dynamic";

import { timingSafeEqual } from "node:crypto";

import { getAuthUser } from "@/lib/auth/server";
import { logEvent } from "@/lib/logger";
import { clampPlanImpactLimit, planImpactSince } from "@/lib/plan-impact/lenses";
import { runPlanImpactReconcilePass } from "./pass";

/**
 * Constant-time comparison of the schedule secret.
 *
 * Lengths are compared FIRST because `timingSafeEqual` throws on a length mismatch —
 * an exception would leak the same information the constant-time compare exists to
 * hide, and it would surface as a 500 instead of a 401.
 */
function cronSecretMatches(provided: string | null): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const provided = request.headers.get("x-cron-secret");

  // Two doors: a scheduler's shared secret, or an operator's own session. The
  // session path is what makes this usable from the app without handing out a
  // secret, and it is validated by the same `getAuthUser` every route uses.
  let authorized = cronSecretMatches(provided);
  if (!authorized) {
    const user = await getAuthUser();
    authorized = Boolean(user);
  }

  if (!authorized) {
    const configured = Boolean(process.env.CRON_SECRET);
    logEvent("plan_impact.reconcile.unauthorized", { secretConfigured: configured });
    return Response.json(
      {
        error: "unauthorized",
        message: configured
          ? "Send the schedule's X-Cron-Secret header, or call this from a signed-in session."
          : "This deployment has no CRON_SECRET configured, so only a signed-in session may run the reconcile pass.",
      },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const hours = Math.max(1, Math.min(24 * 30, Number(url.searchParams.get("hours")) || 24));
  const limit = clampPlanImpactLimit(url.searchParams.get("limit"));

  logEvent("plan_impact.reconcile.start", { hours, limit });

  try {
    const result = await runPlanImpactReconcilePass({
      since: planImpactSince(new Date(), hours),
      limit,
    });
    logEvent("plan_impact.reconcile.done", {
      configured: result.configured,
      scanned: result.scanned,
      created: result.created,
      duplicate: result.duplicate,
      noProject: result.noProject,
      skipped: result.skipped,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "reconcile failed";
    logEvent("plan_impact.reconcile.failed", { error: message });
    // 503, not 500: the overwhelmingly likely cause is the brain being unreachable,
    // and the caller's correct action is to retry later, not to fix its request.
    return Response.json(
      { error: "brain_unavailable", message },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
