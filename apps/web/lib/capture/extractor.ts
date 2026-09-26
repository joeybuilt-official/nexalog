// Phase 11 pass 2 — server-side article extraction.
//
// Phase 12 extension: exposes `urlHost(url)` so the paywall fallback flow
// (`lib/capture/find-free-version.ts`) can build `-site:<host>` queries
// without re-parsing URLs in the route layer. Also re-exports
// `PAYWALL_PATTERNS` for testing parity with the cache.
//
// Pipeline: fetch (with sane UA + 8s timeout) → linkedom DOM → @mozilla/readability →
// reading time + paywall heuristic. Output is plain extracted_text (no HTML), the
// reader-mode renderer wraps paragraphs on display so we don't store HTML we'd have
// to sanitize on every read.
//
// Failure modes (we never throw): network error, 4xx/5xx, DNS gone, blocked by UA,
// readability returns null. Each yields a structured ExtractionResult and the caller
// persists exactly what it got.
//
// Constraint: never run in the browser. linkedom is small but still server-only.

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

export interface ExtractionResult {
  ok: boolean;
  status: number;
  text: string | null;
  title: string | null;
  byline: string | null;
  excerpt: string | null;
  paywalled: boolean;
  readMinutes: number | null;
  reason: string;
}

export const PAYWALL_PATTERNS: RegExp[] = [
  /subscribe\s+to\s+continue/i,
  /\bsubscribe\s+now\b/i,
  /\bsign\s+in\s+to\s+continue\b/i,
  /\bbecome\s+a\s+(member|subscriber)\b/i,
  /\byou'?ve?\s+reached\s+your\s+(free|monthly)\s+limit\b/i,
  /\bthis\s+article\s+is\s+for\s+subscribers\b/i,
  /\bregister\s+to\s+keep\s+reading\b/i,
  /metered\s+paywall/i,
];

const UA =
  "Mozilla/5.0 (compatible; NexalogReader/1.0; +https://nexalog.app/bot)";

/** Extract a hostname from a URL, lowercase, no `www.` prefix. */
export function urlHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export async function extractArticle(url: string): Promise<ExtractionResult> {
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
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      text: null,
      title: null,
      byline: null,
      excerpt: null,
      paywalled: false,
      readMinutes: null,
      reason: `fetch-error: ${(err as Error).message}`,
    };
  }

  if (res.status >= 400) {
    return {
      ok: false,
      status: res.status,
      text: null,
      title: null,
      byline: null,
      excerpt: null,
      paywalled: res.status === 401 || res.status === 402 || res.status === 403,
      readMinutes: null,
      reason: `http-${res.status}`,
    };
  }

  const html = await res.text();

  // Paywall sniff before parsing — patterns might appear outside <article>.
  const paywallMatch = PAYWALL_PATTERNS.some((re) => re.test(html));

  let doc: Document;
  try {
    const parsed = parseHTML(html);
    doc = parsed.document as unknown as Document;
  } catch (err) {
    return {
      ok: false,
      status: res.status,
      text: null,
      title: null,
      byline: null,
      excerpt: null,
      paywalled: paywallMatch,
      readMinutes: null,
      reason: `parse-error: ${(err as Error).message}`,
    };
  }

  // Readability mutates the document; fine since we don't reuse it.
  let article: ReturnType<Readability["parse"]>;
  try {
    article = new Readability(doc, {
      charThreshold: 250,
      keepClasses: false,
    }).parse();
  } catch (err) {
    return {
      ok: false,
      status: res.status,
      text: null,
      title: null,
      byline: null,
      excerpt: null,
      paywalled: paywallMatch,
      readMinutes: null,
      reason: `readability-error: ${(err as Error).message}`,
    };
  }

  if (!article || !article.textContent || article.textContent.length < 200) {
    return {
      ok: false,
      status: res.status,
      text: null,
      title: null,
      byline: null,
      excerpt: null,
      paywalled: paywallMatch,
      readMinutes: null,
      reason: "no-readable-content",
    };
  }

  const text = article.textContent.replace(/\s+\n/g, "\n").trim();
  const words = text.split(/\s+/).length;
  const readMinutes = Math.max(1, Math.round(words / 200));

  return {
    ok: true,
    status: res.status,
    text,
    title: article.title ?? null,
    byline: article.byline ?? null,
    excerpt: article.excerpt ?? null,
    paywalled: paywallMatch && words < 400, // short body + paywall pattern = real paywall
    readMinutes,
    reason: "ok",
  };
}
