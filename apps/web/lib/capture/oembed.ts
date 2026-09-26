// SPDX-License-Identifier: MIT
/**
 * YouTube oEmbed helper.
 *
 * Used to derive `watch_minutes` for video captures. YouTube's public
 * oEmbed endpoint returns title/author/thumbnail and an HTML embed
 * snippet — duration is *not* a documented field but sometimes appears
 * inside the iframe HTML or in author_url metadata. We try both:
 *
 *   1. parse a `duration` field if YouTube ever returns one (forward-compat)
 *   2. parse the HTML for ISO-8601 / mm:ss patterns
 *   3. give up — the script that calls this falls back to leaving
 *      watch_minutes NULL rather than guessing.
 *
 * Rate-limit is enforced by the *caller* (the backfill script). This module
 * is dumb and synchronous-feeling.
 */

const OEMBED_BASE = "https://www.youtube.com/oembed";
const UA = "Mozilla/5.0 (compatible; NexalogReader/1.0; +https://nexalog.app/bot)";

export interface OEmbedResult {
  ok: boolean;
  title: string | null;
  authorName: string | null;
  thumbnailUrl: string | null;
  watchMinutes: number | null;
  reason: string;
}

export interface OEmbedRaw {
  type?: string;
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
  html?: string;
  duration?: number; // forward-compat — YouTube doesn't currently return this
}

export function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      return u.pathname.slice(1).split("/")[0] || null;
    }
    if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      const shorts = u.pathname.match(/^\/shorts\/([\w-]+)/);
      if (shorts) return shorts[1];
      const embed = u.pathname.match(/^\/embed\/([\w-]+)/);
      if (embed) return embed[1];
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchYouTubeOEmbed(url: string): Promise<OEmbedResult> {
  const params = new URLSearchParams({ url, format: "json" });
  let res: Response;
  try {
    res = await fetch(`${OEMBED_BASE}?${params}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    return empty(`fetch-error: ${(err as Error).message}`);
  }

  if (!res.ok) return empty(`http-${res.status}`);

  let data: OEmbedRaw;
  try {
    data = (await res.json()) as OEmbedRaw;
  } catch (err) {
    return empty(`parse-error: ${(err as Error).message}`);
  }

  const watchMinutes = computeWatchMinutes(data);

  return {
    ok: true,
    title: data.title ?? null,
    authorName: data.author_name ?? null,
    thumbnailUrl: data.thumbnail_url ?? null,
    watchMinutes,
    reason: "ok",
  };
}

/**
 * Try every plausible source for a duration:
 *   1. data.duration (forward-compat — YouTube doesn't return this today)
 *   2. ISO-8601 PT##M##S inside data.html
 *   3. mm:ss / hh:mm:ss inside data.html
 */
export function computeWatchMinutes(data: OEmbedRaw): number | null {
  // 1. explicit duration field (assumed seconds if number, ISO if string).
  if (typeof data.duration === "number" && data.duration > 0) {
    return Math.max(1, Math.round(data.duration / 60));
  }

  const html = data.html ?? "";

  // 2. ISO-8601 — `PT1H4M30S` or `PT4M30S` or `PT45S`.
  const iso = html.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (iso) {
    const h = Number(iso[1] ?? 0);
    const m = Number(iso[2] ?? 0);
    const s = Number(iso[3] ?? 0);
    const total = h * 3600 + m * 60 + s;
    if (total > 0) return Math.max(1, Math.round(total / 60));
  }

  // 3. mm:ss / hh:mm:ss anywhere in the html.
  const time = html.match(/(?:^|\D)(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\D|$)/);
  if (time) {
    if (time[3] !== undefined) {
      const h = Number(time[1]);
      const m = Number(time[2]);
      const s = Number(time[3]);
      const total = h * 3600 + m * 60 + s;
      return Math.max(1, Math.round(total / 60));
    }
    const m = Number(time[1]);
    const s = Number(time[2]);
    const total = m * 60 + s;
    if (total > 0) return Math.max(1, Math.round(total / 60));
  }

  return null;
}

function empty(reason: string): OEmbedResult {
  return {
    ok: false,
    title: null,
    authorName: null,
    thumbnailUrl: null,
    watchMinutes: null,
    reason,
  };
}
