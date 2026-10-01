// SPDX-License-Identifier: MIT
/**
 * The proposal queue's wiring: one lazily-built `GbrainProposalQueue` per
 * process, reachable from the route handlers.
 *
 * WHY THIS IS NOT IN `composition.ts`
 * ----------------------------------
 * The composition root wires the BRAIN REPO story (store, index, inbox) and is
 * required — it throws without `BRAIN_REPO`. The proposal queue is a different
 * data plane (gbrain's own Postgres) with its own optionality: an environment
 * without `GBRAIN_DATABASE_URL` must still serve every other surface, and the
 * proposals surface must say "not configured here" rather than take the app
 * down. Keeping it here makes that independence explicit.
 *
 * DEPLOYMENT PREREQUISITE — MET IN PRODUCTION (corrected 2026-10-01)
 * -------------------------------------------------------------------
 * gbrain owns the `take_proposals` table and its MCP surface exposes no
 * adjudication verb, so the only way an operator can drain the queue is a direct
 * connection to gbrain's database. That means the web container must (a) be able
 * to resolve and reach the gbrain Postgres host and (b) receive
 * `GBRAIN_DATABASE_URL`. Both are TRUE of the deployed instance: the web container
 * joined the brain's own Docker network, `GBRAIN_DATABASE_URL` is set, and
 * `gbrain-postgres:5432` resolves from it — so this path is LIVE, and the write
 * half (a promoted take) has been exercised against the real queue.
 *
 * The precondition is still stated, because it is what keeps the honest degrade
 * honest: a standalone install rewired without that route would find
 * `GBRAIN_DATABASE_URL` unset, and every surface here reports exactly that
 * (`503 gbrain_unavailable`, `not_configured`) rather than pretending the queue is
 * empty. That is a real state for other deployments, not this one.
 */

import { GbrainProposalQueue } from "@nexalog/adapters";
import type { ProposalQueue } from "@nexalog/core";

let cached: ProposalQueue | null = null;

/**
 * The queue, or null when this deployment has no gbrain database configured.
 *
 * Null is not an error: it is the honest "this instance cannot adjudicate
 * proposals" state that standalone installs (no gbrain) are legitimately in.
 * Callers turn it into a typed response, never into a silently empty list.
 */
export function getProposalQueue(): ProposalQueue | null {
  if (cached) return cached;

  const url = process.env.GBRAIN_DATABASE_URL;
  if (!url) return null;

  cached = new GbrainProposalQueue({ databaseUrl: url });
  return cached;
}

/** True when this deployment can read and adjudicate the proposal queue. */
export function proposalQueueConfigured(): boolean {
  return Boolean(process.env.GBRAIN_DATABASE_URL);
}
