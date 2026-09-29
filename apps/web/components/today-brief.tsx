// SPDX-License-Identifier: MIT
"use client";

/**
 * Today's brief — the daily-relevance lens (ADR-0011 lens 1).
 *
 * This used to fetch `/api/queue?n=5`, a route that did not exist, and render
 * `null` on failure — so the block was silently absent in production and nothing
 * said so. It now renders through the shared block, which reports loading, a
 * genuine empty, and a failure with its reason, and never omits itself.
 *
 * The fetch contract is unchanged: `{ items: Array<{ id, url, title, host,
 * reason? }> }` from `GET /api/queue?n=5`.
 */

import { TodayQueueBlock } from "./today-queue-block";

export function TodayBrief() {
  return (
    <TodayQueueBlock
      label="Today's brief"
      endpoint="/api/queue?n=5"
      emptyLabel="Nothing new waiting — everything you saved recently has been opened."
    />
  );
}
