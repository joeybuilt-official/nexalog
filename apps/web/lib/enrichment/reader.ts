// SPDX-License-Identifier: MIT
/**
 * Reader-mode extraction worker.
 *
 * Runs Mozilla Readability against the saved URL and persists:
 *   reader_html — sanitized inner HTML (script/iframe/form/style stripped)
 *   reader_text — plain text body (used for summary + embeddings)
 *   reader_state — pending|extracting|ready|failed|skipped
 *
 * Mirrors `extractedText` to keep the legacy `/reader` page rendering
 * without a backend change, while the new columns power v1 surfaces.
 *
 * Dependencies already in the tree (no new deps): @mozilla/readability,
 * linkedom. We use linkedom over jsdom because it's already pulled in
 * (Phase 11 pass 2) and has a smaller install footprint.
 *
 * Sanitization is allow-list based: keep <p>, <a>, headings, lists,
 * <img>, <blockquote>, <pre>, <code>, <hr>, <strong>/<em>; drop everything
 * else along with on* attributes.
 */

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { fetchHtml, urlHostname } from "./fetch-html";
import { awaitHost } from "./host-limiter";
import { PAYWALL_PATTERNS } from "@/lib/capture/extractor";

const ALLOWED_TAGS = new Set([
  "a",
  "p",
  "br",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "s",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "img",
  "figure",
  "figcaption",
  "div",
  "span",
]);
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "title", "rel"]),
  img: new Set(["src", "alt", "title", "width", "height"]),
};

export interface ExtractReaderResult {
  ok: boolean;
  reason: string;
  state: "ready" | "failed" | "skipped" | "paywalled";
}

interface Row {
  id: string;
  url: string | null;
  kind: string;
  readerState: string;
  readerFetchedAt: Date | null;
  kindClassified: string | null;
}

const STALE_AFTER_DAYS = 60;
/**
 * A row left in `extracting` for longer than this is a dead worker's lock, not
 * a live one: the HTML fetch is capped at 10 s and the pass is synchronous
 * within `extractReader`, so nothing legitimately holds the lock for minutes.
 * 15 min leaves room for a slow fetch plus the per-host politeness wait.
 */
const STALE_LOCK_MS = 15 * 60 * 1000;

export async function extractReader(
  captureId: string,
): Promise<ExtractReaderResult> {
  const [row] = await db
    .select({
      id: schema.captureSources.id,
      url: schema.captureSources.url,
      kind: schema.captureSources.kind,
      readerState: schema.captureSources.readerState,
      readerFetchedAt: schema.captureSources.readerFetchedAt,
      kindClassified: schema.captureSources.kindClassified,
    })
    .from(schema.captureSources)
    .where(eq(schema.captureSources.id, captureId))
    .limit(1);

  if (!row) return { ok: false, reason: "not-found", state: "failed" };
  if (row.kind !== "url" || !row.url) {
    await db
      .update(schema.captureSources)
      .set({ readerState: "skipped" })
      .where(eq(schema.captureSources.id, captureId));
    return { ok: true, reason: "non-url", state: "skipped" };
  }

  // Skip homepages, social, and bare videos — Readability won't find content.
  if (
    row.kindClassified === "homepage" ||
    row.kindClassified === "social" ||
    row.kindClassified === "video"
  ) {
    await db
      .update(schema.captureSources)
      .set({ readerState: "skipped" })
      .where(eq(schema.captureSources.id, captureId));
    return { ok: true, reason: "non-article", state: "skipped" };
  }

  if (row.readerState === "ready" && row.readerFetchedAt) {
    const ageMs = Date.now() - row.readerFetchedAt.getTime();
    if (ageMs < STALE_AFTER_DAYS * 86_400_000) {
      return { ok: true, reason: "fresh", state: "ready" };
    }
  }

  // Lock. `skipped` rows are admitted on purpose: a row is marked `skipped`
  // when it is a non-URL or a homepage/social/video kind (and importers write
  // it by default), but a later reclassification can make it readable — and
  // until this fix `skipped` was absent here, so such a row could never be
  // re-extracted at all (~309 search-visible rows were stranded in that state).
  // A stale `extracting` row is reclaimed too: the fetch has a 10 s timeout, so
  // an `extracting` row older than the staleness window is a dead process's
  // lock, not another worker holding it (20 rows were stuck that way).
  const staleLockCutoff = new Date(Date.now() - STALE_LOCK_MS);
  const lock = await db
    .update(schema.captureSources)
    .set({ readerState: "extracting" })
    .where(
      and(
        eq(schema.captureSources.id, captureId),
        or(
          inArray(schema.captureSources.readerState, [
            "pending",
            "failed",
            "ready",
            "skipped",
          ]),
          and(
            eq(schema.captureSources.readerState, "extracting"),
            or(
              isNull(schema.captureSources.readerFetchedAt),
              lt(schema.captureSources.readerFetchedAt, staleLockCutoff),
            ),
          ),
        ),
      ),
    )
    .returning({ id: schema.captureSources.id });
  if (lock.length === 0) {
    return { ok: true, reason: "already-locked", state: "skipped" };
  }

  const host = urlHostname(row.url);
  if (host) await awaitHost(host);
  const fetched = await fetchHtml(row.url);
  if (!fetched.ok || !fetched.html) {
    await db
      .update(schema.captureSources)
      .set({
        readerState: "failed",
        readerFetchedAt: new Date(),
        metadataLastError: fetched.reason,
      })
      .where(eq(schema.captureSources.id, captureId));
    return { ok: false, reason: fetched.reason, state: "failed" };
  }

  const paywallSniffed = PAYWALL_PATTERNS.some((re) => re.test(fetched.html!));

  let document: Document;
  try {
    document = parseHTML(fetched.html).document as unknown as Document;
  } catch (err) {
    await markFailed(captureId, `parse-error: ${(err as Error).message}`);
    return {
      ok: false,
      reason: `parse-error: ${(err as Error).message}`,
      state: "failed",
    };
  }

  let article: ReturnType<Readability["parse"]> = null;
  try {
    article = new Readability(document, {
      charThreshold: 250,
      keepClasses: false,
    }).parse();
  } catch (err) {
    await markFailed(captureId, `readability-error: ${(err as Error).message}`);
    return {
      ok: false,
      reason: `readability-error: ${(err as Error).message}`,
      state: "failed",
    };
  }

  const text = article?.textContent
    ? article.textContent.replace(/\s+\n/g, "\n").trim()
    : "";
  const wordCount = text ? text.split(/\s+/).length : 0;
  const readMinutes = wordCount > 0 ? Math.max(1, Math.round(wordCount / 200)) : null;
  const paywalled = paywallSniffed && wordCount < 400;

  if (!article || !text || text.length < 200) {
    // Failure or paywall — persist but flag state cleanly.
    await db
      .update(schema.captureSources)
      .set({
        readerState: "failed",
        readerFetchedAt: new Date(),
        paywalled,
        metadataLastError: paywallSniffed
          ? "paywalled-or-empty"
          : "no-readable-content",
      })
      .where(eq(schema.captureSources.id, captureId));
    return {
      ok: false,
      reason: paywallSniffed ? "paywalled" : "no-readable-content",
      state: paywallSniffed ? "paywalled" : "failed",
    };
  }

  const sanitizedHtml = sanitize(article.content ?? "", row.url);

  await db
    .update(schema.captureSources)
    .set({
      readerHtml: sanitizedHtml,
      readerText: text,
      // Mirror to the legacy column so the existing reader page renders.
      extractedText: text,
      extractedAt: new Date(),
      readMinutes,
      paywalled,
      readerState: "ready",
      readerFetchedAt: new Date(),
      // If the metadata pass missed a title (unlikely but possible), fill it
      // from Readability's heuristic.
      ogTitle: sql`COALESCE(${schema.captureSources.ogTitle}, ${article.title ?? null})`,
    })
    .where(eq(schema.captureSources.id, captureId));

  return { ok: true, reason: "ok", state: "ready" };
}

async function markFailed(captureId: string, reason: string): Promise<void> {
  await db
    .update(schema.captureSources)
    .set({
      readerState: "failed",
      readerFetchedAt: new Date(),
      metadataLastError: reason,
    })
    .where(eq(schema.captureSources.id, captureId));
}

/**
 * Allow-list HTML sanitizer. Walks the parsed document, drops disallowed
 * tags + all event handler / javascript: URL attributes. Output is safe to
 * render with `dangerouslySetInnerHTML` server-side.
 */
export function sanitize(html: string, baseUrl: string): string {
  if (!html) return "";
  const { document } = parseHTML(`<div>${html}</div>`);
  const root = document.querySelector("div");
  if (!root) return "";

  const walker = document.createTreeWalker(root, 0x1 /* SHOW_ELEMENT */);
  const toRemove: Element[] = [];
  let node: Node | null = walker.currentNode;
  while (node) {
    if (node.nodeType === 1) {
      const el = node as Element;
      const tag = el.tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) {
        toRemove.push(el);
      } else {
        // Strip disallowed attrs.
        const allow = ALLOWED_ATTRS[tag] ?? new Set<string>();
        for (const name of Array.from(el.getAttributeNames())) {
          if (!allow.has(name) || name.startsWith("on")) {
            el.removeAttribute(name);
            continue;
          }
          const value = el.getAttribute(name) ?? "";
          if (
            (name === "href" || name === "src") &&
            /^\s*javascript:/i.test(value)
          ) {
            el.removeAttribute(name);
            continue;
          }
          if (name === "href" || name === "src") {
            try {
              const abs = new URL(value, baseUrl).toString();
              el.setAttribute(name, abs);
            } catch {
              el.removeAttribute(name);
            }
          }
        }
        if (tag === "a") {
          el.setAttribute("rel", "noopener noreferrer nofollow");
          el.setAttribute("target", "_blank");
        }
      }
    }
    node = walker.nextNode();
  }

  for (const el of toRemove) {
    // Replace with text content so we don't lose body copy when the parent
    // tag is something like <article> or <section>.
    const text = el.textContent ?? "";
    if (text && el.parentNode) {
      el.parentNode.replaceChild(document.createTextNode(text), el);
    } else {
      el.remove();
    }
  }
  return root.innerHTML;
}

// ---------- batch runner ----------

export interface RunReaderBatchOptions {
  limit?: number;
  workspaceId?: string;
}

export interface ReaderBatchReport {
  scanned: number;
  ready: number;
  failed: number;
  skipped: number;
}

export async function runReaderBatch(
  opts: RunReaderBatchOptions = {},
): Promise<ReaderBatchReport> {
  const limit = opts.limit ?? 50;
  const conditions = [
    eq(schema.captureSources.kind, "url"),
    inArray(schema.captureSources.readerState, ["pending", "failed"]),
  ];
  if (opts.workspaceId) {
    conditions.push(eq(schema.captureSources.workspaceId, opts.workspaceId));
  }
  const rows = await db
    .select({ id: schema.captureSources.id })
    .from(schema.captureSources)
    .where(and(...conditions))
    .limit(limit);

  const report: ReaderBatchReport = {
    scanned: rows.length,
    ready: 0,
    failed: 0,
    skipped: 0,
  };
  for (const r of rows) {
    const result = await extractReader(r.id);
    if (result.state === "ready") report.ready++;
    else if (result.state === "failed" || result.state === "paywalled") report.failed++;
    else report.skipped++;
  }
  return report;
}

/**
 * Touch hook: marks reader_state = 'pending' if not already terminal, so the
 * worker (or the caller's awaited `extractReader`) picks it up. Used by the
 * "user opened the bookmark" beacon.
 */
export async function markReaderPending(captureId: string): Promise<void> {
  await db
    .update(schema.captureSources)
    .set({ readerState: "pending" })
    .where(
      and(
        eq(schema.captureSources.id, captureId),
        inArray(schema.captureSources.readerState, ["failed"]),
        // Re-attempt failed rows older than a day; don't churn fresh failures.
        lt(schema.captureSources.readerFetchedAt, new Date(Date.now() - 86_400_000)),
      ),
    );
}
