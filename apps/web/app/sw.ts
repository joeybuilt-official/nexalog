/**
 * Service worker — offline capture queue (Phase 1 acceptance).
 *
 * Intercepts fetch to /api/capture; if the network is down, the request body is
 * queued in IndexedDB and replayed on reconnect. This is the PWA offline queue
 * from plan §1.8 / pre-mortem #4.
 */

/// <reference lib="webworker" />

// The WebWorker lib types `self` as WorkerGlobalScope; service-worker-specific
// members (skipWaiting, clients) live on ServiceWorkerGlobalScope.
const sw = self as unknown as ServiceWorkerGlobalScope;

const QUEUE_DB = "nexalog-outbox";
const QUEUE_STORE = "captures";

interface QueuedRequest {
  id: string;
  url: string;
  method: string;
  body: ArrayBuffer;
  headers: Record<string, string>;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(QUEUE_DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(QUEUE_STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function enqueue(req: Request): Promise<void> {
  const db = await openDb();
  const body = await req.clone().arrayBuffer();
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => (headers[k] = v));
  const item: QueuedRequest = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    url: req.url,
    method: req.method,
    body,
    headers,
  };
  await new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    tx.objectStore(QUEUE_STORE).put(item);
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
}

async function drainQueue(): Promise<void> {
  const db = await openDb();
  const items = await new Promise<QueuedRequest[]>((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readonly");
    const req = tx.objectStore(QUEUE_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  for (const item of items) {
    try {
      await fetch(item.url, {
        method: item.method,
        headers: item.headers,
        body: item.body,
      });
      const tx = db.transaction(QUEUE_STORE, "readwrite");
      tx.objectStore(QUEUE_STORE).delete(item.id);
    } catch {
      break; // still offline; retry later
    }
  }
}

 sw.addEventListener("install", () => {
  sw.skipWaiting();
});

 sw.addEventListener("activate", () => {
  sw.clients.claim();
});

 sw.addEventListener("fetch", (event: FetchEvent) => {
  const url = new URL(event.request.url);
  if (event.request.method === "POST" && url.pathname === "/api/capture") {
    event.respondWith(
      fetch(event.request.clone()).catch(async () => {
        await enqueue(event.request);
        return new Response(JSON.stringify({ ok: true, queued: true }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
  }
});

 sw.addEventListener("online", () => {
  drainQueue();
});
