/**
 * URL preview metadata + screenshot fallback for Nexalog bookmarks.
 *
 * Resolves title, description, and image for a URL with this priority:
 *   1. og:* meta tags
 *   2. twitter:* meta tags
 *   3. <title> + <link rel="apple-touch-icon">
 *   4. Microlink screenshot API (free tier: 50/day per IP)
 *
 * The screenshot fallback ensures bookmarks always render with a visual,
 * even on sites that ship no OG metadata (ikea, brainvolt, JS-only SPAs).
 */

import { decodeEntities } from "./decode-entities";

const FETCH_TIMEOUT_MS = 6_000;
const SCREENSHOT_TIMEOUT_MS = 15_000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; NexalogBookmarkBot/1.0; +https://nexalog.com)";

export interface UrlPreview {
  title: string | null;
  description: string | null;
  image: string | null;
  favicon: string | null;
}

function metaProperty(html: string, property: string): string | null {
  const a = html.match(
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, "i")
  );
  if (a?.[1]) return a[1];
  const b = html.match(
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, "i")
  );
  return b?.[1] ?? null;
}

function metaName(html: string, name: string): string | null {
  const a = html.match(
    new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, "i")
  );
  if (a?.[1]) return a[1];
  const b = html.match(
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, "i")
  );
  return b?.[1] ?? null;
}

function linkRel(html: string, rel: string): string | null {
  const a = html.match(
    new RegExp(`<link[^>]+rel=["'][^"']*${rel}[^"']*["'][^>]+href=["']([^"']+)["']`, "i")
  );
  if (a?.[1]) return a[1];
  const b = html.match(
    new RegExp(`<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*${rel}[^"']*["']`, "i")
  );
  return b?.[1] ?? null;
}

function absolutize(maybeRelative: string | null, base: string): string | null {
  if (!maybeRelative) return null;
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return null;
  }
}

function youtubeThumbnail(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtube\.com\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` : null;
}


async function microlinkScreenshot(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCREENSHOT_TIMEOUT_MS);
  try {
    const apiUrl = `https://api.microlink.io/?url=${encodeURIComponent(url)}&screenshot=true&meta=false&embed=screenshot.url`;
    const res = await fetch(apiUrl, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (ct.startsWith("image/")) {
      return apiUrl;
    }
    const data = (await res.json()) as { data?: { screenshot?: { url?: string } } };
    return data.data?.screenshot?.url ?? null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export async function fetchUrlPreview(rawUrl: string): Promise<UrlPreview | null> {
  let url: string;
  try {
    url = new URL(rawUrl).toString();
  } catch {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let html = "";
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    clearTimeout(timer);
    if (res.ok) {
      html = await res.text();
    }
  } catch {
    clearTimeout(timer);
  }

  let title: string | null = null;
  let description: string | null = null;
  let image: string | null = null;
  let favicon: string | null = null;

  if (html) {
    title =
      metaProperty(html, "og:title") ??
      metaName(html, "twitter:title") ??
      html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ??
      null;

    description =
      metaProperty(html, "og:description") ??
      metaName(html, "twitter:description") ??
      metaName(html, "description") ??
      null;

    image =
      metaProperty(html, "og:image") ??
      metaProperty(html, "og:image:secure_url") ??
      metaName(html, "twitter:image") ??
      metaName(html, "twitter:image:src") ??
      linkRel(html, "apple-touch-icon") ??
      null;
    image = absolutize(image, url);

    favicon =
      absolutize(linkRel(html, "icon"), url) ??
      absolutize(linkRel(html, "shortcut icon"), url) ??
      `https://${new URL(url).hostname}/favicon.ico`;
  } else {
    favicon = `https://${new URL(url).hostname}/favicon.ico`;
  }

  if (!image) {
    image = youtubeThumbnail(url);
    if (!image) image = await microlinkScreenshot(url);
  }

  // D.1 hygiene: decode HTML entities + NFC-normalize before persisting,
  // so Cyrillic / Telegram-export bookmarks land clean.
  const cleanTitle = title ? decodeEntities(title).normalize("NFC").trim() : null;
  const cleanDescription = description ? decodeEntities(description).normalize("NFC").trim() : null;

  return { title: cleanTitle, description: cleanDescription, image, favicon };
}
