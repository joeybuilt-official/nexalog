// SPDX-License-Identifier: MIT
/**
 * Display helpers — pure functions, no DB access. Imported by every UI
 * surface that renders a capture row (bookmarks list, watch, reading,
 * synthesis, search, today). Centralized so the various agents touching
 * presentation can converge on a single source of truth.
 *
 * Hard rule: `displayTitle` NEVER returns:
 *   - a raw URL (`https?://…`)
 *   - a bare 11-char YouTube video ID (`x9JSAGPtNQpl4taBB`)
 *   - a raw filename (`UGC__English_902191I_…_Vert.mp4`)
 *   - a leftover path tail like `/Here` or `/index`
 *
 * Inputs are loose — `unknown`-shaped row records work too — so legacy
 * callers (snake_case from `db.execute(sql)`) don't have to remap before
 * passing in.
 */

const TITLE_MAX_LEN = 200;
const SUMMARY_FALLBACK_LEN = 160;

/** Lenient row shape covering both new (camelCase, drizzle) and legacy
 *  (snake_case, raw SQL) callers. */
export interface DisplayCaptureRow {
  url?: string | null;
  ogTitle?: string | null;
  og_title?: string | null;
  derivedTitle?: string | null;
  derived_title?: string | null;
  ogDescription?: string | null;
  og_description?: string | null;
  ogDescriptionEnriched?: string | null;
  og_description_enriched?: string | null;
  ogImage?: string | null;
  og_image?: string | null;
  ogImageUrl?: string | null;
  og_image_url?: string | null;
  ogSiteName?: string | null;
  og_site_name?: string | null;
  faviconUrl?: string | null;
  favicon_url?: string | null;
  videoId?: string | null;
  video_id?: string | null;
  videoThumbnailUrl?: string | null;
  video_thumbnail_url?: string | null;
  summary?: string | null;
  readerText?: string | null;
  reader_text?: string | null;
  extractedText?: string | null;
  extracted_text?: string | null;
  kindClassified?: string | null;
  kind_classified?: string | null;
  urlHost?: string | null;
  url_host?: string | null;
  urlPath?: string | null;
  url_path?: string | null;
  content?: string | null;
}

function pick<T>(...values: Array<T | null | undefined>): T | null {
  for (const v of values) {
    if (v !== null && v !== undefined && v !== "") return v;
  }
  return null;
}

function looksLikeUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

/** YouTube video IDs are 11 chars of [A-Za-z0-9_-]. We treat any string of
 *  exactly 11 such chars (no spaces) as suspicious and reject it as a title.
 *  Also catch slightly longer "shorts" id leaks (10–15 with no spaces). */
function looksLikeVideoId(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (/\s/.test(t)) return false;
  if (t.length < 8 || t.length > 24) return false;
  return /^[A-Za-z0-9_-]+$/.test(t);
}

/** Filename-shaped strings: end in a media/document extension. We refuse
 *  the raw form as a title and run cleanFilenameTitle on it instead. */
const FILENAME_EXT_RE = /\.(mp4|mov|webm|mkv|avi|mp3|wav|m4a|ogg|aac|flac|pdf|docx?|jpg|jpeg|png|gif|webp|svg)$/i;
function looksLikeFilename(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (looksLikeUrl(t)) return false;
  if (FILENAME_EXT_RE.test(t)) return true;
  // Underscore- or hyphen-heavy stretches with no spaces look like raw
  // filenames even without an extension (`UGC__English_902191I_…`).
  if (!/\s/.test(t) && /[_-]/.test(t) && t.length > 24) return true;
  return false;
}

/** Path-tail leaks like `/Here`, `/index`, `/page`, `/home` snuck through
 *  prettyPath. Reject these so the caller can fall back further. */
const NOISE_TAIL_RE = /^(here|index|page|home|main|default|view|read|article|post|story|content|item|untitled)$/i;

/** UGC / encoder noise tokens stripped from filename-shaped titles. */
const FILENAME_DENYLIST = new Set([
  "ugc",
  "english",
  "vert",
  "vertical",
  "horiz",
  "horizontal",
  "final",
  "draft",
  "raw",
  "edit",
  "edited",
  "export",
  "render",
  "rendered",
  "preview",
  "compressed",
  "watermark",
  "watermarked",
  "v1",
  "v2",
  "v3",
  "v4",
  "v5",
  "script",
  "shoot",
  "shot",
  "take",
  "1080p",
  "720p",
  "480p",
  "4k",
  "hd",
  "sd",
  "60fps",
  "30fps",
  "h264",
  "h265",
  "hevc",
  "mov",
  "mp4",
  "webm",
]);

/**
 * Clean a raw filename into a humane title.
 *   `UGC__English_902191I_EdwardS_Perplexity_Computer_Launch_Script_1_Vert.mp4`
 *     → `Edwards Perplexity Computer Launch`
 * Returns null if the cleaned version has fewer than 3 words — caller
 * should fall back to LLM rescue.
 */
export function cleanFilenameTitle(filename: string): string | null {
  if (!filename) return null;
  // Strip extension.
  let s = filename.replace(/\.[a-z0-9]{1,5}$/i, "");
  // Replace separators with spaces.
  s = s.replace(/[_\-]+/g, " ");
  // Collapse whitespace.
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return null;

  // Tokenize, drop denylist + numeric-only tokens.
  const tokens = s
    .split(" ")
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !FILENAME_DENYLIST.has(t.toLowerCase()))
    // Drop pure-numeric tokens AND tokens that are mostly digits with a
    // letter or two (`902191I`, `4K30`) — those are encoder/sequence ids.
    .filter((t) => {
      if (/^\d+$/.test(t)) return false;
      if (/^\d/.test(t) && t.length <= 8 && /\d/.test(t.slice(-1))) return false;
      // Reject tokens that are >70% digits by char count.
      const digits = (t.match(/\d/g) || []).length;
      if (digits / t.length > 0.6) return false;
      return true;
    });

  if (tokens.length < 3) return null;

  // Title-case each token but preserve all-caps acronyms (≤4 chars).
  const titled = tokens.map((t) => {
    if (t.length <= 4 && t === t.toUpperCase()) return t;
    return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  });

  return titled.join(" ").slice(0, TITLE_MAX_LEN);
}

/** Pretty registrable domain — `discord.com`, not the full URL. */
export function displayDomain(row: DisplayCaptureRow): string {
  const stored = pick(row.urlHost, row.url_host);
  if (stored && typeof stored === "string") {
    return stored.replace(/^www\./, "");
  }
  const url = pick(row.url, row.content);
  if (!url || typeof url !== "string") return "";
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Pretty path segment for fallbacks (no leading slash, hyphens to spaces).
 *  Skips trailing purely-numeric segments (IDs) AND noise tails ("here",
 *  "index"). Returns null if no humane segment found. */
function prettyPath(row: DisplayCaptureRow): string | null {
  const url = pick(row.url, row.content);
  if (!url || typeof url !== "string") return null;
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean);
    if (segments.length === 0) return null;
    // Walk from the end and pick the first segment that isn't a bare ID
    // or a noise tail.
    let chosen: string | null = null;
    for (let i = segments.length - 1; i >= 0; i--) {
      const s = segments[i];
      if (/^\d+$/.test(s)) continue;
      // uuid-shaped segments.
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
        continue;
      }
      // Noise tails like /Here, /index — only reject if the BARE segment
      // (post extension/separator strip) is in the noise list.
      const stripped = s.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[-_]+/g, " ").trim();
      if (NOISE_TAIL_RE.test(stripped)) continue;
      // Reject 10+ char hash-shaped path slugs that are all letters+digits
      // with no separators — `1ef4f861ce7c`-style hex tails.
      if (/^[a-f0-9]{8,}$/i.test(s)) continue;
      chosen = s;
      break;
    }
    if (!chosen) return null;
    const cleaned = chosen
      .replace(/[-_]+/g, " ")
      .replace(/\.[a-z0-9]{1,5}$/i, "")
      .trim();
    if (!cleaned) return null;
    // Drop trailing hex/hash chunk that some publishers append after the
    // slug, e.g. `claude md best practices 1ef4f861ce7c`.
    const trimmedHash = cleaned.replace(/\s+[a-f0-9]{8,}$/i, "").trim();
    const final = trimmedHash || cleaned;
    return final.replace(/^\w/, (c) => c.toUpperCase()) || null;
  } catch {
    return null;
  }
}

/**
 * Title fallback chain (top wins):
 *   derived_title (LLM rescue cache)
 *     → og_title (only if it doesn't look like a URL/filename/video id)
 *     → og_site_name + pretty path
 *     → og_site_name
 *     → "{Domain} — {pretty path}"
 *     → pretty path
 *     → "Untitled video · YouTube" for video_id rows with no usable text
 *     → cleaned filename for filename-shaped urls
 *     → domain
 *     → "Untitled"
 *
 * NEVER returns a raw URL. NEVER returns a bare video id. NEVER returns
 * a raw filename.
 */
export function displayTitle(row: DisplayCaptureRow): string {
  // 1. LLM rescue cache wins.
  const derived = pick(row.derivedTitle, row.derived_title);
  if (typeof derived === "string") {
    const t = derived.trim();
    if (t && !looksLikeUrl(t) && !looksLikeVideoId(t) && !looksLikeFilename(t)) {
      return t.slice(0, TITLE_MAX_LEN);
    }
  }

  // 2. og_title — but reject URL-shaped, video-id-shaped, filename-shaped
  // values that occasionally make it into og_title from broken extractors.
  const ogTitle = pick(row.ogTitle, row.og_title);
  if (typeof ogTitle === "string") {
    const t = ogTitle.trim();
    if (t && !looksLikeUrl(t) && !looksLikeVideoId(t) && !looksLikeFilename(t)) {
      return t.slice(0, TITLE_MAX_LEN);
    }
  }

  const site = pick(row.ogSiteName, row.og_site_name);
  const pretty = prettyPath(row);
  const domain = displayDomain(row);
  const kind = pick(row.kindClassified, row.kind_classified);
  const videoId = pick(row.videoId, row.video_id);

  // Videos take a shortcut — pretty-path on a YouTube/Vimeo URL would
  // emit "Watch" or a video id slug. Always prefer the humane "Untitled
  // video · YouTube" form when the row is video-classified or carries a
  // video id, unless we have an og_site_name to attach.
  const isVideoRow = kind === "video" || !!videoId;
  if (isVideoRow && !site) {
    if (domain.includes("youtube") || domain === "youtu.be" || (videoId && !domain)) {
      return "Untitled video · YouTube";
    }
    if (domain.includes("vimeo")) return "Untitled video · Vimeo";
    return "Untitled video";
  }

  if (site && pretty) return `${site} — ${pretty}`.slice(0, TITLE_MAX_LEN);
  if (site && typeof site === "string") return site.slice(0, TITLE_MAX_LEN);

  // No site name but we have a path — pair the path with a Title-cased
  // domain so cards never read as a bare orphan segment ("Webhooks") with
  // no source.
  if (pretty && domain) {
    const pretty_domain = domain.replace(/^\w/, (c) => c.toUpperCase());
    return `${pretty_domain} — ${pretty}`.slice(0, TITLE_MAX_LEN);
  }
  if (pretty) return pretty.slice(0, TITLE_MAX_LEN);

  // URL points to a filename? Try cleaning it.
  const url = pick(row.url, row.content);
  if (typeof url === "string") {
    try {
      const u = new URL(url);
      const last = u.pathname.split("/").filter(Boolean).pop();
      if (last && FILENAME_EXT_RE.test(last)) {
        const cleaned = cleanFilenameTitle(last);
        if (cleaned) return cleaned;
        // Filename couldn't be cleaned — surface domain + "file".
        if (domain) return `${domain.replace(/^\w/, (c) => c.toUpperCase())} — File`;
      }
    } catch {
      /* swallow */
    }
  }

  if (domain) return domain;
  return "Untitled";
}

const NOTE_TITLE_PREVIEW_LEN = 80;

/**
 * Title for a note row. Uses the note's own title when set, otherwise
 * falls back to the first non-empty line of its (HTML) body so the UI
 * never shows a wall of "Untitled". Returns "Untitled" only for a truly
 * empty note.
 */
export function noteDisplayTitle(
  title: string | null | undefined,
  content: string | null | undefined,
): string {
  const t = (title ?? "").trim();
  if (t) return t.slice(0, TITLE_MAX_LEN);
  const text = (content ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "Untitled";
  return text.length > NOTE_TITLE_PREVIEW_LEN
    ? text.slice(0, NOTE_TITLE_PREVIEW_LEN).trimEnd() + "…"
    : text;
}

/**
 * Returns a validated favicon URL or null. Only returns the stored favicon
 * (which enrichment has confirmed resolves to a real image). We deliberately
 * do NOT guess `https://<domain>/favicon.ico` — unvalidated guesses 404 or
 * return HTML for many hosts, spamming the console with failed-resource /
 * ORB errors. When null, the card renders a kind glyph instead.
 */
export function displayFavicon(row: DisplayCaptureRow): string | null {
  const stored = pick(row.faviconUrl, row.favicon_url);
  if (stored && typeof stored === "string") return stored;
  return null;
}

/**
 * Returns the best thumbnail URL for the row.
 *   - video: video_thumbnail_url, then og_image_url
 *   - article: og_image_url, then og_image
 *   - other: null
 *
 * Universal-thumbnail rule: if the row has a `video_id` but no stored
 * thumbnail, we synthesise the YouTube `i.ytimg.com` URL on the fly so
 * card grids never have video gaps.
 */
export function displayThumbnail(row: DisplayCaptureRow): string | null {
  const kind = pick(row.kindClassified, row.kind_classified);
  if (kind === "video") {
    const t = pick(
      row.videoThumbnailUrl,
      row.video_thumbnail_url,
      row.ogImageUrl,
      row.og_image_url,
      row.ogImage,
      row.og_image,
    );
    if (typeof t === "string") return t;
    // Last-resort synthesis from a known YouTube id.
    const vid = pick(row.videoId, row.video_id);
    if (typeof vid === "string" && vid) {
      return `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
    }
    return null;
  }
  const t = pick(
    row.ogImageUrl,
    row.og_image_url,
    row.ogImage,
    row.og_image,
  );
  return typeof t === "string" ? t : null;
}

/**
 * Returns a 1-2 sentence summary or null. Fallback chain:
 *   summary (Plexo) → og_description (enriched, then legacy)
 *     → first 160 chars of reader_text (or extracted_text)
 */
export function displaySummary(row: DisplayCaptureRow): string | null {
  const direct = pick(row.summary);
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }
  const desc = pick(
    row.ogDescriptionEnriched,
    row.og_description_enriched,
    row.ogDescription,
    row.og_description,
  );
  if (typeof desc === "string" && desc.trim()) {
    return desc.trim();
  }
  const text = pick(row.readerText, row.reader_text, row.extractedText, row.extracted_text);
  if (typeof text === "string" && text.trim()) {
    const compact = text.replace(/\s+/g, " ").trim();
    return compact.slice(0, SUMMARY_FALLBACK_LEN) + (compact.length > SUMMARY_FALLBACK_LEN ? "…" : "");
  }
  return null;
}

/**
 * Convenience: bundle all display fields. UI components can grab a single
 * object instead of calling four helpers.
 */
export interface DisplayBundle {
  title: string;
  domain: string;
  favicon: string | null;
  thumbnail: string | null;
  summary: string | null;
}

export function displayBundle(row: DisplayCaptureRow): DisplayBundle {
  return {
    title: displayTitle(row),
    domain: displayDomain(row),
    favicon: displayFavicon(row),
    thumbnail: displayThumbnail(row),
    summary: displaySummary(row),
  };
}

// ---------- Internal predicates exported for tests ----------

export const __test__ = {
  looksLikeUrl,
  looksLikeVideoId,
  looksLikeFilename,
};
