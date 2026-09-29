// SPDX-License-Identifier: MIT
"use client";

/**
 * Forgotten — "stuff you saved and never came back to" (ADR-0011 lens 2).
 *
 * This used to fetch `/api/queue/forgotten?n=3`, a route that did not exist, and
 * render `null` on failure — so the block was silently absent in production and
 * nothing said so. It now renders through the shared block, which reports
 * loading, a genuine empty, and a failure with its reason, and never omits
 * itself.
 *
 * The fetch contract is unchanged: `{ items: Array<{ id, url, title, host,
 * reason? }> }` from `GET /api/queue/forgotten?n=3`.
 */

import { TodayQueueBlock } from "./today-queue-block";

export function TodayForgotten() {
  return (
    <TodayQueueBlock
      label="Forgotten"
      endpoint="/api/queue/forgotten?n=3"
      emptyLabel="Nothing has gone stale — you have opened everything you saved."
    />
  );
}
