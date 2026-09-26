// SPDX-License-Identifier: MIT
/**
 * The graph degradation ladder (pure — no IO, unit-tested).
 *
 * `GET /api/graph` can answer from three places, and the garden UI must always
 * know WHICH one it got so it can show a useful state instead of a blank
 * canvas. The route does the IO (auth, MCP, fs); this module decides what the
 * response says, which is the part worth testing.
 *
 *   gbrain — GBrain MCP answered with links. Authoritative: typed links.
 *   local  — GBrain is unconfigured, unreachable, or empty. The graph was
 *            rebuilt from the brain repo's own links (lib/graph/local-graph).
 *   none   — nothing to read at all.
 *
 * `degraded` is the UI's cue to explain itself; the route also carries a
 * human-readable `note`, because "source: local" alone tells a reader nothing.
 */

export interface GraphNode {
  slug: string;
  title: string;
  type: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  linkType: string;
  context: string | null;
}

export interface GraphPayload {
  ok: boolean;
  source: "gbrain" | "local" | "none";
  root: string | null;
  depth: number;
  /** True when the graph is not GBrain's. */
  degraded: boolean;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Why the graph is what it is — set on every non-gbrain rung. */
  note?: string;
  /** The local walk hit a bound; the graph is a prefix, not the whole. */
  truncated?: boolean;
}

/** What the route managed to get out of GBrain, if anything. */
export type GbrainOutcome =
  | { status: "unconfigured" }
  | { status: "unreachable" }
  | { status: "empty" }
  | { status: "ok"; nodes: GraphNode[]; edges: GraphEdge[] };

export interface LocalOutcome {
  nodes: GraphNode[];
  edges: GraphEdge[];
  pagesScanned: number;
  truncated: boolean;
}

export interface ResolveGraphInput {
  gbrain: GbrainOutcome;
  local: LocalOutcome;
  root: string | null;
  depth: number;
}

export function resolveGraphPayload(input: ResolveGraphInput): GraphPayload {
  const { gbrain, local, root, depth } = input;

  if (gbrain.status === "ok" && gbrain.nodes.length > 0) {
    return {
      ok: true,
      source: "gbrain",
      root,
      depth,
      degraded: false,
      nodes: gbrain.nodes,
      edges: gbrain.edges,
    };
  }

  if (local.nodes.length > 0) {
    return {
      ok: true,
      source: "local",
      root,
      depth,
      degraded: true,
      nodes: local.nodes,
      edges: local.edges,
      note: localNote(gbrain.status, local.pagesScanned),
      ...(local.truncated ? { truncated: true } : {}),
    };
  }

  return {
    ok: true,
    source: "none",
    root,
    depth,
    degraded: true,
    nodes: [],
    edges: [],
    note: noneNote(gbrain.status),
  };
}

function localNote(status: GbrainOutcome["status"], pagesScanned: number): string {
  const scanned = `${pagesScanned} page${pagesScanned === 1 ? "" : "s"} scanned`;
  switch (status) {
    case "unreachable":
      return `GBrain is unreachable — this garden was rebuilt from the brain repo's own links (${scanned}). Edges are explicit links only; inferred links need GBrain.`;
    case "empty":
      return `GBrain has no links from these seeds yet — showing the brain repo's own links instead (${scanned}).`;
    case "unconfigured":
      return `GBrain is not configured in this environment — showing the brain repo's own links (${scanned}).`;
    default:
      return `Showing the brain repo's own links (${scanned}).`;
  }
}

function noneNote(status: GbrainOutcome["status"]): string {
  switch (status) {
    case "unreachable":
      return "GBrain is unreachable and no brain pages were readable — nothing to draw yet. Captures and notes still work.";
    case "empty":
      return "GBrain returned no links and no brain pages were readable — nothing to draw yet.";
    default:
      return "GBrain is not configured (BRAIN_INDEX / GBRAIN_MCP_URL unset) and no brain pages were readable — graph unavailable in standalone mode.";
  }
}
