// SPDX-License-Identifier: MIT
/**
 * The LOCAL graph build — the fallback behind `GET /api/graph`.
 *
 * When GBrain is unconfigured (standalone mode) or unreachable, the garden must
 * still draw something: the brain repo IS the system of record, and it already
 * carries the edges —
 *
 *   - typed pages link to each other with `[[wiki links]]` in the body;
 *   - atoms (written by the Hermes worker) carry theirs in frontmatter list
 *     fields instead, and live date-sharded under `atoms/<YYYY-MM-DD>/`.
 *
 * This module walks the five typed directories and turns both shapes into the
 * same `{nodes, edges}` the GBrain path returns.
 *
 * Honest limits, repeated in the payload's `note`: the local graph sees ONLY
 * explicit links over the five typed directories — no embeddings, no inferred
 * edges, no link table. It is a fallback, not parity.
 *
 * The pure helpers (wikilink parsing, BFS slicing) live in ./links.ts; the file
 * IO lives here so only the route handler pulls `node:fs` into its bundle.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { extractWikilinkTargets, neighborhoodSlice } from "./links";

/** The typed directories the garden models (see PAGE_TYPES in @nexalog/core). */
export const LOCAL_GRAPH_DIRS = ["people", "companies", "concepts", "projects", "atoms"] as const;

/** Hard bounds so a huge repo can never make the fallback unbounded work. */
export const MAX_LOCAL_FILES = 600;
export const MAX_LOCAL_NODES = 150;
export const MAX_LOCAL_BYTES_PER_FILE = 256 * 1024;
/** Walk depth inside a typed dir — `atoms/` is date-sharded one level down. */
export const MAX_LOCAL_DEPTH = 3;

/**
 * Frontmatter list fields that count as typed links. Atoms carry no wikilinks
 * in the body; their edges are `concepts:` entries. `source_slug:` deliberately
 * excluded — it points at conversations/sessions, outside the typed dirs, so it
 * could never resolve to a node here.
 */
const LINK_LIST_FIELDS: Array<{ field: string; linkType: string }> = [
  { field: "concepts", linkType: "concept" },
  { field: "related", linkType: "related" },
];

export interface LocalGraphNode {
  slug: string;
  title: string;
  type: string;
}

export interface LocalGraphEdge {
  from: string;
  to: string;
  linkType: string;
  context: string | null;
}

export interface LocalGraphResult {
  nodes: LocalGraphNode[];
  edges: LocalGraphEdge[];
  /** Markdown files actually read (before any slicing). */
  pagesScanned: number;
  /** True when a bound was hit and the graph is a prefix, not the whole. */
  truncated: boolean;
}

export interface LocalGraphOptions {
  /** Absolute path to the brain repo, or null when the env is unset. */
  repoPath: string | null | undefined;
  /** Optional neighbourhood seed (the `?slug=` focus). */
  root?: string | null;
  /** Hop depth from the root when `root` resolves to a real page. */
  depth?: number;
  maxNodes?: number;
}

interface RawPage {
  slug: string;
  title: string;
  type: string;
  body: string;
  /** Frontmatter links, already reduced to candidate targets. */
  frontmatterLinks: Array<{ target: string; linkType: string }>;
}

interface ParsedFrontmatter {
  scalars: Record<string, string>;
  lists: Record<string, string[]>;
}

const EMPTY: LocalGraphResult = { nodes: [], edges: [], pagesScanned: 0, truncated: false };

/**
 * Build the graph from the brain repo. Never throws: a broken mount, a missing
 * directory, or an unreadable file degrades to an empty graph (the route then
 * reports `source: "none"`), because the fallback must not itself become an
 * error path.
 */
export async function buildLocalGraph(opts: LocalGraphOptions): Promise<LocalGraphResult> {
  const repoPath = opts.repoPath;
  if (!repoPath) return EMPTY;

  try {
    const pages: RawPage[] = [];
    let truncated = false;

    for (const dir of LOCAL_GRAPH_DIRS) {
      if (pages.length >= MAX_LOCAL_FILES) {
        truncated = true;
        break;
      }
      const found = await walkTypedDir(
        path.join(repoPath, dir),
        dir,
        MAX_LOCAL_FILES - pages.length,
      );
      pages.push(...found.pages);
      if (found.truncated) truncated = true;
    }

    if (!pages.length) return { ...EMPTY, truncated };

    // Deterministic order: declared directory order, then slug. The client's
    // radial layout seeds from the first node, so a stable order keeps the
    // garden from re-centring between identical requests.
    const dirIndex = new Map<string, number>(LOCAL_GRAPH_DIRS.map((dir, i) => [dir, i]));
    pages.sort((a, b) => {
      const byDir =
        (dirIndex.get(a.slug.split("/")[0]) ?? 99) - (dirIndex.get(b.slug.split("/")[0]) ?? 99);
      return byDir !== 0 ? byDir : a.slug.localeCompare(b.slug);
    });

    const bySlug = new Map<string, LocalGraphNode>();
    // Aliases let a human-written link land on the real page: the full slug,
    // its last segment, and the page title. First registration wins, which is
    // deterministic because `pages` is sorted.
    const byAlias = new Map<string, string>();
    const alias = (key: string | null | undefined, slug: string) => {
      const normalized = (key ?? "").trim().toLowerCase();
      if (!normalized || byAlias.has(normalized)) return;
      byAlias.set(normalized, slug);
    };

    for (const page of pages) {
      if (bySlug.size >= (opts.maxNodes ?? MAX_LOCAL_NODES)) {
        truncated = true;
        break;
      }
      bySlug.set(page.slug, { slug: page.slug, title: page.title, type: page.type });
      alias(page.slug, page.slug);
      alias(page.slug.split("/").pop(), page.slug);
      alias(page.title, page.slug);
    }

    const seenEdge = new Set<string>();
    const edges: LocalGraphEdge[] = [];
    const addEdge = (from: string, rawTarget: string, linkType: string) => {
      const key = rawTarget.trim().toLowerCase();
      const to = bySlug.has(key) ? key : (byAlias.get(key) ?? null);
      if (!to || to === from) return;
      const edgeKey = `${from}|${to}|${linkType}`;
      if (seenEdge.has(edgeKey)) return;
      seenEdge.add(edgeKey);
      edges.push({ from, to, linkType, context: null });
    };

    for (const page of pages) {
      if (!bySlug.has(page.slug)) continue;
      for (const target of extractWikilinkTargets(page.body)) {
        addEdge(page.slug, target, "wikilink");
      }
      for (const link of page.frontmatterLinks) {
        addEdge(page.slug, link.target, link.linkType);
      }
    }

    // Narrow to the requested neighbourhood (no root → the whole graph).
    const slice = neighborhoodSlice(bySlug.keys(), edges, opts.root ?? null, opts.depth ?? 1);
    const nodes = [...bySlug.values()].filter((node) => slice.has(node.slug));
    const visible = new Set(nodes.map((node) => node.slug));
    const scopedEdges = edges.filter((edge) => visible.has(edge.from) && visible.has(edge.to));

    return { nodes, edges: scopedEdges, pagesScanned: pages.length, truncated };
  } catch {
    return EMPTY;
  }
}

/** Walk one typed directory, bounded by `remaining` files and MAX_LOCAL_DEPTH. */
async function walkTypedDir(
  dirPath: string,
  prefix: string,
  remaining: number,
): Promise<{ pages: RawPage[]; truncated: boolean }> {
  const pages: RawPage[] = [];
  let truncated = false;

  const walk = async (absDir: string, slugPrefix: string, depth: number): Promise<void> => {
    let entries: Array<{ name: string; isDirectory: boolean }>;
    try {
      entries = (await fs.readdir(absDir, { withFileTypes: true }))
        .filter((entry) => !entry.name.startsWith("."))
        .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return; // missing/unreadable dir: skip, never fail the fallback
    }

    for (const entry of entries) {
      if (pages.length >= remaining) {
        truncated = true;
        return;
      }
      if (entry.isDirectory) {
        if (depth < MAX_LOCAL_DEPTH) {
          await walk(path.join(absDir, entry.name), `${slugPrefix}/${entry.name}`, depth + 1);
        }
        continue;
      }
      if (!entry.name.endsWith(".md")) continue;

      let raw: string;
      try {
        raw = await fs.readFile(path.join(absDir, entry.name), "utf8");
      } catch {
        continue; // unreadable file: skip, never fail the fallback
      }
      if (raw.length > MAX_LOCAL_BYTES_PER_FILE) raw = raw.slice(0, MAX_LOCAL_BYTES_PER_FILE);

      const { frontmatter, body } = splitFrontmatter(raw);
      const slug = `${slugPrefix}/${entry.name.replace(/\.md$/, "")}`;
      const type = frontmatter.scalars.type ?? slugPrefix.split("/")[0] ?? "";

      const frontmatterLinks: Array<{ target: string; linkType: string }> = [];
      for (const { field, linkType } of LINK_LIST_FIELDS) {
        for (const item of frontmatter.lists[field] ?? []) {
          frontmatterLinks.push({ target: item, linkType });
        }
      }

      pages.push({
        slug,
        title: frontmatter.scalars.title ?? slug.split("/").pop() ?? slug,
        type,
        body,
        frontmatterLinks,
      });
    }
  };

  await walk(dirPath, prefix, 0);
  return { pages, truncated };
}

/**
 * Minimal frontmatter reader: top-level scalar keys, plus `key:` → `- item`
 * lists (the shape atoms use for `concepts:`). Deliberately not js-yaml (the
 * web app does not depend on it) — this needs two scalars and two list fields,
 * and anything it cannot read is simply absent, which is the correct
 * conservative outcome for a fallback.
 */
function splitFrontmatter(raw: string): { frontmatter: ParsedFrontmatter; body: string } {
  const empty: ParsedFrontmatter = { scalars: {}, lists: {} };
  if (!raw.startsWith("---\n")) return { frontmatter: empty, body: raw };
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { frontmatter: empty, body: raw };

  const frontmatter: ParsedFrontmatter = { scalars: {}, lists: {} };
  let listKey: string | null = null;

  for (const line of raw.slice(4, end).split("\n")) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && listKey) {
      const value = unquote(item[1]);
      if (value) (frontmatter.lists[listKey] ??= []).push(value);
      continue;
    }
    const entry = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!entry) continue;
    const key = entry[1].toLowerCase();
    const value = unquote(entry[2]);
    if (value) {
      frontmatter.scalars[key] = value;
      listKey = null;
    } else {
      // `key:` with nothing after it — the following `- item` lines are its list.
      listKey = key;
    }
  }

  // `>-` block scalars span several lines; those continuations match neither
  // pattern above and are skipped. Fine here: neither `title:` nor `type:` is
  // ever written as a block in the brain repo.
  return { frontmatter, body: raw.slice(end + 4).replace(/^\n/, "") };
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "|" || trimmed === ">" || trimmed === ">-" || trimmed === "|-") {
    return "";
  }
  return trimmed.replace(/^["']|["']$/g, "");
}
