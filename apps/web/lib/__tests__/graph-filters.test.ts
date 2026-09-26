// SPDX-License-Identifier: MIT
// Garden polish: per-type node filters + title search (pure logic).
import { describe, it, expect } from "vitest";

import {
  FILTER_GROUPS,
  FILTER_GROUP_LABELS,
  countsByGroup,
  filterNodes,
  groupForNode,
  groupForType,
  isUnfiltered,
  matchesQuery,
  rankMatches,
  type FilterGroup,
} from "@/lib/graph/filters";

const ALL: FilterGroup[] = [...FILTER_GROUPS];

/** A small mixed graph: 3 people, 2 companies, 1 note (ungrouped). */
const NODES = [
  { slug: "people/example-person", title: "Example Person", type: "people" },
  { slug: "people/alice", title: "Alice Nguyen", type: "person" },
  { slug: "people/bob", title: "Bob Reyes", type: "people" },
  { slug: "companies/joeybuilt", title: "Joeybuilt", type: "companies" },
  { slug: "companies/kapsel", title: "Kapsel", type: "company" },
  { slug: "notes/random-thought", title: "A random thought", type: "note" },
];

describe("groupForType", () => {
  it("folds singular frontmatter types and plural slug segments into one group", () => {
    expect(groupForType("person")).toBe("people");
    expect(groupForType("people")).toBe("people");
    expect(groupForType("COMPANY")).toBe("companies");
    expect(groupForType(" companies ")).toBe("companies");
    expect(groupForType("atom")).toBe("atoms");
  });

  it("returns null for types the five chips do not cover", () => {
    for (const type of ["note", "source", "media", "conversation", "", "  "]) {
      expect(groupForType(type)).toBeNull();
    }
    expect(groupForType(null)).toBeNull();
    expect(groupForType(undefined)).toBeNull();
  });
});

describe("groupForNode", () => {
  it("prefers the page's own type", () => {
    expect(groupForNode({ slug: "notes/x", title: "X", type: "person" })).toBe("people");
  });

  it("falls back to the slug's first segment when the type is unusable", () => {
    // /api/graph reports the slug segment for seeds before it has read the page.
    expect(groupForNode({ slug: "projects/panoply", title: "Panoply", type: "" })).toBe("projects");
    expect(groupForNode({ slug: "concepts/litellm", title: "LiteLLM", type: "unknown" })).toBe(
      "concepts",
    );
  });

  it("is null for a page outside the five groups", () => {
    expect(groupForNode({ slug: "notes/x", title: "X", type: "note" })).toBeNull();
    expect(groupForNode({ slug: "inbox/01J8", title: "capture", type: "note" })).toBeNull();
  });
});

describe("countsByGroup", () => {
  it("counts nodes per chip and ignores ungrouped nodes", () => {
    const counts = countsByGroup(NODES);
    expect(counts.people).toBe(3);
    expect(counts.companies).toBe(2);
    expect(counts.concepts).toBe(0);
    expect(counts.projects).toBe(0);
    expect(counts.atoms).toBe(0);
  });

  it("every group has a label", () => {
    for (const group of FILTER_GROUPS) {
      expect(FILTER_GROUP_LABELS[group]).toBeTruthy();
    }
  });
});

describe("isUnfiltered", () => {
  it("is true only when all five chips are on", () => {
    expect(isUnfiltered(ALL)).toBe(true);
    expect(isUnfiltered([])).toBe(false);
    expect(isUnfiltered(["people"])).toBe(false);
    expect(isUnfiltered(ALL.filter((g) => g !== "atoms"))).toBe(false);
  });
});

describe("matchesQuery", () => {
  it("matches title case-insensitively, ignoring surrounding spaces", () => {
    expect(matchesQuery(NODES[0], "example")).toBe(true);
    expect(matchesQuery(NODES[0], "  EXAM  ")).toBe(true);
    expect(matchesQuery(NODES[0], "zzz")).toBe(false);
  });

  it("matches the slug too, and treats an empty query as matching everything", () => {
    expect(matchesQuery(NODES[5], "random-thought")).toBe(true);
    expect(matchesQuery(NODES[5], "")).toBe(true);
    expect(matchesQuery(NODES[5], "   ")).toBe(true);
  });
});

describe("filterNodes", () => {
  it("is a no-op when every chip is on and there is no query", () => {
    expect(filterNodes(NODES, ALL, "")).toEqual(NODES);
  });

  it("keeps only the active groups", () => {
    const people = filterNodes(NODES, ["people"], "");
    expect(people.map((n) => n.slug)).toEqual(["people/example-person", "people/alice", "people/bob"]);
  });

  it("hides ungrouped nodes as soon as any chip is switched off", () => {
    // "notes/random-thought" is not a chip group; keeping it would leak a note
    // into a "Companies only" view.
    const companies = filterNodes(NODES, ["companies"], "");
    expect(companies.map((n) => n.slug)).toEqual(["companies/joeybuilt", "companies/kapsel"]);
    expect(companies.some((n) => n.slug.startsWith("notes/"))).toBe(false);
  });

  it("combines the type chips with the title query", () => {
    const hits = filterNodes(NODES, ["people"], "bob");
    expect(hits.map((n) => n.slug)).toEqual(["people/bob"]);
    expect(filterNodes(NODES, ["companies"], "bob")).toEqual([]);
  });

  it("returns nothing (not everything) when no chip is active", () => {
    expect(filterNodes(NODES, [], "")).toEqual([]);
  });

  it("preserves the incoming order so the canvas does not reshuffle", () => {
    const reversed = [...NODES].reverse();
    expect(filterNodes(reversed, ALL, "").map((n) => n.slug)).toEqual(reversed.map((n) => n.slug));
  });
});

describe("rankMatches", () => {
  it("suggests nothing for an empty query", () => {
    expect(rankMatches(NODES, "")).toEqual([]);
    expect(rankMatches(NODES, "   ")).toEqual([]);
  });

  it("ranks title-prefix ahead of title-substring ahead of slug-only hits", () => {
    const hits = rankMatches(
      [
        { slug: "concepts/a", title: "Gateway Concept", type: "concept" },
        { slug: "gateway/page", title: "Zed", type: "note" },
        { slug: "concepts/b", title: "Gateway", type: "concept" },
      ],
      "gateway",
    );
    expect(hits.map((n) => n.slug)).toEqual(["concepts/b", "concepts/a", "gateway/page"]);
  });

  it("caps the list and is stable between keystrokes", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      slug: `people/p${i}`,
      title: `Person ${i}`,
      type: "person",
    }));
    expect(rankMatches(many, "person", 8)).toHaveLength(8);
    expect(rankMatches(many, "person", 8).map((n) => n.slug)).toEqual(
      rankMatches([...many].reverse(), "person", 8).map((n) => n.slug),
    );
  });

  it("matches on the slug when the title does not contain the query", () => {
    const hits = rankMatches(NODES, "litellm".slice(0, 3)); // "lit"
    expect(hits).toEqual([]);
    const slugHit = rankMatches(NODES, "example-person");
    expect(slugHit[0].slug).toBe("people/example-person");
  });
});
