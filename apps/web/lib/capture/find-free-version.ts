// SPDX-License-Identifier: MIT
/**
 * Paywall fallback search.
 *
 * For a paywalled capture, look up alternative public copies (mostly via
 * archive.org / web.archive.org / open-web mirrors) and return the top 3.
 *
 * Provider:
 *   - Brave Search (`api.search.brave.com/res/v1/web/search`).
 *
 *   We'd prefer to call a Plexo-side `/api/v1/search/web` endpoint so the
 *   key + rate-limit live in one place, but Plexo only exposes settings +
 *   test routes today (see `apps/api/src/routes/search.ts`). If/when a
 *   producer endpoint lands, swap the implementation here — the public
 *   `findFreeVersion` signature is provider-agnostic.
 *
 * Key resolution:
 *   1. `BRAVE_SEARCH_API_KEY` env var (admin-configured fallback that Plexo
 *      itself uses). If missing, returns an empty result with a `no_key`
 *      reason so the caller can hide the button gracefully.
 */

const BRAVE_API = "https://api.search.brave.com/res/v1/web/search";
const UA = "Mozilla/5.0 (compatible; NexalogReader/1.0; +https://nexalog.app/bot)";

export interface FreeVersion {
  url: string;
  title: string;
  snippet: string | null;
  source: "archive.org" | "web.archive.org" | "other";
  age: string | null;
}

export interface FindFreeVersionResult {
  ok: boolean;
  reason: string; // 'ok' | 'no_key' | 'no_results' | 'fetch-error: …'
  versions: FreeVersion[];
}

interface FindOpts {
  ogTitle: string | null;
  paywalledHost: string | null;
}

export async function findFreeVersion(
  opts: FindOpts,
  apiKey: string | null = process.env.BRAVE_SEARCH_API_KEY ?? null,
): Promise<FindFreeVersionResult> {
  if (!apiKey) {
    return { ok: false, reason: "no_key", versions: [] };
  }
  if (!opts.ogTitle) {
    return { ok: false, reason: "no_title", versions: [] };
  }

  const query = buildQuery(opts.ogTitle, opts.paywalledHost);

  let res: Response;
  try {
    const params = new URLSearchParams({ q: query, count: "10" });
    res = await fetch(`${BRAVE_API}?${params}`, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    return {
      ok: false,
      reason: `fetch-error: ${(err as Error).message}`,
      versions: [],
    };
  }

  if (!res.ok) {
    return { ok: false, reason: `http-${res.status}`, versions: [] };
  }

  const data = (await res.json().catch(() => null)) as {
    web?: {
      results?: Array<{
        title?: string;
        url?: string;
        description?: string;
        age?: string;
      }>;
    };
  } | null;

  const results = data?.web?.results ?? [];
  const ranked = rankResults(results, opts.paywalledHost);

  if (ranked.length === 0) {
    return { ok: false, reason: "no_results", versions: [] };
  }

  return { ok: true, reason: "ok", versions: ranked.slice(0, 3) };
}

export function buildQuery(ogTitle: string, paywalledHost: string | null): string {
  // Wrap title in quotes for an exact-phrase match; fold the host out and
  // bias toward archives. The brief calls for:
  //   "<og_title> site:archive.org OR site:web.archive.org OR -site:<host>"
  //
  // Brave/Google interpret `site:` and `-site:` the same way. The OR forms
  // a "find an archived copy OR a copy not on the paywalled host" query.
  const safeTitle = ogTitle.replace(/"/g, "").trim().slice(0, 180);
  const parts = [`"${safeTitle}"`, "site:archive.org OR site:web.archive.org"];
  if (paywalledHost) parts.push(`-site:${paywalledHost}`);
  return parts.join(" ");
}

function rankResults(
  raw: Array<{ title?: string; url?: string; description?: string; age?: string }>,
  paywalledHost: string | null,
): FreeVersion[] {
  const out: FreeVersion[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r.url || !r.title) continue;
    const url = r.url.trim();
    if (seen.has(url)) continue;
    seen.add(url);
    let host = "";
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (paywalledHost && host === paywalledHost.toLowerCase()) continue;
    let source: FreeVersion["source"] = "other";
    if (host === "archive.org" || host.endsWith(".archive.org")) {
      source = host === "web.archive.org" ? "web.archive.org" : "archive.org";
    }
    out.push({
      url,
      title: r.title.trim(),
      snippet: r.description?.trim() ?? null,
      source,
      age: r.age ?? null,
    });
  }
  // Push archive results to the top — that's the operator's stated preference.
  out.sort((a, b) => priority(a.source) - priority(b.source));
  return out;
}

function priority(s: FreeVersion["source"]): number {
  if (s === "web.archive.org") return 0;
  if (s === "archive.org") return 1;
  return 2;
}
