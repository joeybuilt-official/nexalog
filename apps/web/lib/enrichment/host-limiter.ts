// SPDX-License-Identifier: MIT
/**
 * Per-host politeness limiter.
 *
 * The enrichment worker must not flood a single domain. We enforce a
 * minimum gap (default 2s) between fetches to the same host. State is
 * in-process (Map): one Next.js server instance, one limiter. Crossing
 * processes is fine — each process fetches at the limit, doubling
 * concurrency once across two replicas, which we accept (operator-set
 * deploy footprint, never more than 2-3 replicas).
 */
const DEFAULT_GAP_MS = 2_000;
const lastFetchByHost = new Map<string, number>();

export async function awaitHost(
  host: string,
  gapMs: number = DEFAULT_GAP_MS,
): Promise<void> {
  if (!host) return;
  const now = Date.now();
  const last = lastFetchByHost.get(host) ?? 0;
  const wait = last + gapMs - now;
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  lastFetchByHost.set(host, Date.now());
}

/**
 * For tests: clear all rate-limit state. No-op in prod paths.
 */
export function resetHostLimiter(): void {
  lastFetchByHost.clear();
}
