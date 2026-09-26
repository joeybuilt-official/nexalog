// Phase 11 pass 2 — theme forest. Hierarchical category nav: region → theme → subtheme.
//
// Strategy:
//   1. Try Plexo /api/v1/themes/forest (Alpha's endpoint). If shipped + non-empty, use it.
//   2. Fall back to a deterministic local forest derived from capture host families
//      and path keywords. Stable, no LLM, ~9 regions / ~22 subthemes.
//
// This file is the single source of truth for "which categories exist" — both the
// bookmarks page (sidebar) and the queue (cross-kind bonuses) read from here.

import { db, schema } from "@/lib/db";
import { eq, and, isNotNull, ne, desc } from "drizzle-orm";

const PLEXO_URL = process.env.PLEXO_URL?.replace(/\/$/, "") ?? "";
const PLEXO_SERVICE_KEY = process.env.PLEXO_SERVICE_KEY ?? "";

export interface ForestSubtheme {
  id: string;
  label: string;
  count: number;
  memberIds: string[]; // capture_source ids in this subtheme
}

export interface ForestTheme {
  id: string;
  label: string;
  count: number;
  subthemes: ForestSubtheme[];
}

export interface ForestRegion {
  id: string;
  label: string;
  color: string; // hex; theme dot in sidebar
  count: number;
  themes: ForestTheme[];
}

export interface Forest {
  source: "plexo" | "local" | "semantic";
  regions: ForestRegion[];
  totalCaptures: number;
}

// ── Plexo path ─────────────────────────────────────────────────────────────────

// Canonical Alpha shape (flat) from /api/v1/themes/forest. We project into
// the nested shape this module exposes.
interface PlexoFlatForest {
  regions?: Array<{ id: string; label: string; size?: number }>;
  themes?: Array<{ id: string; label: string; parentId: string | null; size?: number }>;
  subthemes?: Array<{ id: string; label: string; parentId: string | null; size?: number }>;
  members?: Array<{
    id: string;
    label?: string;
    kind?: string;
    themeId?: string | null;
    subthemeId?: string | null;
    regionId?: string | null;
  }>;
}

async function fetchPlexoForest(plexoWorkspaceId: string): Promise<Forest | null> {
  if (!PLEXO_URL || !PLEXO_SERVICE_KEY) return null;
  try {
    const res = await fetch(
      `${PLEXO_URL}/api/v1/themes/forest?workspaceId=${plexoWorkspaceId}`,
      {
        headers: {
          Authorization: `Bearer ${PLEXO_SERVICE_KEY}`,
          "X-App-Id": "nexalog",
        },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as PlexoFlatForest;
    if (!data.regions || data.regions.length === 0) return null;

    // Project flat → nested. Members land under subtheme if they have one,
    // else directly under their theme via a synthetic "All" subtheme bucket.
    const themesByParent = new Map<string, PlexoFlatForest["themes"]>();
    for (const t of data.themes ?? []) {
      const key = t.parentId ?? "__root__";
      const arr = themesByParent.get(key) ?? [];
      arr.push(t);
      themesByParent.set(key, arr);
    }
    const subthemesByParent = new Map<string, PlexoFlatForest["subthemes"]>();
    for (const s of data.subthemes ?? []) {
      const key = s.parentId ?? "__root__";
      const arr = subthemesByParent.get(key) ?? [];
      arr.push(s);
      subthemesByParent.set(key, arr);
    }
    const membersBySubtheme = new Map<string, string[]>();
    const membersByTheme = new Map<string, string[]>();
    for (const m of data.members ?? []) {
      if (m.subthemeId) {
        const arr = membersBySubtheme.get(m.subthemeId) ?? [];
        arr.push(m.id);
        membersBySubtheme.set(m.subthemeId, arr);
      } else if (m.themeId) {
        const arr = membersByTheme.get(m.themeId) ?? [];
        arr.push(m.id);
        membersByTheme.set(m.themeId, arr);
      }
    }

    let totalCaptures = 0;
    const regions: ForestRegion[] = data.regions.map((r, i) => {
      const themesForRegion = themesByParent.get(r.id) ?? [];
      const themes: ForestTheme[] = themesForRegion.map((t) => {
        const subthemesForTheme = subthemesByParent.get(t.id) ?? [];
        const subthemes: ForestSubtheme[] = subthemesForTheme.map((s) => {
          const ids = membersBySubtheme.get(s.id) ?? [];
          totalCaptures += ids.length;
          return { id: s.id, label: s.label, count: ids.length, memberIds: ids };
        });
        const directIds = membersByTheme.get(t.id) ?? [];
        if (directIds.length > 0) {
          totalCaptures += directIds.length;
          subthemes.push({
            id: `${t.id}.all`,
            label: "All",
            count: directIds.length,
            memberIds: directIds,
          });
        }
        const count = subthemes.reduce((acc, s) => acc + s.count, 0);
        return { id: t.id, label: t.label, count, subthemes };
      });
      const count = themes.reduce((acc, t) => acc + t.count, 0);
      return {
        id: r.id,
        label: r.label,
        color: REGION_COLORS[i % REGION_COLORS.length],
        count,
        themes,
      };
    });

    return { source: "plexo", regions, totalCaptures };
  } catch {
    return null;
  }
}

// ── Local fallback ─────────────────────────────────────────────────────────────

const REGION_COLORS = [
  "#C07040", // copper
  "#7B5BB6", // synthesis violet
  "#5BA88E", // moss
  "#D89B3E", // amber
  "#5078B4", // cobalt
  "#B45078", // berry
  "#8A8078", // walnut
  "#6FB45A", // green
  "#A05830", // copper-dim
];

interface RegionSpec {
  id: string;
  label: string;
  color: string;
  themes: Array<{
    id: string;
    label: string;
    subthemes: Array<{
      id: string;
      label: string;
      hostMatch?: RegExp[];
      pathMatch?: RegExp[];
      titleMatch?: RegExp[];
    }>;
  }>;
}

// Hand-tuned families. Each capture is assigned to the FIRST matching subtheme;
// unmatched captures land in a per-region "Other" bucket (created lazily).
const REGION_SPECS: RegionSpec[] = [
  {
    id: "tech",
    label: "Tech & Code",
    color: REGION_COLORS[0],
    themes: [
      {
        id: "tech.ai",
        label: "AI & Agents",
        subthemes: [
          {
            id: "tech.ai.research",
            label: "Research",
            hostMatch: [/^arxiv\.org$/, /^anthropic\.com$/, /^openai\.com$/, /\.deepmind\.com$/],
          },
          {
            id: "tech.ai.tools",
            label: "Tools & Frameworks",
            titleMatch: [/\b(langchain|llamaindex|autogen|crewai|claude\s+code|cursor)\b/i],
          },
          {
            id: "tech.ai.thought",
            label: "Essays & Thought",
            hostMatch: [/^lesswrong\.com$/, /^lilianweng\.github\.io$/, /^simonwillison\.net$/],
          },
        ],
      },
      {
        id: "tech.code",
        label: "Code & Frameworks",
        subthemes: [
          {
            id: "tech.code.docs",
            label: "Docs",
            hostMatch: [/^docs\./, /\.docs\./, /^developer\./, /^api\./, /^developer\.mozilla\.org$/],
          },
          {
            id: "tech.code.repos",
            label: "Repos",
            hostMatch: [/^github\.com$/, /^gitlab\.com$/, /^bitbucket\.org$/],
          },
          {
            id: "tech.code.qa",
            label: "Q&A",
            hostMatch: [/^stackoverflow\.com$/, /^superuser\.com$/, /^serverfault\.com$/],
          },
        ],
      },
      {
        id: "tech.infra",
        label: "Infra & Ops",
        subthemes: [
          {
            id: "tech.infra.cloud",
            label: "Cloud",
            hostMatch: [/aws\.amazon\.com$/, /\.cloud\.google\.com$/, /azure\.microsoft\.com$/, /^vercel\.com$/, /^fly\.io$/, /^railway\.app$/],
          },
          {
            id: "tech.infra.devops",
            label: "DevOps",
            titleMatch: [/\b(kubernetes|docker|terraform|ansible|nginx|caddy|traefik)\b/i],
          },
        ],
      },
    ],
  },
  {
    id: "ideas",
    label: "Ideas & Writing",
    color: REGION_COLORS[1],
    themes: [
      {
        id: "ideas.essays",
        label: "Essays",
        subthemes: [
          {
            id: "ideas.essays.longform",
            label: "Longform",
            hostMatch: [/^paulgraham\.com$/, /^lesswrong\.com$/, /^slatestarcodex\.com$/, /^astralcodexten\.com$/],
          },
          {
            id: "ideas.essays.substack",
            label: "Substack",
            hostMatch: [/\.substack\.com$/, /^substack\.com$/],
          },
          {
            id: "ideas.essays.medium",
            label: "Medium & blogs",
            hostMatch: [/^medium\.com$/, /\.medium\.com$/, /^dev\.to$/, /\.hashnode\./],
          },
        ],
      },
      {
        id: "ideas.news",
        label: "News & Aggregators",
        subthemes: [
          {
            id: "ideas.news.hn",
            label: "Hacker News",
            hostMatch: [/^news\.ycombinator\.com$/, /^hn\.algolia\.com$/],
          },
          {
            id: "ideas.news.reddit",
            label: "Reddit",
            hostMatch: [/^reddit\.com$/, /^old\.reddit\.com$/, /^www\.reddit\.com$/],
          },
        ],
      },
    ],
  },
  {
    id: "video",
    label: "Video & Audio",
    color: REGION_COLORS[2],
    themes: [
      {
        id: "video.youtube",
        label: "YouTube",
        subthemes: [
          { id: "video.youtube.watch", label: "Videos", hostMatch: [/^youtube\.com$/, /^www\.youtube\.com$/, /^youtu\.be$/] },
        ],
      },
      {
        id: "video.other",
        label: "Other Video",
        subthemes: [
          { id: "video.vimeo", label: "Vimeo", hostMatch: [/^vimeo\.com$/, /^www\.vimeo\.com$/] },
          { id: "video.twitch", label: "Twitch", hostMatch: [/^twitch\.tv$/, /^www\.twitch\.tv$/] },
          { id: "video.tiktok", label: "TikTok", hostMatch: [/^tiktok\.com$/, /^www\.tiktok\.com$/] },
        ],
      },
    ],
  },
  {
    id: "social",
    label: "Social",
    color: REGION_COLORS[3],
    themes: [
      {
        id: "social.feeds",
        label: "Feeds",
        subthemes: [
          { id: "social.x", label: "X / Twitter", hostMatch: [/^x\.com$/, /^twitter\.com$/, /^www\.x\.com$/, /^www\.twitter\.com$/] },
          { id: "social.linkedin", label: "LinkedIn", hostMatch: [/^linkedin\.com$/, /^www\.linkedin\.com$/] },
          { id: "social.bsky", label: "Bluesky / Mastodon", hostMatch: [/^bsky\.app$/, /\.mastodon\./, /^mastodon\./] },
        ],
      },
    ],
  },
  {
    id: "biz",
    label: "Business & Money",
    color: REGION_COLORS[4],
    themes: [
      {
        id: "biz.products",
        label: "Products & Companies",
        subthemes: [
          {
            id: "biz.products.pages",
            label: "Product pages",
            titleMatch: [/\b(pricing|features|product|launch)\b/i],
          },
        ],
      },
      {
        id: "biz.finance",
        label: "Finance",
        subthemes: [
          {
            id: "biz.finance.markets",
            label: "Markets",
            titleMatch: [/\b(stocks?|markets?|portfolio|earnings|fed|recession)\b/i],
          },
        ],
      },
    ],
  },
  {
    id: "life",
    label: "Life & Practice",
    color: REGION_COLORS[5],
    themes: [
      {
        id: "life.cooking",
        label: "Cooking",
        subthemes: [
          {
            id: "life.cooking.recipes",
            label: "Recipes",
            titleMatch: [/\b(recipe|cook|bake|braise|sous\s*vide|sourdough)\b/i],
          },
        ],
      },
      {
        id: "life.health",
        label: "Health & Body",
        subthemes: [
          {
            id: "life.health.fitness",
            label: "Fitness & nutrition",
            titleMatch: [/\b(workout|protein|supplement|sleep|fasting|cardio|strength)\b/i],
          },
        ],
      },
      {
        id: "life.home",
        label: "Home & Garden",
        subthemes: [
          {
            id: "life.home.diy",
            label: "DIY & Home",
            titleMatch: [/\b(garden|tool|repair|renovat|landscap|deck|lumber)\b/i],
          },
        ],
      },
    ],
  },
  {
    id: "ref",
    label: "Reference",
    color: REGION_COLORS[6],
    themes: [
      {
        id: "ref.encyclopedia",
        label: "Encyclopedia",
        subthemes: [
          { id: "ref.wikipedia", label: "Wikipedia", hostMatch: [/^en\.wikipedia\.org$/, /^wikipedia\.org$/] },
        ],
      },
    ],
  },
  {
    id: "homepages",
    label: "Homepages",
    color: REGION_COLORS[7],
    themes: [
      {
        id: "homepages.brands",
        label: "Brand homepages",
        subthemes: [{ id: "homepages.brands.all", label: "All" }],
      },
    ],
  },
  {
    id: "misc",
    label: "Other",
    color: REGION_COLORS[8],
    themes: [
      {
        id: "misc.other",
        label: "Other",
        subthemes: [{ id: "misc.other.all", label: "All" }],
      },
    ],
  },
];

interface CaptureRowForBucketing {
  id: string;
  url: string | null;
  urlHost: string | null;
  urlPath: string | null;
  ogTitle: string | null;
  kindClassified: string | null;
}

function bucket(row: CaptureRowForBucketing): {
  regionId: string;
  themeId: string;
  themeLabel: string;
  subthemeId: string;
  subthemeLabel: string;
} {
  const host = (row.urlHost ?? "").toLowerCase();
  const path = (row.urlPath ?? "").toLowerCase();
  const title = (row.ogTitle ?? "").toLowerCase();

  // Homepage kind shortcut
  if (row.kindClassified === "homepage") {
    return {
      regionId: "homepages",
      themeId: "homepages.brands",
      themeLabel: "Brand homepages",
      subthemeId: "homepages.brands.all",
      subthemeLabel: "All",
    };
  }

  for (const region of REGION_SPECS) {
    for (const theme of region.themes) {
      for (const sub of theme.subthemes) {
        const hostHit = sub.hostMatch?.some((re) => re.test(host)) ?? false;
        const pathHit = sub.pathMatch?.some((re) => re.test(path)) ?? false;
        const titleHit = sub.titleMatch?.some((re) => re.test(title)) ?? false;
        if (hostHit || pathHit || titleHit) {
          return {
            regionId: region.id,
            themeId: theme.id,
            themeLabel: theme.label,
            subthemeId: sub.id,
            subthemeLabel: sub.label,
          };
        }
      }
    }
  }

  // Map by classifier kind to a sensible default
  if (row.kindClassified === "video") {
    return {
      regionId: "video",
      themeId: "video.other",
      themeLabel: "Other Video",
      subthemeId: "video.other.misc",
      subthemeLabel: "Other",
    };
  }
  if (row.kindClassified === "social") {
    return {
      regionId: "social",
      themeId: "social.feeds",
      themeLabel: "Feeds",
      subthemeId: "social.feeds.misc",
      subthemeLabel: "Other",
    };
  }
  if (row.kindClassified === "reference") {
    return {
      regionId: "ref",
      themeId: "ref.encyclopedia",
      themeLabel: "Encyclopedia",
      subthemeId: "ref.misc",
      subthemeLabel: "Other",
    };
  }
  if (row.kindClassified === "article") {
    return {
      regionId: "ideas",
      themeId: "ideas.essays",
      themeLabel: "Essays",
      subthemeId: "ideas.essays.misc",
      subthemeLabel: "Other",
    };
  }

  return {
    regionId: "misc",
    themeId: "misc.other",
    themeLabel: "Other",
    subthemeId: "misc.other.all",
    subthemeLabel: "All",
  };
}

async function buildLocalForest(workspaceId: string): Promise<Forest> {
  const rows = await db
    .select({
      id: schema.captureSources.id,
      url: schema.captureSources.url,
      urlHost: schema.captureSources.urlHost,
      urlPath: schema.captureSources.urlPath,
      ogTitle: schema.captureSources.ogTitle,
      kindClassified: schema.captureSources.kindClassified,
    })
    .from(schema.captureSources)
    .where(
      and(
        eq(schema.captureSources.workspaceId, workspaceId),
        ne(schema.captureSources.state, "archived"),
        isNotNull(schema.captureSources.url)
      )
    );

  // region.theme.subtheme -> { label, ids }
  const map = new Map<
    string,
    {
      regionId: string;
      themeId: string;
      themeLabel: string;
      subthemeId: string;
      subthemeLabel: string;
      memberIds: string[];
    }
  >();

  for (const row of rows) {
    const b = bucket(row);
    const key = b.subthemeId;
    let entry = map.get(key);
    if (!entry) {
      entry = { ...b, memberIds: [] };
      map.set(key, entry);
    }
    entry.memberIds.push(row.id);
  }

  const regionMap = new Map<string, ForestRegion>();
  for (const spec of REGION_SPECS) {
    regionMap.set(spec.id, {
      id: spec.id,
      label: spec.label,
      color: spec.color,
      count: 0,
      themes: [],
    });
  }

  // Group entries into theme buckets per region
  const themeBuckets = new Map<string, ForestTheme>();
  for (const e of map.values()) {
    let theme = themeBuckets.get(e.themeId);
    if (!theme) {
      theme = { id: e.themeId, label: e.themeLabel, count: 0, subthemes: [] };
      themeBuckets.set(e.themeId, theme);
      const region = regionMap.get(e.regionId);
      if (region) region.themes.push(theme);
    }
    theme.subthemes.push({
      id: e.subthemeId,
      label: e.subthemeLabel,
      count: e.memberIds.length,
      memberIds: e.memberIds,
    });
    theme.count += e.memberIds.length;
    const region = regionMap.get(e.regionId);
    if (region) region.count += e.memberIds.length;
  }

  // Drop empty regions, sort subthemes by count desc
  const regions = Array.from(regionMap.values())
    .filter((r) => r.count > 0)
    .map((r) => ({
      ...r,
      themes: r.themes
        .map((t) => ({
          ...t,
          subthemes: t.subthemes.sort((a, b) => b.count - a.count),
        }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.count - a.count);

  return { source: "local", regions, totalCaptures: rows.length };
}

// ── Semantic path (P9b) ─────────────────────────────────────────────────────────
// When `memory_themes` is populated (scripts/cluster-themes.ts: k-means over the
// pgvector embeddings, LLM-labelled), build the forest from those clusters
// instead of the host/title regex fallback. Each cluster becomes a top-level
// region whose members are the captures carrying its theme_id. Flat (one
// theme/subtheme per region) — the disclosure renders regions; selecting one
// filters by member captureIds (see BookmarksClient).
async function buildSemanticForest(workspaceId: string): Promise<Forest | null> {
  const themes = await db
    .select({
      themeId: schema.memoryThemes.themeId,
      label: schema.memoryThemes.label,
      size: schema.memoryThemes.size,
    })
    .from(schema.memoryThemes)
    .where(eq(schema.memoryThemes.workspaceId, workspaceId))
    .orderBy(desc(schema.memoryThemes.size));
  if (themes.length === 0) return null;

  const members = await db
    .select({
      id: schema.captureSources.id,
      themeId: schema.captureSources.themeId,
    })
    .from(schema.captureSources)
    .where(
      and(
        eq(schema.captureSources.workspaceId, workspaceId),
        ne(schema.captureSources.state, "archived"),
        isNotNull(schema.captureSources.url),
        isNotNull(schema.captureSources.themeId)
      )
    );

  const idsByTheme = new Map<string, string[]>();
  for (const m of members) {
    if (!m.themeId) continue;
    const arr = idsByTheme.get(m.themeId) ?? [];
    arr.push(m.id);
    idsByTheme.set(m.themeId, arr);
  }

  let totalCaptures = 0;
  const regions: ForestRegion[] = themes
    .map((t, i) => {
      const memberIds = idsByTheme.get(t.themeId) ?? [];
      totalCaptures += memberIds.length;
      return {
        id: t.themeId,
        label: t.label,
        color: REGION_COLORS[i % REGION_COLORS.length],
        count: memberIds.length,
        themes: [
          {
            id: t.themeId,
            label: t.label,
            count: memberIds.length,
            subthemes: [
              { id: `${t.themeId}.all`, label: "All", count: memberIds.length, memberIds },
            ],
          },
        ],
      };
    })
    .filter((r) => r.count > 0);

  if (regions.length === 0) return null;
  return { source: "semantic", regions, totalCaptures };
}

// ── Public ────────────────────────────────────────────────────────────────────

export async function getForest(
  workspaceId: string,
  plexoWorkspaceId: string | null
): Promise<Forest> {
  // Prefer the LLM-clustered semantic forest (P9b) when it exists.
  const semantic = await buildSemanticForest(workspaceId);
  if (semantic) return semantic;
  if (plexoWorkspaceId) {
    const plexo = await fetchPlexoForest(plexoWorkspaceId);
    if (plexo) return plexo;
  }
  return buildLocalForest(workspaceId);
}

export async function bucketCapture(row: CaptureRowForBucketing): Promise<{
  regionId: string;
  themeId: string;
  themeLabel: string;
}> {
  const b = bucket(row);
  return { regionId: b.regionId, themeId: b.themeId, themeLabel: b.themeLabel };
}
