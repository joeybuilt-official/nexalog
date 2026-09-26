/**
 * URL canonicalization for Nexalog bookmarks.
 *
 * Goal: make `https://littlebird.ai/?utm_source=facebook&...` and
 * `https://Littlebird.AI` collapse to the same canonical form so dedup works.
 *
 * Rules:
 *   - lowercase scheme + host
 *   - strip default ports (:80 on http, :443 on https)
 *   - drop tracking query params (utm_*, fbclid, gclid, hsa_*, mc_cid, etc.)
 *   - sort remaining query params (so order doesn't change the canonical)
 *   - drop fragment (#anchor) — bookmarks are page-level
 *   - normalize trailing slash on path (root keeps /, others lose it)
 */

const TRACKING_PARAM_PREFIXES = [
  "utm_",
  "hsa_",
  "ga_",
  "fb_",
  "twclid",
  "gbraid",
  "wbraid",
];

const TRACKING_PARAM_EXACT = new Set([
  "fbclid",
  "gclid",
  "gclsrc",
  "dclid",
  "msclkid",
  "yclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
  "ref_url",
  "referrer",
  "_ga",
  "_gl",
  "vero_id",
  "vero_conv",
  "ck_subscriber_id",
  "campaign_id",
  "ad_id",
  "adsetid",
  "campaignid",
  "tid",
  "scid",
  "trk",
  "trk_contact",
  "trk_msg",
  "trk_module",
]);

function isTrackingParam(key: string): boolean {
  const lower = key.toLowerCase();
  if (TRACKING_PARAM_EXACT.has(lower)) return true;
  for (const prefix of TRACKING_PARAM_PREFIXES) {
    if (lower.startsWith(prefix)) return true;
  }
  return false;
}

export function normalizeUrl(raw: string): string | null {
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();

  if (
    (parsed.protocol === "http:" && parsed.port === "80") ||
    (parsed.protocol === "https:" && parsed.port === "443")
  ) {
    parsed.port = "";
  }

  parsed.hash = "";

  // Filter + sort query params
  const filtered: Array<[string, string]> = [];
  for (const [k, v] of parsed.searchParams.entries()) {
    if (!isTrackingParam(k)) filtered.push([k, v]);
  }
  filtered.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  // Rebuild search string deterministically
  const params = new URLSearchParams();
  for (const [k, v] of filtered) params.append(k, v);
  parsed.search = params.toString() ? `?${params.toString()}` : "";

  // Path: strip trailing slash unless it's the root
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }

  return parsed.toString();
}

/**
 * Pick the row to keep when collapsing duplicates: most non-null preview
 * fields wins, ties broken by most-recently-created.
 */
export function bookmarkScore(row: {
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  faviconUrl: string | null;
}): number {
  let s = 0;
  if (row.ogTitle) s += 2;
  if (row.ogDescription) s += 1;
  if (row.ogImage) s += 3;
  if (row.faviconUrl) s += 1;
  return s;
}
