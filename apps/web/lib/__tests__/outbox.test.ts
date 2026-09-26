import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { enqueue, getPending, markDone, markFailed } from '../offline/outbox';

describe('outbox', () => {
  it('enqueue → pending', async () => {
    await enqueue({ opId: 'test-1', route: '/api/capture', body: { url: 'https://example.com' } });
    const pending = await getPending();
    expect(pending.some(e => e.opId === 'test-1')).toBe(true);
  });

  it('markDone removes from pending', async () => {
    await enqueue({ opId: 'test-2', route: '/api/capture', body: {} });
    await markDone('test-2');
    const pending = await getPending();
    expect(pending.some(e => e.opId === 'test-2')).toBe(false);
  });

  it('markFailed 5 times → status failed', async () => {
    await enqueue({ opId: 'test-3', route: '/api/capture', body: {} });
    for (let i = 0; i < 5; i++) await markFailed('test-3', 'err');
    const pending = await getPending();
    expect(pending.some(e => e.opId === 'test-3')).toBe(false);
  });
});
