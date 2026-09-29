// SPDX-License-Identifier: MIT
/**
 * GET /api/graph            → whole-brain link graph (bounded)
 * GET /api/graph?slug=<slug> → neighborhood of one page (traverse_graph)
 *
 * Phase 2b: the graph is GBrain's link graph over the brain repo (markdown
 * pages + typed links). Nexalog renders it; GBrain owns it.
 *
 * This handler is a thin IO shell: it reads GBrain, falls back to the brain
 * repo, and hands both outcomes to `resolveGraphPayload` (lib/graph/degrade.ts),
 * which owns the shape of the answer. The ladder itself is unit-tested there.
 *
 * A GBrain transport failure is NOT a 500 to the reader: the response stays 200
 * with `source: "local"` + `degraded: true`, and the note explains why, so the
 * garden can draw a real graph (or an honest empty state) either way.
 */

export const dynamic = "force-dynamic";

import { getAuthUser } from "@/lib/auth/server";
import { getComposition } from "@/composition";
import { logEvent } from "@/lib/logger";
import { buildLocalGraph } from "@/lib/graph/local-graph";
import {
  resolveGraphPayload,
  type GbrainOutcome,
  type GraphEdge,
  type GraphNode,
} from "@/lib/graph/degrade";
import { GRAPH_SEED_TYPES, selectGraphSeeds, type GraphSeedCandidate } from "@/lib/graph/seeds";

const MAX_NODES = 150;

function parseDepth(raw: string | null): number {
  return Math.max(1, Math.min(3, Number(raw ?? "2") || 2));
}

export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const root = url.searchParams.get("slug");
  const depth = parseDepth(url.searchParams.get("depth"));

  const gbrain = await readGbrain(root, depth);
  // `BRAIN_REPO` is read directly: getComposition() throws without it, and the
  // fallback must survive standalone mode.
  const local = await buildLocalGraph({
    repoPath: process.env.BRAIN_REPO ?? null,
    root,
    depth,
  });

  return Response.json(resolveGraphPayload({ gbrain, local, root, depth }));
}

/**
 * Read GBrain once, reporting WHICH failure happened instead of throwing.
 * The route logs the reason; the caller just needs the outcome.
 */
async function readGbrain(root: string | null, depth: number): Promise<GbrainOutcome> {
  let client: ReturnType<typeof getComposition>["gbrain"];
  try {
    client = getComposition().gbrain;
  } catch {
    return { status: "unconfigured" }; // BRAIN_REPO unset — standalone mode
  }
  if (!client) return { status: "unconfigured" };

  try {
    const graph = await traverse(client, root, depth);
    return graph.nodes.length > 0 ? { status: "ok", ...graph } : { status: "empty" };
  } catch (e) {
    logEvent("graph.gbrain.error", { error: String(e) });
    return { status: "unreachable" };
  }
}

/**
 * Read one page row per type for the whole-brain view, so the seeds are the
 * brain's own live pages rather than a hardcoded list that rots. Best-effort
 * per type: a type whose `list_pages` call fails contributes no candidates
 * instead of failing the whole graph.
 */
async function readSeedCandidates(
  gbrain: NonNullable<ReturnType<typeof getComposition>["gbrain"]>,
): Promise<Partial<Record<(typeof GRAPH_SEED_TYPES)[number], GraphSeedCandidate[]>>> {
  const entries = await Promise.all(
    GRAPH_SEED_TYPES.map(async (type) => {
      try {
        const rows = await gbrain.listPages({ type, limit: 3, sort: "updated_desc" });
        return [
          type,
          rows.map((r) => ({ slug: r.slug, title: r.title, type: r.type, updatedAt: r.updatedAt })),
        ] as const;
      } catch {
        return [type, []] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}

/** One bounded GBrain traversal, exactly as the Phase-2b route did it. */
async function traverse(
  gbrain: NonNullable<ReturnType<typeof getComposition>["gbrain"]>,
  slug: string | null,
  depth: number,
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  const addNode = (s: string) => {
    if (nodes.size >= MAX_NODES) return;
    if (!nodes.has(s)) {
      nodes.set(s, { slug: s, title: s.split("/").pop() ?? s, type: s.split("/")[0] ?? "" });
    }
  };

  // A named root walks just that neighborhood; the whole-brain view derives
  // its seeds from the brain's own live pages (`list_pages`), so a renamed or
  // absent page can no longer leave a silent hole in the garden.
  const roots = slug ? [slug] : selectGraphSeeds(await readSeedCandidates(gbrain));
  for (const seed of roots) {
    if (nodes.size >= MAX_NODES) break;
    addNode(seed);
    const links = await gbrain.traverseGraph(seed, { depth, direction: "both" });
    for (const l of links) {
      if (nodes.size >= MAX_NODES) break;
      addNode(l.fromSlug);
      addNode(l.toSlug);
      const key = `${l.fromSlug}|${l.toSlug}|${l.linkType}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({ from: l.fromSlug, to: l.toSlug, linkType: l.linkType, context: l.context });
      }
    }
  }

  // Fill in real titles from the first hop's page reads (bounded, best-effort).
  const titled = await Promise.all(
    [...nodes.keys()].slice(0, 40).map(async (s) => {
      try {
        const p = await gbrain.getPage(s);
        return p ? { slug: s, title: p.title || s, type: p.type || "" } : null;
      } catch {
        return null;
      }
    }),
  );
  for (const t of titled) {
    if (t) nodes.set(t.slug, t);
  }

  return { nodes: [...nodes.values()], edges };
}
