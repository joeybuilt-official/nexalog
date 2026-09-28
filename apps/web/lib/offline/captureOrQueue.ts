// SPDX-License-Identifier: MIT
/**
 * Capture-or-queue — the one client-side write path for the intake surfaces
 * (Add Bookmark, the PWA share target, the quick-capture modal).
 *
 * `POST /api/capture` speaks **multipart/form-data** (`request.formData()` in
 * `app/api/capture/route.ts`), reading `text`, `url`, `file*` and `source`.
 * This helper used to post `JSON.stringify(body)` with a JSON content type,
 * which makes `formData()` throw before the route can read a single field —
 * every mounted client (bookmarks, share, quick capture) therefore failed with
 * a 400 and the user saw "Network error — your capture wasn't saved".
 *
 * Routing, and why a URL takes a different door: a saved link belongs in the
 * BOOKMARK model (`POST /api/bookmarks`, JSON) so it is classified at write
 * time and gets OG/reader enrichment plus the reader page — exactly like a
 * link saved any other way. Pushing it through the note intake is what made a
 * saved link a note instead of a bookmark.
 *
 * Accepted shapes:
 *   - `{ kind: "url", content: <url> }`  → JSON `POST /api/bookmarks`;
 *   - `{ kind: <other>, content: <text> }` → multipart `POST /api/capture`;
 *   - `FormData` → passed through untouched (any caller that already built a
 *     form; voice memos and attachments).
 *
 * Offline: the outbox persists the request body (FormData survives idb), and
 * `drainOutbox` replays it against the recorded route.
 */

import { enqueue } from './outbox';
import { drainOutbox } from './drain';

export type CaptureRequest =
  | {
      kind: string;
      content: string;
      url?: string;
      workspaceId?: string;
    }
  | FormData;

/** `/api/bookmarks` is the JSON bookmark route; everything else is multipart. */
export function routeForCapture(body: CaptureRequest): string {
  if (body instanceof FormData) return '/api/capture';
  return body.kind === 'url' ? '/api/bookmarks' : '/api/capture';
}

/**
 * The on-the-wire body plus the headers that must accompany it. A FormData
 * body must NOT carry a hand-written Content-Type — the browser has to set it
 * so the multipart boundary matches; a JSON body must carry `application/json`.
 */
export function wireRequest(body: CaptureRequest): {
  body: BodyInit;
  headers?: Record<string, string>;
} {
  if (body instanceof FormData) return { body };

  if (body.kind === 'url') {
    return {
      body: JSON.stringify({
        url: body.url ?? body.content,
        ...(body.workspaceId ? { workspaceId: body.workspaceId } : {}),
      }),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  const form = new FormData();
  form.append('text', body.content);
  if (body.url) form.append('url', body.url);
  return { body: form };
}

export async function captureOrQueue(body: CaptureRequest): Promise<{ queued: boolean }> {
  const route = routeForCapture(body);

  if (!navigator.onLine) {
    await enqueue({ opId: crypto.randomUUID(), route, body });
    return { queued: true };
  }

  const wire = wireRequest(body);
  const res = await fetch(route, {
    method: 'POST',
    ...(wire.headers ? { headers: wire.headers } : {}),
    body: wire.body,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  await drainOutbox();
  return { queued: false };
}
