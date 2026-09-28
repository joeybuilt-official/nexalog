// SPDX-License-Identifier: MIT
/**
 * Reading brain pages — the IO shell shared by `GET /api/pages`,
 * `GET /api/pages/[...slug]` and the `/app/brain` surfaces.
 *
 * One read path, two callers: the API routes and the pages themselves call
 * these functions directly rather than one fetching the other's HTTP endpoint.
 * The shape of the ANSWER is not decided here — that is `./degrade.ts` (pure,
 * unit-tested). This module only does IO and reports WHICH rung it got:
 *
 *   gbrain — the MCP tools (`list_pages` / `get_page` / `get_backlinks` /
 *            `traverse_graph`), authoritative.
 *   local  — GBrain is unconfigured, unreachable, or has nothing: the brain
 *            repo is the system of record, so the answer is rebuilt from it
 *            with `buildLocalGraph` + the brain store.
 *   none   — nothing readable at all. Never a throw, never a blank screen.
 *
 * Brain pages are GLOBAL to the deployment (one brain repo, one GBrain index) —
 * there is no per-workspace partition of them, exactly as `/api/graph` treats
 * its nodes. The caller's authentication is therefore the isolation boundary
 * and the route enforces it before anything here runs.
 */

import { Slug } from "@nexalog/core";

import { getComposition } from "@/composition";
import { buildLocalGraph } from "@/lib/graph/local-graph";
import { logEvent } from "@/lib/logger";
import {
  resolvePagePayload,
  resolvePagesPayload,
  type BrainPage,
  type BrainPageLink,
  type BrainPagePayload,
  type BrainPagesPayload,
  type BrainPageSummary,
  type GbrainPageOutcome,
  type GbrainPagesOutcome,
  type LocalPageOutcome,
} from "./degrade";

/** GBrain caps remote `list_pages` at 100 rows per call. */
export const MAX_PAGE_LIMIT = 100;
export const DEFAULT_PAGE_LIMIT = 50;

export interface ReadPagesOptions {
  limit?: number;
  offset?: number;
  /** Filter to one gbrain page type. */
  type?: string;
  sort?: "updated_desc" | "updated_asc" | "created_desc" | "slug";
}

export async function readPages(opts: ReadPagesOptions = {}): Promise<BrainPagesPayload> {
  const limit = opts.limit ?? DEFAULT_PAGE_LIMIT;
  const offset = opts.offset ?? 0;

  const gbrain = await readGbrainPages({ ...opts, limit, offset });
  // The brain-repo rebuild only runs when GBrain could not answer AT ALL: it is
  // slower (a bounded directory walk), and on `exhausted` GBrain has already
  // said the index ends here, so a disk scan would describe a different
  // position rather than fill a gap.
  const local =
    gbrain.status === "ok" || gbrain.status === "exhausted"
      ? { pages: [] }
      : await readLocalPages();

  return resolvePagesPayload({ gbrain, local, limit, offset });
}

export async function readPage(slug: string): Promise<BrainPagePayload | null> {
  const gbrain = await readGbrainPage(slug);
  // Only reach for the brain repo when GBrain cannot answer — it is slower
  // (a bounded directory walk) and GBrain is authoritative when it has a view.
  const local =
    gbrain.status === "ok" || gbrain.status === "missing" ? null : await readLocalPage(slug);

  return resolvePagePayload({ gbrain, local });
}

// ── GBrain ──────────────────────────────────────────────────────────────────

/**
 * Read GBrain once, reporting WHICH failure happened instead of throwing — the
 * route reports the rung, it never 500s because an upstream is down.
 */
async function readGbrainPages(opts: ReadPagesOptions & { limit: number; offset: number }): Promise<GbrainPagesOutcome> {
  let client: ReturnType<typeof getComposition>["gbrain"];
  try {
    client = getComposition().gbrain;
  } catch {
    return { status: "unconfigured" }; // BRAIN_REPO unset — standalone mode
  }
  if (!client) return { status: "unconfigured" };

  try {
    const pages = await client.listPages({
      limit: opts.limit,
      offset: opts.offset,
      ...(opts.type ? { type: opts.type } : {}),
      ...(opts.sort ? { sort: opts.sort } : {}),
    });
    // An empty page is only "GBrain has nothing" on the FIRST page. Past the
    // first page it means the caller walked off the end of a real index, and
    // rebuilding that from disk would be a lie about where the rows came from.
    if (pages.length === 0 && opts.offset > 0) {
      return { status: "exhausted" };
    }
    return pages.length > 0
      ? { status: "ok", pages, truncated: false }
      : { status: "empty" };
  } catch (e) {
    logEvent("pages.gbrain.error", { error: String(e) });
    return { status: "unreachable" };
  }
}

async function readGbrainPage(slug: string): Promise<GbrainPageOutcome> {
  let client: ReturnType<typeof getComposition>["gbrain"];
  try {
    client = getComposition().gbrain;
  } catch {
    return { status: "unconfigured" };
  }
  if (!client) return { status: "unconfigured" };

  let page;
  try {
    page = await client.getPage(slug);
  } catch (e) {
    logEvent("pages.gbrain.error", { error: String(e), slug });
    return { status: "unreachable" };
  }
  // The tool answers `{error: "page_not_found"}` for an absent slug, which the
  // client surfaces as null — that is an authoritative miss, not an outage.
  if (!page) return { status: "missing" };

  const [links, backlinks] = await Promise.all([
    readLinks(() => client!.traverseGraph(slug, { depth: 1, direction: "out" }), slug, "links"),
    readLinks(() => client!.getBacklinks(slug), slug, "backlinks"),
  ]);

  return {
    status: "ok",
    page: { slug: page.slug, title: page.title, type: page.type, body: page.body },
    links,
    backlinks,
  };
}

/**
 * One link read, degraded to `[]` on failure with the reason logged. A page
 * whose BODY is readable must still render when its link edges are not — the
 * body is the content, the edges are navigation.
 */
async function readLinks(
  run: () => Promise<Array<{ fromSlug: string; toSlug: string; linkType: string; context: string | null }>>,
  slug: string,
  which: "links" | "backlinks",
): Promise<BrainPageLink[]> {
  try {
    const raw = await run();
    return raw
      .map((l) => ({
        slug: l.fromSlug === slug ? l.toSlug : l.fromSlug,
        title: null,
        linkType: l.linkType,
        context: l.context,
      }))
      .filter((l) => Boolean(l.slug));
  } catch (e) {
    logEvent("pages.gbrain.links.error", { error: String(e), slug, which });
    return [];
  }
}

// ── brain repo (fallback) ───────────────────────────────────────────────────

async function readLocalPages(): Promise<{ pages: BrainPageSummary[] }> {
  // `BRAIN_REPO` is read directly (not through the composition root) because
  // the fallback must survive standalone mode, exactly as `/api/graph` does.
  const graph = await buildLocalGraph({
    repoPath: process.env.BRAIN_REPO ?? null,
    depth: 1,
  });
  return {
    pages: graph.nodes.map((n) => ({
      slug: n.slug,
      title: n.title,
      type: n.type,
      updatedAt: null,
    })),
  };
}

/**
 * One page read from the brain repo, with the links its own markdown declares.
 * `null` when the file is not there — the honest 404.
 */
async function readLocalPage(slug: string): Promise<LocalPageOutcome | null> {
  let parsed: Slug;
  try {
    parsed = Slug.of(slug);
  } catch {
    return null; // not a page identifier at all
  }

  let store: ReturnType<typeof getComposition>["brainStore"];
  try {
    store = getComposition().brainStore;
  } catch {
    return null; // BRAIN_REPO unset — no local pages exist
  }

  let read;
  try {
    read = await store.getPage(parsed);
  } catch (e) {
    logEvent("pages.local.error", { error: String(e), slug });
    return null;
  }
  if (!read) return null;

  const page: BrainPage = {
    slug: read.slug.value,
    title: String(read.frontmatter.title ?? read.slug.value.split("/").pop() ?? read.slug.value),
    type: String(read.frontmatter.type ?? read.slug.value.split("/")[0] ?? ""),
    body: read.body,
  };

  // The page's own explicit links, resolved against the pages that exist. The
  // neighbourhood walk is the same bounded one `/api/graph` uses, so the
  // fallback cannot become unbounded work.
  const { links, backlinks } = await readLocalLinks(slug);
  return { page, links, backlinks };
}

async function readLocalLinks(slug: string): Promise<{ links: BrainPageLink[]; backlinks: BrainPageLink[] }> {
  const graph = await buildLocalGraph({ repoPath: process.env.BRAIN_REPO ?? null, root: slug, depth: 1 });
  const titleBySlug = new Map(graph.nodes.map((n) => [n.slug, n.title] as const));
  const links: BrainPageLink[] = [];
  const backlinks: BrainPageLink[] = [];
  for (const edge of graph.edges) {
    if (edge.from === slug) {
      links.push({
        slug: edge.to,
        title: titleBySlug.get(edge.to) ?? null,
        linkType: edge.linkType,
        context: edge.context,
      });
    } else if (edge.to === slug) {
      backlinks.push({
        slug: edge.from,
        title: titleBySlug.get(edge.from) ?? null,
        linkType: edge.linkType,
        context: edge.context,
      });
    }
  }
  return { links, backlinks };
}
