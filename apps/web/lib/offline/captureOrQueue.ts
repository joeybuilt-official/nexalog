import { enqueue } from './outbox';
import { drainOutbox } from './drain';

export async function captureOrQueue(body: unknown): Promise<{ queued: boolean }> {
  if (!navigator.onLine) {
    await enqueue({ opId: crypto.randomUUID(), route: '/api/capture', body });
    return { queued: true };
  }
  const res = await fetch('/api/capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  await drainOutbox();
  return { queued: false };
}
