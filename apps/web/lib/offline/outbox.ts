import { openDB } from 'idb';

export type OutboxEntry = {
  opId: string;
  route: string;
  body: unknown;
  attempts: number;
  lastError: string | null;
  status: 'pending' | 'done' | 'failed';
  createdAt: number;
};

const DB_NAME = 'nexalog-outbox';
const STORE = 'entries';

async function db() {
  return openDB(DB_NAME, 1, {
    upgrade(db) { db.createObjectStore(STORE, { keyPath: 'opId' }); },
  });
}

export async function enqueue(entry: Omit<OutboxEntry, 'attempts' | 'lastError' | 'status' | 'createdAt'>): Promise<void> {
  const store = await db();
  await store.put(STORE, { ...entry, attempts: 0, lastError: null, status: 'pending', createdAt: Date.now() });
}

export async function getPending(): Promise<OutboxEntry[]> {
  const store = await db();
  const all = await store.getAll(STORE);
  return all.filter(e => e.status === 'pending');
}

export async function markDone(opId: string): Promise<void> {
  const store = await db();
  const entry = await store.get(STORE, opId);
  if (entry) await store.put(STORE, { ...entry, status: 'done' });
}

export async function markFailed(opId: string, error: string): Promise<void> {
  const store = await db();
  const entry = await store.get(STORE, opId);
  if (!entry) return;
  const attempts = entry.attempts + 1;
  await store.put(STORE, { ...entry, attempts, lastError: error, status: attempts >= 5 ? 'failed' : 'pending' });
}
