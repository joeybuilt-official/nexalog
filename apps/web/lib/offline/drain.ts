// SPDX-License-Identifier: MIT
/**
 * Outbox drain — replay queued captures when the network returns.
 *
 * Two body shapes live in the outbox and they need different headers: a
 * `FormData` body must go out with the browser's own multipart Content-Type
 * (hand-writing one breaks the boundary, and `request.formData()` then throws
 * server-side), while the JSON routes need `application/json`. The entry's
 * `route` decides, so a replayed request is byte-for-byte the request the
 * client would have sent online.
 */

import { getPending, markDone, markFailed } from './outbox';

export async function drainOutbox(): Promise<void> {
  const pending = await getPending();
  for (const entry of pending) {
    try {
      const isForm = entry.body instanceof FormData;
      const res = await fetch(entry.route, {
        method: 'POST',
        headers: {
          ...(isForm ? {} : { 'Content-Type': 'application/json' }),
          'Idempotency-Key': entry.opId,
        },
        body: isForm
          ? (entry.body as FormData)
          : JSON.stringify(entry.body),
      });
      if (res.ok) await markDone(entry.opId);
      else await markFailed(entry.opId, `HTTP ${res.status}`);
    } catch (e) {
      await markFailed(entry.opId, String(e));
    }
  }
}
