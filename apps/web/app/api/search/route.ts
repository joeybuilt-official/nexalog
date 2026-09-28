// SPDX-License-Identifier: MIT
/**
 * POST /api/search
 *
 * Unified search/filter/sort endpoint for every list-of-things surface in
 * Nexalog (notes, bookmarks, watch, reading, reference). One client component
 * (`<ContentFinder />`) calls this; one ranking pipeline answers.
 *
 * Ranking when `query` is present:
 *   - Lexical: Postgres FTS — `fts @@ plainto_tsquery('english', q)` ranked by
 *     `ts_rank_cd`. The `fts` column is a stored generated tsvector with
 *     A/B/C/D weighting on og_title / og_description+summary / extracted_text
 *     / url (migration 0003). Falls back to ILIKE if the column isn't present
 *     (older schemas). Notes carry their own `fts` (0013).
 *   - Semantic: GBrain's MCP `search` + `query` tools (hybrid vector+keyword,
 *     then concept/synonym expansion), deduped by slug. The brain index is
 *     bound to the brain repo (`/brain/pages`), so its hits are pages — never
 *     `capture_sources` rows.
 *   - Fusion: Reciprocal Rank Fusion (k=60) over ALL THREE lists — brain
 *     pages (semantic), saved links (lexical) and notes (lexical) — so a
 *     bookmark body and a brain page answer the same query in one ranked
 *     list. GBrain having hits must never *replace* the bookmark/note
 *     branches; it adds to them. A GBrain transport/auth failure (or an
 *     unconfigured client) degrades to lexical-only and reports
 *     `rankingMode: "lexical"`.
 *
 * AI-assist suggestion rail (3 forms):
 *   1. Spell/typo — query has zero results -> propose corrections via Plexo
 *      Haiku-class completion.
 *   2. Filter compaction — > 50 results -> propose narrowing facet.
 *   3. Theme expand — top result lands in a theme -> propose `themeIds=[..]`.
 *
 * URL state lives on the client; this endpoint is stateless.
 */
export const dynamic = "force-dynamic";

import { getAuthUser } from "@/lib/auth/server";
import { logEvent } from "@/lib/logger";
import { db, schema } from "@/lib/db";
import { getComposition } from "@/composition";
import { getUserWorkspaces } from "@/lib/workspace";
import { displayTitle, noteDisplayTitle } from "@/lib/captures/display";
import { brainPageHref } from "@/lib/search/result-href";
import {
  and,
  eq,
  ne,
  inArray,
  isNotNull,
  isNull,
  gte,
  desc,
  asc,
  sql,
  or,
  ilike,
  exists,
} from "drizzle-orm";

const SURFACES = [
  "notes",
  "bookmarks",
  "video",
  "article",
  "reference",
  "social",
  "homepage",
] as const;
type Surface = (typeof SURFACES)[number];

const SORT_KEYS = [
  "relevance",
  "recency",
  "last_opened",
  "staleness_desc",
  "theme_growth",
] as const;
type Sort = (typeof SORT_KEYS)[number];

const AGE_RANGES = ["today", "7d", "30d", "90d", "1y", "all"] as const;
type AgeRange = (typeof AGE_RANGES)[number];

interface SearchBody {
  surfaces?: Surface[];
  query?: string;
  filters?: {
    themeIds?: string[];
    themeLabels?: string[];
    regions?: string[];
    captureIds?: string[];
    tagIds?: string[];
    ageRange?: AgeRange;
    evergreen?: boolean;
    opened?: boolean;
    paywalled?: boolean;
    hasReader?: boolean;
  };
  sort?: Sort;
  limit?: number;
  cursor?: string;
}

export interface SearchResult {
  id: string;
  kind: "note" | "video" | "article" | "reference" | "social" | "homepage" | "other";
  title: string;
  /**
   * The in-app route for this row, decided HERE (where the row's identity is
   * known) rather than guessed by the client from `kind`.
   *
   * `id` is NOT a uniform key: a note's and a capture's are UUIDs, but a BRAIN
   * page's is its slug (`concepts/litellm-gateway`). Every client used to map
   * "not a note" to `/app/bookmarks/<id>/reader`, so each brain hit 404'd on
   * click. `null` means the row genuinely has no in-app route (open its `url`
   * instead) — never a link to invent.
   */
  href: string | null;
  url: string | null;
  themeLabel: string | null;
  themeRegion: string | null;
  themeId: string | null;
  openedAt: string | null;
  evergreen: boolean | null;
  paywalled: boolean | null;
  readMinutes: number | null;
  watchMinutes: number | null;
  summary: string | null;
  ogImage: string | null;
  faviconUrl: string | null;
  urlHost: string | null;
  createdAt: string;
  score: number;
  snippet: string | null;
}

export interface ThemeHit {
  themeId: string;
  themeLabel: string;
  count: number;
}

export interface SearchResponse {
  results: SearchResult[];
  themes?: ThemeHit[];
  facets: {
    totalsByKind: Record<string, number>;
    totalsByRegion: Record<string, number>;
    totalsByAge: Record<string, number>;
  };
  suggestions: Array<{
    label: string;
    action: "addFilter" | "replaceQuery" | "changeSort";
    payload: Record<string, unknown>;
  }>;
  total: number;
  nextCursor?: string;
  rankingMode: "hybrid" | "lexical" | "recency";
}

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 2000;
const RRF_K = 60;

function ageCutoff(range: AgeRange | undefined): Date | null {
  if (!range || range === "all") return null;
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  switch (range) {
    case "today":
      return new Date(now - day);
    case "7d":
      return new Date(now - 7 * day);
    case "30d":
      return new Date(now - 30 * day);
    case "90d":
      return new Date(now - 90 * day);
    case "1y":
      return new Date(now - 365 * day);
    default:
      return null;
  }
}

function ageBucket(d: Date): keyof SearchResponse["facets"]["totalsByAge"] {
  const ms = Date.now() - d.getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days < 1) return "today";
  if (days < 7) return "7d";
  if (days < 30) return "30d";
  if (days < 90) return "90d";
  if (days < 365) return "1y";
  return "all";
}

function makeSnippet(text: string | null | undefined, query: string): string | null {
  if (!text) return null;
  const stripped = text.replace(/\s+/g, " ").trim();
  if (!query) return stripped.slice(0, 180);
  const q = query.trim().toLowerCase();
  const idx = stripped.toLowerCase().indexOf(q);
  if (idx < 0) return stripped.slice(0, 180);
  const start = Math.max(0, idx - 60);
  const end = Math.min(stripped.length, idx + q.length + 120);
  return (start > 0 ? "…" : "") + stripped.slice(start, end) + (end < stripped.length ? "…" : "");
}

/**
 * Map a GBrain page type onto the SearchResult kind union. GBrain owns the
 * page taxonomy (person/company/project/concept/note/atom/source/…); the UI
 * only distinguishes note vs reference-ish kinds, so everything non-note
 * collapses to "reference" and anything unrecognized to "other".
 */
function gbrainTypeToKind(type: string | null | undefined): SearchResult["kind"] {
  switch ((type ?? "").toLowerCase()) {
    case "note":
      return "note";
    case "person":
    case "company":
    case "project":
    case "concept":
    case "atom":
    case "source":
      return "reference";
    default:
      return "other";
  }
}

// Row→SearchResult mappers, shared by the lexical branches and the pgvector
// recall-union branch so semantically-surfaced rows render identically.
function captureToResult(
  r: typeof schema.captureSources.$inferSelect,
  query: string
): SearchResult {
  return {
    id: r.id,
    kind: (r.kindClassified ?? "other") as SearchResult["kind"],
    // Always go through displayTitle so raw URLs / video ids / filenames
    // never escape into the search results UI.
    title: displayTitle(r),
    // A capture's id IS the uuid its reader route takes.
    href: `/app/bookmarks/${r.id}/reader`,
    url: r.url,
    themeLabel: r.themeLabel,
    themeRegion: r.themeRegion,
    themeId: r.themeId,
    openedAt: r.openedAt ? r.openedAt.toISOString() : null,
    evergreen: r.evergreen,
    paywalled: r.paywalled,
    readMinutes: r.readMinutes,
    watchMinutes: r.watchMinutes,
    summary: r.summary,
    ogImage: r.ogImage,
    faviconUrl: r.faviconUrl,
    urlHost: r.urlHost,
    // Display & sort use the user's effective save date — fall back to the
    // row insert time when the import didn't preserve one.
    createdAt: (r.bookmarkedAt ?? r.createdAt).toISOString(),
    score: 0,
    snippet: makeSnippet(r.summary ?? r.ogDescription ?? r.extractedText, query),
  };
}

function noteToResult(
  n: typeof schema.notes.$inferSelect,
  query: string
): SearchResult {
  return {
    id: n.id,
    kind: "note",
    title: noteDisplayTitle(n.title, n.content),
    href: `/app/notes/${n.id}`,
    url: null,
    themeLabel: null,
    themeRegion: null,
    themeId: null,
    openedAt: null,
    evergreen: null,
    paywalled: null,
    readMinutes: null,
    watchMinutes: null,
    summary: null,
    ogImage: null,
    faviconUrl: null,
    urlHost: null,
    createdAt: n.updatedAt.toISOString(),
    score: 0,
    snippet: makeSnippet(n.content.replace(/<[^>]+>/g, " "), query),
  };
}

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  logEvent("route.start", { route: "/api/search", method: "POST" });

  let body: SearchBody;
  try {
    body = (await request.json()) as SearchBody;
  } catch {
    body = {};
  }

  const surfaces: Surface[] =
    body.surfaces && body.surfaces.length > 0
      ? body.surfaces.filter((s): s is Surface => SURFACES.includes(s))
      : ["notes", "bookmarks"];

  // bookmarks expands to all url-kind surfaces EXCEPT video — videos have a
  // dedicated Watch surface, so they shouldn't also appear in Bookmarks.
  const includeNotes = surfaces.includes("notes");
  const captureKinds = new Set<string>();
  for (const s of surfaces) {
    if (s === "bookmarks") {
      ["article", "reference", "social", "homepage", "other"].forEach((k) =>
        captureKinds.add(k)
      );
    } else if (s !== "notes") {
      captureKinds.add(s);
    }
  }

  const query = (body.query ?? "").trim();
  const filters = body.filters ?? {};
  const sort: Sort = body.sort ?? (query ? "relevance" : "recency");
  const limit = Math.max(1, Math.min(MAX_LIMIT, body.limit ?? DEFAULT_LIMIT));
  const cursor = body.cursor ? Number(body.cursor) || 0 : 0;

  const workspaces = await getUserWorkspaces(user.id);
  if (!workspaces.length) {
    return Response.json({
      results: [],
      facets: { totalsByKind: {}, totalsByRegion: {}, totalsByAge: {} },
      suggestions: [],
      total: 0,
      rankingMode: "recency" as const,
    } satisfies SearchResponse);
  }
  const workspace = workspaces[0];

  // ── GBrain (preferred) semantic search ────────────────────────────────────
  // Phase 2b: when GBrain is reachable, search the brain's hybrid index first
  // (search → query for concept/synonym recall, unioned + deduped by slug).
  // GBrain owns index/embeddings/graph; Nexalog only calls its MCP. On any
  // transport/auth failure — or an empty result set — we degrade to the
  // fs-frontmatter scan (brainIndex) and then the lexical pipeline below.
  //
  // FUSION, NEVER SUBSTITUTION. This branch used to `return` as soon as GBrain
  // had a single hit, which made the two corpora mutually exclusive per query:
  // GBrain's index is bound to the brain repo (`/brain/pages`) and can never
  // contain a `capture_sources` row, so answering with brain pages *replaced*
  // every bookmark and note instead of ranking alongside them. Brain hits are
  // now carried into the RRF fusion below as the semantic list.
  const gbrainRows: SearchResult[] = [];
  const gbrainRankById = new Map<string, number>();
  if (query && getComposition().gbrain) {
    const gbrain = getComposition().gbrain!;
    try {
      const bySlug = new Map<string, { slug: string; title: string; type: string; chunkText: string; effectiveDate: string | null }>();
      const cheap = await gbrain.search(query, { limit: Math.min(limit, 50) });
      for (const h of cheap) if (!bySlug.has(h.slug)) bySlug.set(h.slug, h);
      const expanded = await gbrain.query(query, { limit: Math.min(limit, 50) });
      for (const h of expanded) if (!bySlug.has(h.slug)) bySlug.set(h.slug, h);

      for (const h of bySlug.values()) {
        gbrainRows.push({
          id: h.slug,
          kind: gbrainTypeToKind(h.type),
          title: h.title || h.slug,
          // THE fix: a brain page is addressed by its SLUG, not a uuid. This is
          // the route /app/brain serves (catch-all — slugs are paths).
          href: brainPageHref(h.slug),
          url: null,
          themeLabel: null,
          themeRegion: null,
          themeId: null,
          openedAt: null,
          evergreen: null,
          paywalled: null,
          readMinutes: null,
          watchMinutes: null,
          summary: h.chunkText.slice(0, 280),
          ogImage: null,
          faviconUrl: null,
          urlHost: null,
          createdAt: h.effectiveDate ?? new Date().toISOString(),
          score: 1,
          snippet: makeSnippet(h.chunkText, query),
        });
        // Deduped-by-slug insertion order IS the semantic rank (1-based).
        gbrainRankById.set(h.slug, gbrainRankById.size + 1);
      }
    } catch (e) {
      logEvent("search.gbrain.error", { error: String(e) });
    }

    // GBrain returned nothing — try the fs-frontmatter scan (NullIndex) as a
    // second semantic source. Only reached when GBrain itself produced no
    // hits, so a working GBrain still short-circuits the (slower) disk scan.
    if (gbrainRows.length === 0) {
      try {
        const brainIndex = getComposition().brainIndex;
        const fsHits = await brainIndex.search(query, { limit: Math.min(limit, 50) });
        for (const h of fsHits) {
          gbrainRows.push({
            id: h.slug,
            kind: "note" as const,
            title: h.title,
            // The fs scan returns brain-repo slugs too — same route as a
            // GBrain hit. Mapping these to /app/notes/<slug> was the same 404.
            href: brainPageHref(h.slug),
            url: null,
            themeLabel: null,
            themeRegion: null,
            themeId: null,
            openedAt: null,
            evergreen: null,
            paywalled: null,
            readMinutes: null,
            watchMinutes: null,
            summary: h.snippet.slice(0, 280),
            ogImage: null,
            faviconUrl: null,
            urlHost: null,
            createdAt: new Date().toISOString(),
            score: 0,
            snippet: h.snippet,
          });
          gbrainRankById.set(h.slug, gbrainRankById.size + 1);
        }
      } catch {
        // fall through to the lexical pipeline
      }
    }
  }

  // ── Captures branch ───────────────────────────────────────────────────────
  const captureRows: SearchResult[] = [];
  // Per-row lexical rank from Postgres FTS when query is present.
  const ftsRankById = new Map<string, number>();
  let ftsAvailable = false;
  if (captureKinds.size > 0) {
    const conds = [
      eq(schema.captureSources.workspaceId, workspace.id),
      ne(schema.captureSources.state, "archived"),
      isNotNull(schema.captureSources.url),
      isNull(schema.captureSources.smartArchivedAt),
      inArray(schema.captureSources.kindClassified, [...captureKinds]),
    ];
    if (filters.evergreen === true) conds.push(eq(schema.captureSources.evergreen, true));
    if (filters.evergreen === false) {
      conds.push(
        sql`(${schema.captureSources.evergreen} IS NULL OR ${schema.captureSources.evergreen} = false)`
      );
    }
    if (filters.opened === true) conds.push(isNotNull(schema.captureSources.openedAt));
    if (filters.opened === false) conds.push(isNull(schema.captureSources.openedAt));
    if (filters.paywalled === true) conds.push(eq(schema.captureSources.paywalled, true));
    if (filters.hasReader === true) conds.push(isNotNull(schema.captureSources.extractedText));

    const cutoff = ageCutoff(filters.ageRange);
    // Age filter operates on the user's effective save date so imports
    // with preserved `bookmarked_at` aren't all classified as "today".
    // ISO + ::timestamptz: a raw Date bind through postgres-js throws
    // "Received an instance of Date" because the typed column hint that
    // `gte(col, date)` carries is lost inside a free-form sql`` template.
    if (cutoff)
      conds.push(
        sql`COALESCE(${schema.captureSources.bookmarkedAt}, ${schema.captureSources.createdAt}) >= ${cutoff.toISOString()}::timestamptz`,
      );

    if (filters.themeIds && filters.themeIds.length > 0) {
      conds.push(inArray(schema.captureSources.themeId, filters.themeIds));
    }
    if (filters.themeLabels && filters.themeLabels.length > 0) {
      conds.push(inArray(schema.captureSources.themeLabel, filters.themeLabels));
    }
    if (filters.regions && filters.regions.length > 0) {
      conds.push(inArray(schema.captureSources.themeRegion, filters.regions));
    }
    if (filters.captureIds && filters.captureIds.length > 0) {
      conds.push(inArray(schema.captureSources.id, filters.captureIds));
    }
    if (filters.tagIds && filters.tagIds.length > 0) {
      // Controlled-vocabulary tag facet: keep captures carrying any of these tags.
      conds.push(
        exists(
          db
            .select({ x: sql`1` })
            .from(schema.captureSourceTags)
            .where(
              and(
                eq(schema.captureSourceTags.captureSourceId, schema.captureSources.id),
                inArray(schema.captureSourceTags.tagId, filters.tagIds)
              )
            )
        )
      );
    }

    let rows: typeof schema.captureSources.$inferSelect[] = [];

    if (query) {
      // Try FTS first. If the column doesn't exist (older schema), fall back
      // to ILIKE without a rank — the JS-side rank in the RRF block still
      // produces sane ordering.
      try {
        const ftsRows = await db
          .select({
            row: schema.captureSources,
            rank: sql<number>`ts_rank_cd(${schema.captureSources}.fts, plainto_tsquery('english', ${query}))`,
          })
          .from(schema.captureSources)
          .where(
            and(
              ...conds,
              sql`${schema.captureSources}.fts @@ plainto_tsquery('english', ${query})`
            )
          )
          .orderBy(
            sql`ts_rank_cd(${schema.captureSources}.fts, plainto_tsquery('english', ${query})) DESC`
          )
          .limit(MAX_LIMIT * 4);
        ftsAvailable = true;
        rows = ftsRows.map((r) => r.row);
        for (const r of ftsRows) ftsRankById.set(r.row.id, Number(r.rank));
      } catch {
        // Column not present yet; do ILIKE.
        const pat = `%${query}%`;
        const fallbackConds = [
          ...conds,
          or(
            ilike(schema.captureSources.ogTitle, pat),
            ilike(schema.captureSources.ogDescription, pat),
            ilike(schema.captureSources.url, pat),
            ilike(schema.captureSources.content, pat),
            ilike(schema.captureSources.summary, pat),
            ilike(schema.captureSources.extractedText, pat)
          )!,
        ];
        rows = await db
          .select()
          .from(schema.captureSources)
          .where(and(...fallbackConds))
          .orderBy(
            sql`COALESCE(${schema.captureSources.bookmarkedAt}, ${schema.captureSources.createdAt}) DESC`,
          )
          .limit(MAX_LIMIT * 4);
      }
    } else {
      rows = await db
        .select()
        .from(schema.captureSources)
        .where(and(...conds))
        .orderBy(desc(schema.captureSources.createdAt))
        .limit(MAX_LIMIT * 4);
    }

    for (const r of rows) captureRows.push(captureToResult(r, query));
  }

  // ── Notes branch ──────────────────────────────────────────────────────────
  const noteRows: SearchResult[] = [];
  // Per-row lexical rank from Postgres FTS (notes.fts) when query is present.
  const noteFtsRankById = new Map<string, number>();
  let noteFtsAvailable = false;
  if (includeNotes) {
    const conds = [
      eq(schema.notes.workspaceId, workspace.id),
      isNull(schema.notes.deletedAt),
      // Exclude bookmark-twin notes: every saved URL mints a notes row
      // (capture/route.ts). Those belong on the Bookmarks surface, not Notes.
      sql`NOT EXISTS (SELECT 1 FROM ${schema.captureSources} cs WHERE cs.note_id = ${schema.notes.id} AND cs.kind = 'url')`,
    ];
    const cutoff = ageCutoff(filters.ageRange);
    if (cutoff) conds.push(gte(schema.notes.updatedAt, cutoff));

    let rows: typeof schema.notes.$inferSelect[] = [];

    if (query) {
      // Try FTS first (notes.fts generated tsvector — see 0013_notes_fts.sql).
      // If the column doesn't exist (older schema), fall back to ILIKE; the
      // JS-side rank in the RRF block still produces sane ordering.
      try {
        const ftsRows = await db
          .select({
            row: schema.notes,
            rank: sql<number>`ts_rank_cd(${schema.notes}.fts, websearch_to_tsquery('english', ${query}))`,
          })
          .from(schema.notes)
          .where(
            and(
              ...conds,
              sql`${schema.notes}.fts @@ websearch_to_tsquery('english', ${query})`
            )
          )
          .orderBy(
            sql`ts_rank_cd(${schema.notes}.fts, websearch_to_tsquery('english', ${query})) DESC`
          )
          .limit(MAX_LIMIT * 2);
        noteFtsAvailable = true;
        rows = ftsRows.map((r) => r.row);
        for (const r of ftsRows) noteFtsRankById.set(r.row.id, Number(r.rank));
      } catch {
        const pat = `%${query}%`;
        rows = await db
          .select()
          .from(schema.notes)
          .where(
            and(...conds, or(ilike(schema.notes.title, pat), ilike(schema.notes.content, pat))!)
          )
          .orderBy(desc(schema.notes.updatedAt))
          .limit(MAX_LIMIT * 2);
      }
    } else {
      rows = await db
        .select()
        .from(schema.notes)
        .where(and(...conds))
        .orderBy(desc(schema.notes.updatedAt))
        .limit(MAX_LIMIT * 2);
    }

    for (const n of rows) noteRows.push(noteToResult(n, query));
  }

  // ── Hybrid scoring (RRF) ──────────────────────────────────────────────────
  // Three ranked lists now fuse into ONE answer: brain pages (semantic, from
  // GBrain / the fs scan), saved links (`capture_sources.fts`, lexical) and
  // imported notes (`notes.fts`, lexical). "hybrid" is reported whenever a
  // semantic list participated; a GBrain outage falls back to lexical-only and
  // says so.
  const rankingMode: SearchResponse["rankingMode"] = !query
    ? "recency"
    : gbrainRankById.size > 0
      ? "hybrid"
      : "lexical";
  const merged: SearchResult[] = [...captureRows, ...noteRows, ...gbrainRows];

  // ── Semantic branch (pgvector, Path B) ─────────────────────────────────────
  // Embed the query and pull HNSW cosine-nearest captures + notes. Rows that
  // the lexical branches missed are unioned into `merged` (true semantic
  // recall); the distance ranks feed RRF below. Fully guarded: a missing
  // column / down embed server / null vector silently degrades to keyword-only.
  // Recall-union is skipped when restrictive facet filters are active (it would
  // surface rows outside the active facet); the re-rank of already-present rows
  // still applies in that case.
  const vecRank = new Map<string, number>(); // pgvector removed — stays empty until BrainIndex (Phase 2)
  if (query) {
    const hasFacets = Boolean(
      filters.evergreen !== undefined ||
        filters.opened !== undefined ||
        filters.paywalled !== undefined ||
        filters.hasReader !== undefined ||
        filters.ageRange ||
        (filters.themeIds && filters.themeIds.length) ||
        (filters.themeLabels && filters.themeLabels.length) ||
        (filters.regions && filters.regions.length) ||
        (filters.captureIds && filters.captureIds.length) ||
        (filters.tagIds && filters.tagIds.length)
    );
    // pgvector semantic hits removed with embeddings (v2: BrainIndex)

  }

  if (query) {
    // Lexical rank: prefer Postgres ts_rank_cd when the FTS column was
    // available. Otherwise compute a cheap JS-side title/summary rank.
    const lexRank = new Map<string, number>();
    if (
      (ftsAvailable && ftsRankById.size > 0) ||
      (noteFtsAvailable && noteFtsRankById.size > 0)
    ) {
      // Fuse the capture and note FTS ranks into one ordered lexical list by
      // descending ts_rank_cd, then assign 1-based positions for RRF.
      const lexScored = [
        ...ftsRankById.entries(),
        ...noteFtsRankById.entries(),
      ]
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => id);
      lexScored.forEach((id, i) => lexRank.set(id, i + 1));
    } else {
      // JS-side lexical fallback — over the LEXICAL rows only. Brain hits are
      // already ranked by `semRank` and must not be scored twice (or be the
      // only reason a query looks lexical).
      const lexScored = [...captureRows, ...noteRows]
        .map((r) => {
          const haystack = `${r.title} ${r.snippet ?? ""} ${r.url ?? ""}`.toLowerCase();
          const q = query.toLowerCase();
          let s = 0;
          if (r.title.toLowerCase().includes(q)) s += 3;
          if ((r.snippet ?? "").toLowerCase().includes(q)) s += 1;
          if (haystack.split(q).length - 1 > 1) s += 1;
          return { id: r.id, lex: s };
        })
        .sort((a, b) => b.lex - a.lex);
      lexScored.forEach((x, i) => lexRank.set(x.id, i + 1));
    }

    // Semantic rank — the brain list from GBrain / the fs scan (slug-keyed,
    // insertion order = rank). Empty when GBrain is unconfigured or failed,
    // which is exactly the old lexical-only behaviour.
    const semRank: Map<string, number> | null = gbrainRankById;

    for (const r of merged) {
      const lr = lexRank.get(r.id);
      const sr: number | undefined = semRank?.get(r.id) ?? undefined;
      const vr: number | undefined = undefined; // vecRank unused until BrainIndex (Phase 2)
      let score = 0;
      if (lr) score += 1 / (RRF_K + lr);
      if (sr) score += 1 / (RRF_K + sr);
      if (vr) score += 1 / (RRF_K + vr);
      // tiny recency bias to break ties
      score += Math.max(0, 1 - (Date.now() - new Date(r.createdAt).getTime()) / (365 * 24 * 60 * 60 * 1000)) * 1e-6;
      r.score = score;
    }
  }

  // ── Sort ──────────────────────────────────────────────────────────────────
  const sorted = [...merged].sort((a, b) => {
    switch (sort) {
      case "relevance":
        if (b.score !== a.score) return b.score - a.score;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      case "recency":
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      case "last_opened": {
        const ax = a.openedAt ? new Date(a.openedAt).getTime() : 0;
        const bx = b.openedAt ? new Date(b.openedAt).getTime() : 0;
        return bx - ax;
      }
      case "staleness_desc":
        // we don't carry staleness in the result — proxy via inverse openedAt
        return (a.openedAt ? new Date(a.openedAt).getTime() : 0) -
          (b.openedAt ? new Date(b.openedAt).getTime() : 0);
      case "theme_growth":
        // theme_growth needs forest data — punted; fall back to recency
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      default:
        return 0;
    }
  });

  // ── Facets (computed BEFORE pagination) ───────────────────────────────────
  const totalsByKind: Record<string, number> = {};
  const totalsByRegion: Record<string, number> = {};
  const totalsByAge: Record<string, number> = {};
  for (const r of sorted) {
    totalsByKind[r.kind] = (totalsByKind[r.kind] ?? 0) + 1;
    if (r.themeRegion) {
      totalsByRegion[r.themeRegion] = (totalsByRegion[r.themeRegion] ?? 0) + 1;
    }
    const bucket = ageBucket(new Date(r.createdAt));
    totalsByAge[bucket] = (totalsByAge[bucket] ?? 0) + 1;
  }

  // ── Pagination via numeric cursor ─────────────────────────────────────────
  const sliced = sorted.slice(cursor, cursor + limit);
  const total = sorted.length;
  const nextCursor =
    cursor + limit < total ? String(cursor + limit) : undefined;

  // ── AI-assist suggestion rail ─────────────────────────────────────────────
  const suggestions: SearchResponse["suggestions"] = [];

  // 2. Filter compaction — too many results
  if (sorted.length > 50 && query) {
    const top = Object.entries(totalsByKind)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2);
    for (const [kind, count] of top) {
      if (count < sorted.length && count > 0) {
        suggestions.push({
          label: `Narrow to ${kind} (${count})`,
          action: "addFilter",
          payload: {
            surfaces: kind === "note" ? ["notes"] : [kind],
          },
        });
      }
    }
  }

  // 3. Theme expand — top result has a theme
  const topThemed = sliced.find((r) => r.themeId && r.themeLabel);
  if (topThemed && topThemed.themeId && !filters.themeIds?.includes(topThemed.themeId)) {
    suggestions.push({
      label: `Show all in ${topThemed.themeLabel}`,
      action: "addFilter",
      payload: { themeIds: [topThemed.themeId] },
    });
  }



  // Theme matches — distinct themeLabels on the user's captures matching the
  // query. memory_themes is unpopulated locally, so themeLabel/themeId on
  // capture_sources is the queryable surface. Lets Find jump straight to a
  // theme (graph cluster) rather than only individual items.
  let themes: ThemeHit[] = [];
  if (query) {
    try {
      const themeRows = await db
        .select({
          themeId: schema.captureSources.themeId,
          themeLabel: schema.captureSources.themeLabel,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.captureSources)
        .where(
          and(
            eq(schema.captureSources.workspaceId, workspace.id),
            isNotNull(schema.captureSources.themeId),
            isNotNull(schema.captureSources.themeLabel),
            ilike(schema.captureSources.themeLabel, `%${query}%`),
          ),
        )
        .groupBy(schema.captureSources.themeId, schema.captureSources.themeLabel)
        .orderBy(desc(sql`count(*)`))
        .limit(5);
      themes = themeRows
        .filter((r): r is ThemeHit => !!r.themeId && !!r.themeLabel)
        .map((r) => ({ themeId: r.themeId!, themeLabel: r.themeLabel!, count: r.count }));
    } catch {
      // non-fatal — themes are a bonus surface
    }
  }

  return Response.json({
    results: sliced,
    themes,
    facets: { totalsByKind, totalsByRegion, totalsByAge },
    suggestions,
    total,
    nextCursor,
    rankingMode,
  } satisfies SearchResponse);
}
