// SPDX-License-Identifier: MIT
/**
 * Metadata enrichment worker.
 *
 * Fills `og_title / og_description_enriched / og_image_url / og_site_name /
 * favicon_url / canonical_url` (and `video_id / video_thumbnail_url` for
 * YouTube/Vimeo) for a single capture row.
 *
 * Idempotent — `metadata_state` gates the work:
 *   pending|failed → enriching → enriched|failed
 * Skips when `metadata_state = 'enriched'` and `metadata_fetched_at` is
 * less than `STALE_AFTER_DAYS` old.
 *
 * Title selection priority (NEVER stores a raw URL):
 *   og:title → twitter:title → <title> → first <h1>
 *     → og:site_name + pretty path
 *
 * Per-host politeness applied via `awaitHost`.
 */

import { parseHTML } from "linkedom";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { fetchHtml, urlHostname } from "./fetch-html";
import { awaitHost } from "./host-limiter";
import { decodeEntities } from "@/lib/decode-entities";
import { extractYouTubeId, fetchYouTubeOEmbed } from "@/lib/capture/oembed";
import { cleanFilenameTitle } from "@/lib/captures/display";
import { buildPlaceholderCardDataUrl } from "./placeholder-image";

const STALE_AFTER_DAYS = 30;
const MAX_TITLE_LEN = 400;
const MAX_DESC_LEN = 600;

export interface EnrichOneResult {
  ok: boolean;
  reason: string;
  state: "enriched" | "failed" | "skipped";
}

interface Row {
  id: string;
  url: string | null;
  kind: string;
  metadataState: string;
  metadataFetchedAt: Date | null;
  metadataAttempts: number;
  ogTitle: string | null;
  ogImage: string | null;
  noteId: string | null;
  userId: string;
  derivedTitle: string | null;
}

/** Run enrichment for a single capture row by id. */
export async function enrichOne(captureId: string): Promise<EnrichOneResult> {
  const [row] = await db
    .select({
      id: schema.captureSources.id,
      url: schema.captureSources.url,
      kind: schema.captureSources.kind,
      metadataState: schema.captureSources.metadataState,
      metadataFetchedAt: schema.captureSources.metadataFetchedAt,
      metadataAttempts: schema.captureSources.metadataAttempts,
      ogTitle: schema.captureSources.ogTitle,
      ogImage: schema.captureSources.ogImage,
      noteId: schema.captureSources.noteId,
      userId: schema.captureSources.userId,
      derivedTitle: schema.captureSources.derivedTitle,
    })
    .from(schema.captureSources)
    .where(eq(schema.captureSources.id, captureId))
    .limit(1);

  if (!row) return { ok: false, reason: "not-found", state: "failed" };
  if (row.kind !== "url" || !row.url) {
    await db
      .update(schema.captureSources)
      .set({ metadataState: "skipped" })
      .where(eq(schema.captureSources.id, captureId));
    return { ok: true, reason: "non-url", state: "skipped" };
  }

  // Idempotent freshness gate.
  if (row.metadataState === "enriched" && row.metadataFetchedAt) {
    const ageMs = Date.now() - row.metadataFetchedAt.getTime();
    if (ageMs < STALE_AFTER_DAYS * 86_400_000) {
      return { ok: true, reason: "fresh", state: "enriched" };
    }
  }

  // Concurrency lock — only proceed if we can flip to enriching.
  const lockResult = await db
    .update(schema.captureSources)
    .set({
      metadataState: "enriching",
      metadataAttempts: sql`${schema.captureSources.metadataAttempts} + 1`,
    })
    .where(
      and(
        eq(schema.captureSources.id, captureId),
        // Allow re-locking from pending|failed|enriched-but-stale.
        or(
          eq(schema.captureSources.metadataState, "pending"),
          eq(schema.captureSources.metadataState, "failed"),
          eq(schema.captureSources.metadataState, "enriched"),
        )!,
      ),
    )
    .returning({ id: schema.captureSources.id });

  if (lockResult.length === 0) {
    return { ok: true, reason: "already-locked", state: "skipped" };
  }

  try {
    const result = await enrichInner(row);

    // Universal post-pass: every row should leave the worker with (a) a
    // humane title and (b) a thumbnail URL of some kind. We don't promote
    // the row to `enriched` if the inner pass failed — but we still apply
    // the post-pass on success so cards render uniformly.
    if (result.ok) {
      await applyUniversalPostPass(row, result.updates);
    } else {
      // Even on failure, guarantee a displayable card (placeholder thumb +
      // URL-derived title) so no bookmark renders bare.
      Object.assign(result.updates, buildFailureFallback(row));
    }

    await db
      .update(schema.captureSources)
      .set({
        ...result.updates,
        metadataState: result.ok ? "enriched" : "failed",
        metadataFetchedAt: new Date(),
        metadataLastError: result.ok ? null : result.reason,
      })
      .where(eq(schema.captureSources.id, captureId));

    // Mirror the new title to the linked note if it's still empty.
    if (result.ok && row.noteId && result.updates.ogTitle) {
      await db
        .update(schema.notes)
        .set({ title: result.updates.ogTitle, updatedAt: new Date() })
        .where(
          and(eq(schema.notes.id, row.noteId), eq(schema.notes.title, "")),
        );
    }

    return {
      ok: result.ok,
      reason: result.reason,
      state: result.ok ? "enriched" : "failed",
    };
  } catch (err) {
    const reason = `enrich-error: ${(err as Error).message}`;
    await db
      .update(schema.captureSources)
      .set({
        ...buildFailureFallback(row),
        metadataState: "failed",
        metadataFetchedAt: new Date(),
        metadataLastError: reason,
      })
      .where(eq(schema.captureSources.id, captureId));
    return { ok: false, reason, state: "failed" };
  }
}

interface EnrichUpdates {
  ogTitle?: string | null;
  ogDescriptionEnriched?: string | null;
  ogImageUrl?: string | null;
  ogSiteName?: string | null;
  faviconUrl?: string | null;
  canonicalUrl?: string | null;
  videoId?: string | null;
  videoThumbnailUrl?: string | null;
  videoDurationSeconds?: number | null;
  // LLM rescue cache, populated when the static fallback can't produce a
  // humane title. Idempotent — only set if currently null.
  derivedTitle?: string | null;
  // Mirror to the legacy column too, so existing UI keeps working without
  // changes. New display helpers prefer the new columns.
  ogImage?: string | null;
}

interface EnrichInnerResult {
  ok: boolean;
  reason: string;
  updates: EnrichUpdates;
}

async function enrichInner(row: Row): Promise<EnrichInnerResult> {
  if (!row.url) return { ok: false, reason: "no-url", updates: {} };

  const host = urlHostname(row.url);

  // YouTube/Vimeo fast-path — public oEmbed, no HTML scrape.
  const ytId = extractYouTubeId(row.url);
  if (ytId) {
    await awaitHost("youtube.com");
    const oembed = await fetchYouTubeOEmbed(row.url);
    const thumb = `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`;
    const title =
      oembed.ok && oembed.title
        ? cleanText(oembed.title, MAX_TITLE_LEN)
        : null;
    const updates: EnrichUpdates = {
      videoId: ytId,
      videoThumbnailUrl: thumb,
      ogImageUrl: thumb,
      ogImage: thumb,
      ogTitle: title ?? row.ogTitle ?? null,
      ogSiteName: "YouTube",
      faviconUrl: "https://www.youtube.com/favicon.ico",
      canonicalUrl: `https://www.youtube.com/watch?v=${ytId}`,
      videoDurationSeconds:
        oembed.ok && oembed.watchMinutes
          ? oembed.watchMinutes * 60
          : null,
    };
    return {
      ok: true,
      reason: oembed.ok ? "youtube-oembed" : "youtube-fallback",
      updates,
    };
  }

  // Vimeo oEmbed — JSON, no API key.
  if (host === "vimeo.com" || host?.endsWith(".vimeo.com")) {
    await awaitHost("vimeo.com");
    const updates = await fetchVimeoOEmbed(row.url);
    if (updates) return { ok: true, reason: "vimeo-oembed", updates };
    // Fall through to generic HTML scrape.
  }

  // Generic HTML scrape.
  if (host) await awaitHost(host);
  const fetched = await fetchHtml(row.url);
  if (!fetched.ok || !fetched.html) {
    return { ok: false, reason: fetched.reason, updates: {} };
  }

  let document: Document;
  try {
    const parsed = parseHTML(fetched.html);
    document = parsed.document as unknown as Document;
  } catch (err) {
    return {
      ok: false,
      reason: `parse-error: ${(err as Error).message}`,
      updates: {},
    };
  }

  const finalUrl = fetched.finalUrl ?? row.url;
  const title = pickTitle(document, finalUrl);
  const description = pickDescription(document);
  const image = pickImage(document, finalUrl);
  const siteName = pickSiteName(document);
  const favicon = await resolveFavicon(document, finalUrl);
  const canonical = pickCanonical(document, finalUrl);

  return {
    ok: true,
    reason: "ok",
    updates: {
      ogTitle: title,
      ogDescriptionEnriched: description,
      ogImageUrl: image,
      ogImage: image,
      ogSiteName: siteName,
      faviconUrl: favicon,
      canonicalUrl: canonical,
    },
  };
}

/**
 * Universal post-pass: ensures every row has (a) a thumbnail URL of some
 * kind — generated SVG placeholder for articles missing og:image, video
 * thumbnail synthesised for YouTube ids that didn't get oEmbed — and (b)
 * a humane title via LLM rescue if the static fallback can't produce one.
 *
 * Mutates `updates` in place so the same DB write commits everything.
 *
 * Cheap by design: rescueTitle is gated on a static check that costs
 * nothing when og_title is already humane. The placeholder generator is
 * pure — no fetches.
 */
async function applyUniversalPostPass(
  row: Row,
  updates: EnrichUpdates,
): Promise<void> {
  if (!row.url) return;

  // (a) Thumbnail safety net.
  const haveImage =
    updates.ogImageUrl ||
    updates.videoThumbnailUrl ||
    updates.ogImage;
  if (!haveImage) {
    // Synthesise a YouTube thumb if we somehow have a video id without one.
    if (updates.videoId) {
      const synthesised = `https://i.ytimg.com/vi/${updates.videoId}/hqdefault.jpg`;
      updates.videoThumbnailUrl = synthesised;
      updates.ogImageUrl = synthesised;
      updates.ogImage = synthesised;
    } else {
      // Article with no og:image → tasteful generated placeholder.
      let domain = "";
      try {
        domain = new URL(row.url).hostname.replace(/^www\./, "");
      } catch {
        domain = "";
      }
      if (domain) {
        const placeholder = buildPlaceholderCardDataUrl({
          domain,
          title: updates.ogTitle ?? null,
          faviconUrl: updates.faviconUrl ?? null,
        });
        updates.ogImageUrl = placeholder;
        updates.ogImage = placeholder;
      }
    }
  }

  // (b) Title rescue. We only fire Plexo if every static path fails.
  if (row.derivedTitle && row.derivedTitle.trim()) return;
  const candidate = updates.ogTitle ?? row.ogTitle ?? null;
  if (candidate && isHumaneTitle(candidate)) return;

  // For filename-shaped URLs, try cleanFilenameTitle locally before
  // burning a Plexo call.
  let filenameSuggestion: string | null = null;
  try {
    const u = new URL(row.url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (last && /\.(mp4|mov|webm|mkv|avi|mp3|wav|m4a|pdf|docx?)$/i.test(last)) {
      filenameSuggestion = cleanFilenameTitle(last);
    }
  } catch {
    /* swallow */
  }
  if (filenameSuggestion && filenameSuggestion.split(/\s+/).length >= 3) {
    updates.derivedTitle = filenameSuggestion;
    return;
  }

  // Final attempt — title rescue is removed with Plexo (v2).
  // The fetch fallback below derives titles without an LLM.
}

/**
 * Failure-path safety net. When the HTML fetch fails (dead/403/404/timeout/
 * paywall), the row never reaches applyUniversalPostPass, so it would render
 * with no thumbnail and a raw-URL title forever. This derives a displayable
 * placeholder image + a URL-derived title so EVERY bookmark card renders,
 * even ones we can never scrape. State stays `failed` (caller decides) so a
 * later pass can still upgrade it if the host comes back.
 */
function buildFailureFallback(row: Row): EnrichUpdates {
  const updates: EnrichUpdates = {};
  if (!row.url) return updates;

  let domain = "";
  try {
    domain = new URL(row.url).hostname.replace(/^www\./, "");
  } catch {
    domain = "";
  }

  // Placeholder thumb if we don't already have one.
  if (!row.ogImage && domain) {
    const placeholder = buildPlaceholderCardDataUrl({ domain, title: null, faviconUrl: null });
    updates.ogImageUrl = placeholder;
    updates.ogImage = placeholder;
  }

  // URL-derived title if neither a humane og_title nor a derived title exists.
  const haveTitle =
    (row.derivedTitle && row.derivedTitle.trim()) ||
    (row.ogTitle && isHumaneTitle(row.ogTitle));
  if (!haveTitle) {
    const derived = titleFromUrl(row.url, domain);
    if (derived) updates.derivedTitle = derived;
  }
  return updates;
}

/** Turn a URL into a readable title: last meaningful path slug, else domain. */
function titleFromUrl(url: string, domain: string): string | null {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean).pop() ?? "";
    const slug = decodeURIComponent(seg)
      .replace(/\.[a-z0-9]{1,5}$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (slug && /\s/.test(slug) && slug.length >= 6 && !/^\d+$/.test(slug)) {
      return titleCase(slug).slice(0, MAX_TITLE_LEN);
    }
  } catch {
    /* fall through to domain */
  }
  return domain ? titleCase(domain.replace(/\.[a-z]+$/i, "").replace(/[.-]/g, " ")) : null;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Quick heuristic: would the static title be acceptable as a card title?
 *  Mirrors the rejections in lib/captures/display.ts. */
function isHumaneTitle(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (/^https?:\/\//i.test(t)) return false;
  if (!/\s/.test(t) && t.length >= 8 && t.length <= 24 && /^[A-Za-z0-9_-]+$/.test(t)) {
    return false; // looks like a video id
  }
  if (/\.(mp4|mov|webm|mkv|avi|mp3|wav|m4a|ogg|aac|flac|pdf|docx?|jpe?g|png|gif|webp|svg)$/i.test(t)) {
    return false;
  }
  if (!/\s/.test(t) && /[_-]/.test(t) && t.length > 24) return false;
  return true;
}

async function fetchVimeoOEmbed(url: string): Promise<EnrichUpdates | null> {
  try {
    const params = new URLSearchParams({ url });
    const res = await fetch(`https://vimeo.com/api/oembed.json?${params}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      title?: string;
      thumbnail_url?: string;
      duration?: number;
      video_id?: number | string;
    };
    const id = data.video_id ? String(data.video_id) : null;
    return {
      videoId: id,
      videoThumbnailUrl: data.thumbnail_url ?? null,
      ogImageUrl: data.thumbnail_url ?? null,
      ogImage: data.thumbnail_url ?? null,
      ogTitle: data.title ? cleanText(data.title, MAX_TITLE_LEN) : null,
      ogSiteName: "Vimeo",
      faviconUrl: "https://vimeo.com/favicon.ico",
      canonicalUrl: id ? `https://vimeo.com/${id}` : null,
      videoDurationSeconds:
        typeof data.duration === "number" ? data.duration : null,
    };
  } catch {
    return null;
  }
}

// ---------- DOM extractors ----------

function metaContent(doc: Document, selector: string): string | null {
  const el = doc.querySelector(selector);
  const v = el?.getAttribute("content");
  return v && v.trim() ? v.trim() : null;
}

function pickTitle(doc: Document, url: string): string | null {
  const candidates = [
    metaContent(doc, 'meta[property="og:title"]'),
    metaContent(doc, 'meta[name="og:title"]'),
    metaContent(doc, 'meta[name="twitter:title"]'),
    metaContent(doc, 'meta[property="twitter:title"]'),
    doc.querySelector("title")?.textContent?.trim() ?? null,
    doc.querySelector("h1")?.textContent?.trim() ?? null,
  ];
  for (const c of candidates) {
    const cleaned = cleanText(c, MAX_TITLE_LEN);
    if (cleaned && !looksLikeUrl(cleaned)) return cleaned;
  }

  // Last resort: og:site_name + pretty path. Never the raw URL.
  const site = metaContent(doc, 'meta[property="og:site_name"]');
  const pretty = prettyPath(url);
  if (site && pretty) return `${site} — ${pretty}`;
  if (site) return site;
  if (pretty) return pretty;
  return null;
}

function pickDescription(doc: Document): string | null {
  const candidates = [
    metaContent(doc, 'meta[property="og:description"]'),
    metaContent(doc, 'meta[name="og:description"]'),
    metaContent(doc, 'meta[name="twitter:description"]'),
    metaContent(doc, 'meta[property="twitter:description"]'),
    metaContent(doc, 'meta[name="description"]'),
  ];
  for (const c of candidates) {
    const cleaned = cleanText(c, MAX_DESC_LEN);
    if (cleaned) return cleaned;
  }
  return null;
}

function pickImage(doc: Document, baseUrl: string): string | null {
  const candidates = [
    metaContent(doc, 'meta[property="og:image"]'),
    metaContent(doc, 'meta[property="og:image:secure_url"]'),
    metaContent(doc, 'meta[property="og:image:url"]'),
    metaContent(doc, 'meta[name="twitter:image"]'),
    metaContent(doc, 'meta[name="twitter:image:src"]'),
    metaContent(doc, 'link[rel="image_src"]'),
    doc.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href") ??
      null,
  ];
  for (const c of candidates) {
    const abs = absolutize(c, baseUrl);
    if (abs) return abs;
  }
  return null;
}

function pickSiteName(doc: Document): string | null {
  return cleanText(
    metaContent(doc, 'meta[property="og:site_name"]') ??
      metaContent(doc, 'meta[name="application-name"]'),
    120,
  );
}

/**
 * Confirms a candidate favicon URL actually resolves to an image. Without
 * this check we used to store guessed `/favicon.ico` URLs that 404 or return
 * an HTML error page — the browser then logs "Failed to load resource" /
 * ORB-blocked errors for every such bookmark. Validating here means the UI
 * only ever loads favicons that are real images.
 */
export async function isReachableImage(url: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NexalogBot/1.0; +https://nexalog.com)",
        Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
      },
    });
    const ct = res.headers.get("content-type") ?? "";
    try { await res.body?.cancel(); } catch { /* ignore */ }
    return res.ok && ct.startsWith("image/");
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Collects favicon candidates (declared <link rel=icon> hrefs, then the
 * conventional /favicon.ico) and returns the first that validates as a real
 * image, or null. Async because validation requires a network probe.
 */
async function resolveFavicon(doc: Document, baseUrl: string): Promise<string | null> {
  const candidates: string[] = [];
  const links = Array.from(
    doc.querySelectorAll<HTMLLinkElement>(
      'link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]',
    ),
  );
  for (const link of links) {
    const abs = absolutize(link.getAttribute("href"), baseUrl);
    if (abs && !candidates.includes(abs)) candidates.push(abs);
  }
  try {
    const origin = new URL(baseUrl).origin;
    const ico = `${origin}/favicon.ico`;
    if (!candidates.includes(ico)) candidates.push(ico);
  } catch { /* ignore */ }

  for (const candidate of candidates) {
    if (await isReachableImage(candidate)) return candidate;
  }
  return null;
}

function pickCanonical(doc: Document, baseUrl: string): string | null {
  const href = doc
    .querySelector<HTMLLinkElement>('link[rel="canonical"]')
    ?.getAttribute("href");
  return absolutize(href ?? null, baseUrl);
}

// ---------- helpers ----------

function cleanText(value: string | null, max: number): string | null {
  if (!value) return null;
  const decoded = decodeEntities(value).normalize("NFC").replace(/\s+/g, " ").trim();
  if (!decoded) return null;
  return decoded.slice(0, max);
}

function looksLikeUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

function absolutize(value: string | null, base: string): string | null {
  if (!value) return null;
  try {
    return new URL(value, base).toString();
  } catch {
    return null;
  }
}

function prettyPath(url: string): string | null {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean);
    if (segments.length === 0) return u.hostname.replace(/^www\./, "");
    const last = segments[segments.length - 1] || segments[segments.length - 2];
    if (!last) return null;
    return last
      .replace(/[-_]+/g, " ")
      .replace(/\.[a-z0-9]{1,5}$/i, "")
      .trim()
      .replace(/^\w/, (c) => c.toUpperCase()) || null;
  } catch {
    return null;
  }
}

// ---------- batch runner ----------

export interface RunBatchOptions {
  limit?: number;
  workspaceId?: string;
}

export interface BatchReport {
  scanned: number;
  enriched: number;
  failed: number;
  skipped: number;
}

/**
 * Process up to `limit` rows whose metadata_state is pending or failed.
 * Used by the worker route and the nightly cron pass.
 */
export async function runMetadataBatch(
  opts: RunBatchOptions = {},
): Promise<BatchReport> {
  const limit = opts.limit ?? 100;
  const conditions = [
    eq(schema.captureSources.kind, "url"),
    inArray(schema.captureSources.metadataState, ["pending", "failed"]),
    // Skip rows that have failed too many times — give up after 5 attempts.
    lt(schema.captureSources.metadataAttempts, 5),
  ];
  if (opts.workspaceId) {
    conditions.push(eq(schema.captureSources.workspaceId, opts.workspaceId));
  }

  const rows = await db
    .select({ id: schema.captureSources.id })
    .from(schema.captureSources)
    .where(and(...conditions))
    .limit(limit);

  const report: BatchReport = {
    scanned: rows.length,
    enriched: 0,
    failed: 0,
    skipped: 0,
  };
  for (const r of rows) {
    const result = await enrichOne(r.id);
    if (result.state === "enriched") report.enriched++;
    else if (result.state === "failed") report.failed++;
    else report.skipped++;
  }
  return report;
}

/**
 * Scan helper for surfacing rows whose metadata is missing — used by the
 * cron entrypoint and the backfill script. Exposed so callers can decide
 * pacing/rate.
 */
export async function findPendingMetadataIds(
  limit = 100,
): Promise<string[]> {
  const rows = await db
    .select({ id: schema.captureSources.id })
    .from(schema.captureSources)
    .where(
      and(
        eq(schema.captureSources.kind, "url"),
        inArray(schema.captureSources.metadataState, ["pending", "failed"]),
        // Avoid pinning rows that are mid-flight in another process.
        or(
          isNull(schema.captureSources.metadataFetchedAt),
          lt(
            schema.captureSources.metadataFetchedAt,
            new Date(Date.now() - 60_000),
          ),
        )!,
      ),
    )
    .limit(limit);
  return rows.map((r) => r.id);
}
