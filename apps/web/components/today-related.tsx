// SPDX-License-Identifier: MIT
"use client";

/**
 * Related now — pgvector neighbours of what you were just working on
 * (ADR-0011 lens 3).
 *
 * This used to fetch `/api/queue/related?n=3`, a route that did not exist, and
 * render `null` on failure — so the block was silently absent in production and
 * nothing said so. It now renders through the shared block, which reports
 * loading, a genuine empty, and a failure with its reason, and never omits
 * itself.
 *
 * The fetch contract is unchanged: `{ items: Array<{ id, url, title, host,
 * reason? }> }` from `GET /api/queue/related?n=3`. The route's `note` explains a
 * genuinely empty lens (no recent edits to relate to), which the block prefers
 * over its generic empty label.
 */

import { TodayQueueBlock } from "./today-queue-block";

export function TodayRelated() {
  return (
    <TodayQueueBlock
      label="Related now"
      endpoint="/api/queue/related?n=3"
      emptyLabel="Nothing related surfaced yet — this lens needs a recently edited note to relate to."
    />
  );
}
