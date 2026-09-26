import { getPending, markDone, markFailed } from './outbox';

export async function drainOutbox(): Promise<void> {
  const pending = await getPending();
  for (const entry of pending) {
    try {
      const res = await fetch(entry.route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': entry.opId },
        body: JSON.stringify(entry.body),
      });
      if (res.ok) await markDone(entry.opId);
      else await markFailed(entry.opId, `HTTP ${res.status}`);
    } catch (e) {
      await markFailed(entry.opId, String(e));
    }
  }
}
