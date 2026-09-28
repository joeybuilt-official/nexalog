// SPDX-License-Identifier: MIT
"use client";

/**
 * Knowledge Garden — the brain's link graph rendered as an SVG.
 *
 * Nexalog only RENDERS; GBrain owns the graph (pages + typed links over the
 * brain repo). Data comes from GET /api/graph (whole brain) or
 * /api/graph?slug=<slug> (one page's neighborhood).
 *
 * Layout: deterministic radial — roots at the centre, hop-1 nodes on the
 * first ring, hop-2+ on outer rings. No physics/deps; stable across renders
 * so the reader keeps their bearings.
 *
 * Garden polish (Phase 3):
 *   - per-type chips filter the graph the page ALREADY has (no refetch);
 *   - the search box filters nodes by title and its suggestions centre the
 *     canvas on the chosen node (the viewBox moves, the layout does not);
 *   - a degraded state that says WHICH garden is on screen — GBrain, the local
 *     brain-repo fallback, or nothing — instead of a blank canvas.
 *
 * The pure parts of all three live in `@/lib/graph/*` and are unit-tested.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import {
  FILTER_GROUPS,
  FILTER_GROUP_LABELS,
  countsByGroup,
  filterNodes,
  groupForNode,
  groupForType,
  rankMatches,
  type FilterGroup,
} from "@/lib/graph/filters";
import {
  BASE_VIEWPORT,
  CANVAS_CENTER_X,
  CANVAS_CENTER_Y,
  focusViewport,
  isBaseViewport,
  viewBoxFor,
  type GraphViewport,
} from "@/lib/graph/viewport";
import { brainPageHref } from "@/lib/search/result-href";

interface GraphNode {
  slug: string;
  title: string;
  type: string;
}

interface GraphEdge {
  from: string;
  to: string;
  linkType: string;
  context: string | null;
}

interface GraphPayload {
  ok: boolean;
  /** gbrain | local | none — which graph this is. */
  source: string;
  root?: string | null;
  depth?: number;
  /** True when the page is not reading GBrain directly. */
  degraded?: boolean;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Human-readable explanation, set by the route for the degraded rungs. */
  note?: string;
  truncated?: boolean;
}

const TYPE_VAR: Record<string, string> = {
  person: "var(--t-person)",
  company: "var(--t-company)",
  project: "var(--t-project)",
  concept: "var(--t-concept)",
  note: "var(--t-note)",
  source: "var(--t-source)",
  media: "var(--t-media)",
  conversation: "var(--t-note)",
  atom: "var(--t-concept)",
};

const GROUP_VAR: Record<FilterGroup, string> = {
  people: "var(--t-person)",
  companies: "var(--t-company)",
  projects: "var(--t-project)",
  concepts: "var(--t-concept)",
  atoms: "var(--t-concept)",
};

function typeColor(node: GraphNode): string {
  const direct = TYPE_VAR[(node.type ?? "").toLowerCase()];
  if (direct) return direct;
  const group = groupForNode(node);
  return group ? GROUP_VAR[group] : "var(--muted-fg)";
}

function radiusFor(node: GraphNode): number {
  const group = groupForType(node.type) ?? groupForType(node.slug.split("/")[0] ?? "");
  switch (group) {
    case "people":
    case "companies":
    case "projects":
      return 9;
    case "concepts":
    case "atoms":
      return 7;
    default:
      return 5;
  }
}

/** Deterministic radial layout: BFS distance from the root determines the ring. */
function layout(nodes: GraphNode[], edges: GraphEdge[], root: string | null) {
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n.slug, new Set());
  for (const e of edges) {
    adj.get(e.from)?.add(e.to);
    adj.get(e.to)?.add(e.from);
  }

  const start = root && adj.has(root) ? root : nodes[0]?.slug;
  const hop = new Map<string, number>();
  if (start) {
    hop.set(start, 0);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift()!;
      const d = hop.get(cur)!;
      for (const nb of adj.get(cur) ?? []) {
        if (!hop.has(nb) && d < 4) {
          hop.set(nb, d + 1);
          queue.push(nb);
        }
      }
    }
  }

  const rings = new Map<number, GraphNode[]>();
  for (const n of nodes) {
    const d = hop.get(n.slug) ?? 4;
    if (!rings.has(d)) rings.set(d, []);
    rings.get(d)!.push(n);
  }

  const pos = new Map<string, { x: number; y: number }>();
  const ringRadius = [0, 132, 236, 300, 340];
  for (const [d, group] of rings) {
    const r = ringRadius[Math.min(d, ringRadius.length - 1)];
    if (d === 0) {
      pos.set(group[0].slug, { x: CANVAS_CENTER_X, y: CANVAS_CENTER_Y });
      // extra roots (multi-seed) share the centre with jitter
      group.slice(1).forEach((n, i) => {
        const a = (i / Math.max(1, group.length - 1)) * Math.PI * 2;
        pos.set(n.slug, {
          x: CANVAS_CENTER_X + Math.cos(a) * 46,
          y: CANVAS_CENTER_Y + Math.sin(a) * 46,
        });
      });
      continue;
    }
    group.forEach((n, i) => {
      const a = (i / Math.max(1, group.length)) * Math.PI * 2 + d * 0.4;
      pos.set(n.slug, { x: CANVAS_CENTER_X + Math.cos(a) * r, y: CANVAS_CENTER_Y + Math.sin(a) * r });
    });
  }
  return pos;
}

/** One shared shell for the loading / degraded / empty messages. */
function Notice({
  title,
  children,
  tone = "muted",
  action,
}: {
  title: string;
  children?: ReactNode;
  tone?: "muted" | "warning";
  action?: ReactNode;
}) {
  const shell =
    tone === "warning" ? "border-primary/50 bg-surface" : "border-dashed border-border bg-surface";
  return (
    <div className={`rounded-lg border p-4 text-sm ${shell}`}>
      <p className="font-medium text-foreground">{title}</p>
      {children ? <div className="mt-1 text-xs text-muted-foreground">{children}</div> : null}
      {action ? <div className="mt-3 flex flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function GraphCanvas({ rootSlug }: { rootSlug?: string | null }) {
  const router = useRouter();
  const [data, setData] = useState<GraphPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [depth, setDepth] = useState(2);
  const [activeGroups, setActiveGroups] = useState<FilterGroup[]>([...FILTER_GROUPS]);
  const [focused, setFocused] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async (slug: string | null, d: number) => {
    // A fresh graph invalidates the old focus point — its coordinates were
    // computed for the previous node set.
    setFocused(null);
    try {
      const qs = new URLSearchParams();
      if (slug) qs.set("slug", slug);
      qs.set("depth", String(d));
      const res = await fetch(`/api/graph?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.text();
        setError(`Graph unavailable (${res.status}): ${body.slice(0, 120)}`);
        return;
      }
      setData((await res.json()) as GraphPayload);
      setError(null);
    } catch (e) {
      setError(`Graph request failed: ${String(e)}`);
    }
  }, []);

  // Initial + root/depth-driven fetch. Async callbacks only — no setState
  // synchronously in the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    const ac = new AbortController();
    const qs = new URLSearchParams();
    if (rootSlug) qs.set("slug", rootSlug);
    qs.set("depth", String(depth));
    fetch(`/api/graph?${qs.toString()}`, { cache: "no-store", signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: GraphPayload) => {
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!ac.signal.aborted) setError(`Graph unavailable: ${String(e)}`);
      });
    return () => ac.abort();
  }, [rootSlug, depth, reloadKey]);

  const { pos, nodesById } = useMemo(() => {
    if (!data) {
      return {
        pos: new Map<string, { x: number; y: number }>(),
        nodesById: new Map<string, GraphNode>(),
      };
    }
    const byId = new Map(data.nodes.map((n) => [n.slug, n] as const));
    return { pos: layout(data.nodes, data.edges, data.root ?? null), nodesById: byId };
  }, [data]);

  const counts = useMemo(() => countsByGroup(data?.nodes ?? []), [data]);
  const visibleNodes = useMemo(
    () => (data ? filterNodes(data.nodes, activeGroups, query) : []),
    [data, activeGroups, query],
  );
  const visibleSlugs = useMemo(() => new Set(visibleNodes.map((n) => n.slug)), [visibleNodes]);
  const suggestions = useMemo(
    () => (data ? rankMatches(data.nodes, query) : []),
    [data, query],
  );

  // "Focus" = select the node AND centre the viewport on it. The radial layout
  // never moves; only the viewBox window does. If a type chip would hide the
  // chosen node, turn that chip back on — focusing something invisible is a
  // no-op for the reader.
  const focusNode = useCallback(
    (slug: string) => {
      const node = nodesById.get(slug);
      const group = node ? groupForNode(node) : null;
      if (group) {
        setActiveGroups((current) =>
          current.includes(group) ? current : [...FILTER_GROUPS].filter((g) => current.includes(g) || g === group),
        );
      }
      setSelected(slug);
      setFocused(slug);
    },
    [nodesById],
  );

  const resetFilters = useCallback(() => {
    setActiveGroups([...FILTER_GROUPS]);
    setQuery("");
  }, []);

  const viewport: GraphViewport = useMemo(() => {
    // The focus point only holds while its node is actually on the canvas —
    // otherwise filtering the focused node away would leave the reader zoomed
    // into an empty patch of space.
    if (!focused || !visibleSlugs.has(focused)) return BASE_VIEWPORT;
    const point = pos.get(focused);
    return point ? focusViewport(point.x, point.y) : BASE_VIEWPORT;
  }, [focused, pos, visibleSlugs]);

  const selectedNode = selected ? (nodesById.get(selected) ?? null) : null;
  const selectedEdges = useMemo(
    () => (data && selected ? data.edges.filter((e) => e.from === selected || e.to === selected) : []),
    [data, selected],
  );

  const loading = !data && !error;

  // ── degraded / empty states (never a blank canvas) ────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <div className="h-40 animate-pulse rounded-lg border border-border bg-surface" />
        <p className="text-xs text-muted-foreground">Loading the garden…</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <Notice
        title="The garden is out of reach"
        tone="warning"
        action={
          <button
            type="button"
            onClick={() => {
              setError(null);
              setReloadKey((k) => k + 1);
            }}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-accent"
          >
            Try again
          </button>
        }
      >
        <p className="font-mono">{error}</p>
        <p className="mt-1">
          The graph comes from GBrain through <code>/api/graph</code>. Captures and notes keep
          working while it is down — nothing is lost, the picture is just missing.
        </p>
      </Notice>
    );
  }

  if (!data) return null;

  if (data.nodes.length === 0) {
    return (
      <Notice
        title={data.source === "none" ? "No graph to draw yet" : "The garden is empty"}
        tone={data.degraded ? "warning" : "muted"}
      >
        <p>{data.note ?? "The brain index returned no pages or links."}</p>
        <p className="mt-1">
          Once pages exist under <code>people/</code>, <code>companies/</code>, <code>concepts/</code>,{" "}
          <code>projects/</code> or <code>atoms/</code> — and link to each other with{" "}
          <code>[[wiki links]]</code> — they appear here.
        </p>
      </Notice>
    );
  }

  const narrowed = visibleNodes.length === 0;
  const viewBox = viewBoxFor(viewport);

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <Notice title="Showing the last garden we loaded" tone="warning">
          <p className="font-mono">{error}</p>
        </Notice>
      )}

      {data.degraded && !error && (
        <Notice
          title={data.source === "local" ? "Local graph — GBrain not in the loop" : "Degraded graph"}
          tone="warning"
          action={
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-accent"
            >
              Retry
            </button>
          }
        >
          <p>{data.note ?? "This graph was rebuilt from local sources."}</p>
        </Notice>
      )}

      {/* controls: focus/search + depth + whole-brain */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              // Enter focuses the best match; an exact-slug entry still loads
              // that page's neighbourhood from the API.
              const best = rankMatches(data.nodes, query, 1)[0];
              if (best) focusNode(best.slug);
              else if (query.trim()) void load(query.trim(), depth);
            }}
            placeholder="Find a node by title, or a slug to focus (e.g. concepts/litellm-gateway)…"
            aria-label="Find a node in the garden"
            className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-accent"
          />
        </div>
        <select
          value={depth}
          onChange={(e) => setDepth(Number(e.target.value))}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
          aria-label="Traversal depth"
        >
          <option value={1}>1 hop</option>
          <option value={2}>2 hops</option>
          <option value={3}>3 hops</option>
        </select>
        <button
          type="button"
          onClick={() => {
            setQuery("");
            setFocused(null);
            setSelected(null);
            setActiveGroups([...FILTER_GROUPS]);
            void load(null, depth);
          }}
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm hover:border-accent"
        >
          Whole brain
        </button>
      </div>

      {/* search suggestions — click to centre the canvas on a node */}
      {query.trim() && suggestions.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Matching nodes">
          {suggestions.map((node) => (
            <li key={node.slug}>
              <button
                type="button"
                onClick={() => focusNode(node.slug)}
                className={`inline-flex max-w-[16rem] items-center gap-1.5 truncate rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  node.slug === focused
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-muted-foreground hover:border-accent hover:text-foreground"
                }`}
                title={`Focus ${node.title} (${node.slug})`}
              >
                <i
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: typeColor(node) }}
                />
                <span className="truncate">{node.title}</span>
                <span className="shrink-0 opacity-60">{node.type}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* per-type filters — a node outside the five groups needs them all on */}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter nodes by type">
        {FILTER_GROUPS.map((group) => {
          const active = activeGroups.includes(group);
          return (
            <button
              key={group}
              type="button"
              aria-pressed={active}
              onClick={() =>
                setActiveGroups((current) =>
                  current.includes(group)
                    ? current.filter((g) => g !== group)
                    : [...FILTER_GROUPS].filter((g) => current.includes(g) || g === group),
                )
              }
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                active
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
              }`}
            >
              <i className="inline-block h-2 w-2 rounded-full" style={{ background: GROUP_VAR[group] }} />
              {FILTER_GROUP_LABELS[group]}
              <span className="opacity-60">{counts[group]}</span>
            </button>
          );
        })}
        {(activeGroups.length !== FILTER_GROUPS.length || query.trim()) && (
          <button
            type="button"
            onClick={resetFilters}
            className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-accent hover:text-foreground"
          >
            Clear filters
          </button>
        )}
        {!isBaseViewport(viewport) && (
          <button
            type="button"
            onClick={() => setFocused(null)}
            className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-accent hover:text-foreground"
          >
            Reset view
          </button>
        )}
      </div>

      {narrowed ? (
        <Notice
          title="No nodes match the current filters"
          action={
            <button
              type="button"
              onClick={resetFilters}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-accent"
            >
              Clear filters
            </button>
          }
        >
          <p>
            {query.trim()
              ? `Nothing in this garden matches “${query.trim()}”.`
              : "Every type chip is off — turn one on to see the garden."}
          </p>
        </Notice>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <svg
            viewBox={viewBox}
            className="h-auto w-full"
            role="img"
            aria-label={`Knowledge graph: ${visibleNodes.length} of ${data.nodes.length} nodes`}
          >
            {data.edges.map((e, i) => {
              if (!visibleSlugs.has(e.from) || !visibleSlugs.has(e.to)) return null;
              const a = pos.get(e.from);
              const b = pos.get(e.to);
              if (!a || !b) return null;
              const dim = selected ? !(e.from === selected || e.to === selected) : false;
              return (
                <line
                  key={`${e.from}->${e.to}:${i}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="var(--border)"
                  strokeWidth={selected && !dim ? 1.6 : 1}
                  opacity={dim ? 0.15 : 0.7}
                />
              );
            })}

            {visibleNodes.map((n) => {
              const p = pos.get(n.slug);
              if (!p) return null;
              const dim = selected
                ? !(n.slug === selected || selectedEdges.some((e) => e.from === n.slug || e.to === n.slug))
                : false;
              const isSel = n.slug === selected;
              const isFocused = n.slug === focused;
              const r = radiusFor(n) * (isSel ? 1.5 : 1);
              const label = n.title.length > 22 ? n.title.slice(0, 21) + "…" : n.title;
              return (
                <g
                  key={n.slug}
                  transform={`translate(${p.x},${p.y})`}
                  opacity={dim ? 0.2 : 1}
                  className="cursor-pointer"
                  role="link"
                  tabIndex={0}
                  aria-label={`Open ${n.title} (${n.slug})`}
                  onClick={() => {
                    // A node IS a page: clicking it opens that page. Before
                    // this, a click only re-centred, so nothing in the graph
                    // could reach a page's body or its typed links — the
                    // reader did not exist. Selecting (for the links panel) is
                    // still available from the search-suggestion chips, and
                    // the panel carries its own "Open page" link.
                    router.push(brainPageHref(n.slug));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      router.push(brainPageHref(n.slug));
                    }
                  }}
                >
                  {isFocused && (
                    <circle r={r + 6} fill="none" stroke="var(--accent)" strokeWidth={1.5} opacity={0.8} />
                  )}
                  <circle
                    r={r}
                    fill={typeColor(n)}
                    stroke={isSel ? "var(--fg)" : "var(--surface)"}
                    strokeWidth={isSel ? 2 : 1}
                  />
                  {(r >= 7 || isSel) && (
                    <text
                      y={r + 11}
                      textAnchor="middle"
                      fontSize={isSel ? 11 : 9.5}
                      fill="var(--fg)"
                      style={{ pointerEvents: "none" }}
                    >
                      {label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>
          {visibleNodes.length === data.nodes.length
            ? `${data.nodes.length} nodes`
            : `${visibleNodes.length} of ${data.nodes.length} nodes`}
        </span>
        <span>{data.edges.length} links</span>
        <span>source: {data.source}</span>
        {data.truncated && <span>truncated at the node cap</span>}
        {FILTER_GROUPS.map((group) => (
          <span key={group} className="inline-flex items-center gap-1">
            <i className="inline-block h-2 w-2 rounded-full" style={{ background: GROUP_VAR[group] }} />
            {FILTER_GROUP_LABELS[group]}
          </span>
        ))}
      </div>

      {selectedNode && (
        <div className="rounded-lg border border-border bg-surface p-3 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <span className="font-medium">{selectedNode.title}</span>{" "}
              <span className="text-xs text-muted-foreground">
                {selectedNode.type} · {selectedNode.slug}
              </span>
            </div>
            <div className="flex shrink-0 gap-2 text-xs">
              <Link
                className="underline hover:text-accent"
                href={brainPageHref(selectedNode.slug)}
              >
                Open page
              </Link>
              <button
                type="button"
                className="underline hover:text-accent"
                onClick={() => focusNode(selectedNode.slug)}
              >
                {focused === selectedNode.slug ? "Centred" : "Centre here"}
              </button>
              <button
                type="button"
                className="underline hover:text-accent"
                onClick={() => void load(selectedNode.slug, depth)}
              >
                Load neighbourhood
              </button>
              <a
                className="underline hover:text-accent"
                href={`/app/search?q=${encodeURIComponent(selectedNode.title)}`}
              >
                Search text
              </a>
            </div>
          </div>
          {selectedEdges.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
              {selectedEdges.slice(0, 12).map((e, i) => {
                const other = e.from === selected ? e.to : e.from;
                const dir = e.from === selected ? "→" : "←";
                return (
                  <li key={i}>
                    <span className="text-foreground">{dir}</span>{" "}
                    <button
                      type="button"
                      className="underline hover:text-accent"
                      onClick={() => setSelected(other)}
                    >
                      {other}
                    </button>{" "}
                    <span className="italic">{e.linkType}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
