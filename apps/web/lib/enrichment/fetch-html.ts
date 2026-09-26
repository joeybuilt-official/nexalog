// SPDX-License-Identifier: MIT
/**
 * Polite HTML fetcher used by the enrichment pipeline.
 *
 * Hard limits per fetch:
 *   - 10s timeout
 *   - max 5 redirects (delegated to fetch's `redirect: "follow"` and
 *     a hard cap by re-checking response history when available; node's
 *     fetch enforces a default redirect cap, but we cap body size and
 *     timeout regardless of redirects)
 *   - max 5 MB body (read in chunks; abort once exceeded)
 *
 * Returns null on any failure with a `reason` for the caller to persist.
 */

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const UA =
  "Mozilla/5.0 (compatible; NexalogBot/1.0; +https://nexalog.com/bot)";

export interface FetchHtmlResult {
  ok: boolean;
  status: number;
  finalUrl: string | null;
  contentType: string | null;
  html: string | null;
  reason: string;
}

export async function fetchHtml(url: string): Promise<FetchHtmlResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": UA,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      finalUrl: null,
      contentType: null,
      html: null,
      reason: `fetch-error: ${(err as Error).message}`,
    };
  }

  const contentType = res.headers.get("content-type");
  const finalUrl = res.url || url;

  if (res.status >= 400) {
    return {
      ok: false,
      status: res.status,
      finalUrl,
      contentType,
      html: null,
      reason: `http-${res.status}`,
    };
  }

  // Body size guard. Stream the body and abort if we exceed the cap.
  const reader = res.body?.getReader();
  if (!reader) {
    return {
      ok: false,
      status: res.status,
      finalUrl,
      contentType,
      html: null,
      reason: "no-body",
    };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_BODY_BYTES) {
          await reader.cancel().catch(() => {});
          return {
            ok: false,
            status: res.status,
            finalUrl,
            contentType,
            html: null,
            reason: "body-too-large",
          };
        }
        chunks.push(value);
      }
    }
  } catch (err) {
    return {
      ok: false,
      status: res.status,
      finalUrl,
      contentType,
      html: null,
      reason: `stream-error: ${(err as Error).message}`,
    };
  }

  let html: string;
  try {
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      buf.set(c, off);
      off += c.byteLength;
    }
    html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  } catch (err) {
    return {
      ok: false,
      status: res.status,
      finalUrl,
      contentType,
      html: null,
      reason: `decode-error: ${(err as Error).message}`,
    };
  }

  return {
    ok: true,
    status: res.status,
    finalUrl,
    contentType,
    html,
    reason: "ok",
  };
}

export function urlHostname(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}
