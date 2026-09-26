// SPDX-License-Identifier: MIT
// Garden polish: the local (degraded) graph build over a real temp brain repo.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildLocalGraph } from "@/lib/graph/local-graph";

let repo: string;

const ATOM_SLUG = "atoms/2026-09-23/the-healthcheck-that-took-down-the-service";

const PAGES: Record<string, string> = {
  "concepts/litellm-gateway.md": [
    "---",
    "title: LiteLLM Gateway",
    "type: concept",
    "---",
    "",
    "# LiteLLM Gateway",
    "",
    "The routing layer. See [[people/example-person]] and [[companies/joeybuilt]].",
  ].join("\n"),
  "people/example-person.md": [
    "---",
    "title: Example Person",
    "type: person",
    "---",
    "",
    "Operator of [[companies/joeybuilt]]. Back to [[concepts/litellm-gateway]].",
  ].join("\n"),
  "companies/joeybuilt.md": [
    "---",
    "title: Joeybuilt",
    "type: company",
    "---",
    "",
    "Company. Link to a page that does not exist: [[projects/ghost]].",
  ].join("\n"),
  // no frontmatter at all — title falls back to the filename, type to the dir
  "projects/panoply.md": ["# Panoply", "", "See [[companies/joeybuilt]]."].join("\n"),
  // out of scope for the five typed dirs
  "notes/should-not-appear.md": ["---", "title: A note", "type: note", "---", "[[people/x]]"].join(
    "\n",
  ),
  // prose link that must not resolve, and a self-link that must not be an edge
  "atoms/lonely.md": [
    "---",
    "title: Lonely",
    "type: atom",
    "---",
    "",
    "Nothing here. [[Not A Real Page!]] [[atoms/lonely]]",
  ].join("\n"),
  // The real brain repo date-shards atoms one level down and gives them their
  // edges as a frontmatter list, not as body wikilinks. Both shapes are covered.
  [`${ATOM_SLUG}.md`]: [
    "---",
    "type: atom",
    "title: The Healthcheck That Took Down the Service",
    "atom_type: insight",
    "source_slug: conversations/sessions/2026-09-23-hermes-7872986af3ee",
    "lesson: >-",
    "  Verify the healthcheck command exists inside the container.",
    "concepts:",
    "  - docker-healthcheck",
    "  - autoheal",
    "  - server-healthcheck",
    "---",
    "",
    "The immich container was healthy but autoheal restarted it every 2 minutes.",
  ].join("\n"),
};

beforeAll(async () => {
  repo = await fs.mkdtemp(path.join(os.tmpdir(), "nexalog-graph-"));
  for (const [rel, body] of Object.entries(PAGES)) {
    const abs = path.join(repo, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, body, "utf8");
  }
  // a non-markdown sibling and an empty nested dir must both be ignored
  await fs.writeFile(path.join(repo, "concepts", "raw.txt"), "not markdown", "utf8");
  await fs.mkdir(path.join(repo, "concepts", "nested"), { recursive: true });
});

afterAll(async () => {
  await fs.rm(repo, { recursive: true, force: true });
});

describe("buildLocalGraph", () => {
  it("walks the five typed dirs (atoms included) and ignores everything else", async () => {
    const graph = await buildLocalGraph({ repoPath: repo });
    expect(graph.pagesScanned).toBe(6);

    const slugs = graph.nodes.map((n) => n.slug);
    expect(slugs).toContain("concepts/litellm-gateway");
    expect(slugs).toContain("people/example-person");
    expect(slugs).toContain("companies/joeybuilt");
    expect(slugs).toContain("projects/panoply");
    expect(slugs).toContain("atoms/lonely");
    // the date-sharded atom is found (one level deeper than people/concepts)
    expect(slugs).toContain(ATOM_SLUG);
    // notes/ is outside the garden's typed dirs
    expect(slugs.some((s) => s.startsWith("notes/"))).toBe(false);
  });

  it("turns body wikilinks into edges and drops dangling/prose/self links", async () => {
    const graph = await buildLocalGraph({ repoPath: repo });
    const pairs = graph.edges.map((e) => `${e.from}->${e.to}`);

    expect(pairs).toContain("concepts/litellm-gateway->people/example-person");
    expect(pairs).toContain("concepts/litellm-gateway->companies/joeybuilt");
    expect(pairs).toContain("projects/panoply->companies/joeybuilt");
    // dangling and prose links never become edges
    expect(pairs.some((p) => p.includes("ghost"))).toBe(false);
    expect(pairs.some((p) => p.includes("not-a-real-page"))).toBe(false);
    // self-links are dropped
    expect(graph.edges.filter((e) => e.from === e.to)).toHaveLength(0);
  });

  it("reads real titles and types from frontmatter, defaulting to the directory", async () => {
    const graph = await buildLocalGraph({ repoPath: repo });
    const litellm = graph.nodes.find((n) => n.slug === "concepts/litellm-gateway");
    expect(litellm).toEqual({
      slug: "concepts/litellm-gateway",
      title: "LiteLLM Gateway",
      type: "concept",
    });

    // no frontmatter → title is the filename, type is the directory name
    const panoply = graph.nodes.find((n) => n.slug === "projects/panoply");
    expect(panoply).toEqual({ slug: "projects/panoply", title: "panoply", type: "projects" });

    // the nested atom keeps its real frontmatter title/type, and its full slug
    const atom = graph.nodes.find((n) => n.slug === ATOM_SLUG);
    expect(atom).toEqual({
      slug: ATOM_SLUG,
      title: "The Healthcheck That Took Down the Service",
      type: "atom",
    });
  });

  it("only mints edges between pages that exist (frontmatter lists included)", async () => {
    const graph = await buildLocalGraph({ repoPath: repo });
    // `docker-healthcheck` is a concept NAME, not a page — no node, no edge.
    expect(graph.nodes.some((n) => n.slug.includes("docker-healthcheck"))).toBe(false);
    expect(graph.edges.filter((e) => e.from === ATOM_SLUG)).toHaveLength(0);
    // every frontmatter `concepts:` value is equally unresolved today
    expect(graph.edges.every((e) => e.to !== "autoheal")).toBe(true);
  });

  it("narrows to a neighbourhood when given a root, whole graph when not", async () => {
    const whole = await buildLocalGraph({ repoPath: repo });
    expect(whole.nodes.length).toBe(6);

    const oneHop = await buildLocalGraph({ repoPath: repo, root: "companies/joeybuilt", depth: 1 });
    expect(oneHop.nodes.map((n) => n.slug).sort()).toEqual(
      [
        "companies/joeybuilt",
        "concepts/litellm-gateway",
        "people/example-person",
        "projects/panoply",
      ].sort(),
    );
    // the unlinked atom is outside that neighbourhood
    expect(oneHop.nodes.some((n) => n.slug === ATOM_SLUG)).toBe(false);
    // every returned edge stays inside the slice
    const visible = new Set(oneHop.nodes.map((n) => n.slug));
    for (const edge of oneHop.edges) {
      expect(visible.has(edge.from)).toBe(true);
      expect(visible.has(edge.to)).toBe(true);
    }
  });

  it("returns the whole graph when the requested root is not a page", async () => {
    const graph = await buildLocalGraph({ repoPath: repo, root: "people/nobody", depth: 1 });
    expect(graph.nodes.length).toBe(6);
  });

  it("degrades to an empty graph (never an error) for a missing repo", async () => {
    expect(await buildLocalGraph({ repoPath: null })).toEqual({
      nodes: [],
      edges: [],
      pagesScanned: 0,
      truncated: false,
    });
    expect(await buildLocalGraph({ repoPath: path.join(repo, "does-not-exist") })).toEqual({
      nodes: [],
      edges: [],
      pagesScanned: 0,
      truncated: false,
    });
  });

  it("caps the node count and reports truncation", async () => {
    const graph = await buildLocalGraph({ repoPath: repo, maxNodes: 2 });
    expect(graph.nodes.length).toBe(2);
    expect(graph.truncated).toBe(true);
  });

  it("is deterministic — identical requests produce identical graphs", async () => {
    const a = await buildLocalGraph({ repoPath: repo });
    const b = await buildLocalGraph({ repoPath: repo });
    expect(a).toEqual(b);
  });
});
