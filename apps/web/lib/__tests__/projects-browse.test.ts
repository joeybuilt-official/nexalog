// SPDX-License-Identifier: MIT
// Tests for the pure projects browse layer (search / filter / sort / tree).
// The logic is pure, so these exercise it directly — no React render needed.

import { describe, it, expect } from "vitest";
import {
  DEFAULT_BROWSE_STATE,
  LIFECYCLE_FILTERS,
  PROJECT_SORTS,
  PROJECT_SORT_LABELS,
  browseProjects,
  buildProjectTree,
  compareProjects,
  countMatches,
  countRenderedRows,
  matchesFilters,
  matchesAllFilters,
  matchesHasSubProjects,
  matchesLifecycle,
  matchesQuery,
  sortProjects,
  type BrowsableProject,
  type BrowseState,
} from "@/lib/projects/browse";
import { LIFECYCLE_STATES } from "@/lib/projects/domain";

/** Minimal row factory — only the fields a test cares about are ever named. */
function project(overrides: Partial<BrowsableProject> & { id: string }): BrowsableProject {
  return {
    name: overrides.id,
    description: null,
    lifecycleState: "active",
    livingDocUpdatedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    parentId: null,
    itemCount: 0,
    subProjectCount: 0,
    ...overrides,
  };
}

function state(overrides: Partial<BrowseState> = {}): BrowseState {
  return { ...DEFAULT_BROWSE_STATE, ...overrides };
}

const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);

// The operator's real shape: 35 roots, 3 sub-projects. Two roots are named after
// the same brand, one of them carries a second brand in its description, and the
// three children sit under two different roots.
const tenTon = project({
  id: "10-ton",
  name: "10 Ton",
  description: "Heavy fabrication studio.",
  subProjectCount: 1,
});
const frameForge = project({
  id: "frame-forge",
  name: "Frame Forge",
  description: "Bike frame jig and tube-notching tooling.",
  parentId: "10-ton",
});
const fullOn = project({
  id: "full-on",
  name: "Full-On Pictures",
  description:
    "Influencer CRM for creator relationships — originally branded Angel Studios, rebranded to Lightcast.",
  subProjectCount: 2,
});
const fixItFleet = project({
  id: "fix-it-fleet",
  name: "Fix-It Fleet",
  description: "On-call repair dispatch.",
  parentId: "full-on",
});
const learningCurve = project({
  id: "learning-curve",
  name: "Learning Curve",
  description: "Tutorial pipeline.",
  parentId: "full-on",
});
const angelStudios = project({
  id: "angel-studios",
  name: "Angel Studios",
  description: "Distribution and release management.",
});
const orphan = project({
  id: "orphan",
  name: "Orphan Child",
  description: null,
  parentId: "a-project-that-is-not-here",
});

const ALL = [tenTon, frameForge, fullOn, fixItFleet, learningCurve, angelStudios, orphan];

describe("search matcher", () => {
  it("matches an empty query, and a whitespace-only one, against everything", () => {
    for (const p of ALL) {
      expect(matchesQuery(p, "")).toBe(true);
      expect(matchesQuery(p, "   \t ")).toBe(true);
    }
  });

  it("matches on name, case-insensitively", () => {
    expect(matchesQuery(fullOn, "full-on")).toBe(true);
    expect(matchesQuery(fullOn, "FULL-ON")).toBe(true);
    expect(matchesQuery(fullOn, "On PiCtUrEs")).toBe(true);
  });

  it("matches on description, case-insensitively", () => {
    expect(matchesQuery(fullOn, "influencer")).toBe(true);
    expect(matchesQuery(fullOn, "ANGEL STUDIOS")).toBe(true);
    expect(matchesQuery(tenTon, "fabrication")).toBe(true);
  });

  it("treats a null description as an empty one rather than a match-everything", () => {
    expect(matchesQuery(orphan, "orphan")).toBe(true);
    expect(matchesQuery(orphan, "dispatch")).toBe(false);
  });

  it("requires every token to appear (AND), across name and description together", () => {
    // "angel" is in the description, "pictures" in the name — one row, two fields.
    expect(matchesQuery(fullOn, "angel pictures")).toBe(true);
    expect(matchesQuery(fullOn, "pictures lightcast")).toBe(true);
    // "fleet" is only on another row, so the pair does not match.
    expect(matchesQuery(fullOn, "angel fleet")).toBe(false);
  });

  it("does not match a substring that spans two tokens in the wrong order across rows", () => {
    expect(matchesQuery(angelStudios, "lightcast")).toBe(false);
    expect(matchesQuery(tenTon, "forge")).toBe(false);
    expect(matchesQuery(frameForge, "10 ton")).toBe(false);
  });
});

describe("lifecycle filter", () => {
  it("offers exactly `all` plus the domain's own lifecycle values — derived, not invented", () => {
    expect(LIFECYCLE_FILTERS).toEqual(["all", ...LIFECYCLE_STATES]);
    expect(LIFECYCLE_FILTERS).toEqual(["all", "draft", "active", "archived"]);
  });

  it("`all` passes every state", () => {
    for (const lifecycleState of LIFECYCLE_STATES) {
      expect(matchesLifecycle(project({ id: "x", lifecycleState }), "all")).toBe(true);
    }
  });

  it("narrows to the named state", () => {
    const draft = project({ id: "d", lifecycleState: "draft" });
    const active = project({ id: "a", lifecycleState: "active" });
    expect(matchesLifecycle(draft, "draft")).toBe(true);
    expect(matchesLifecycle(draft, "active")).toBe(false);
    expect(matchesLifecycle(active, "draft")).toBe(false);
    expect(matchesLifecycle(active, "active")).toBe(true);
  });
});

describe("has-sub-projects filter", () => {
  it("is inert when off", () => {
    expect(matchesHasSubProjects(project({ id: "x" }), false)).toBe(true);
    expect(matchesHasSubProjects(frameForge, false)).toBe(true);
  });

  it("keeps only parents that actually have a sub-project when on", () => {
    expect(matchesHasSubProjects(project({ id: "leaf" }), true)).toBe(false);
    expect(matchesHasSubProjects(project({ id: "p", subProjectCount: 1 }), true)).toBe(true);
    expect(matchesHasSubProjects(project({ id: "p", subProjectCount: 2 }), true)).toBe(true);
  });
});

describe("filter composition", () => {
  it("applies search and lifecycle together on a row", () => {
    const rows = [
      project({ id: "a", name: "Alpha", lifecycleState: "active" }),
      project({ id: "b", name: "Alpha draft", lifecycleState: "draft" }),
      project({ id: "c", name: "Alpha leaf", lifecycleState: "active" }),
    ];
    expect(ids(rows.filter((r) => matchesFilters(r, state({ query: "alpha" })))).length).toBe(3);
    expect(
      ids(rows.filter((r) => matchesFilters(r, state({ query: "alpha", lifecycle: "active" })))),
    ).toEqual(["a", "c"]);
    expect(ids(rows.filter((r) => matchesFilters(r, state({ query: "beta" }))))).toEqual([]);
  });

  it("adds the has-sub-projects toggle only in the full predicate", () => {
    const parent = project({ id: "a", name: "Alpha", subProjectCount: 1 });
    const leaf = project({ id: "c", name: "Alpha leaf", subProjectCount: 0 });
    const withToggle = state({ query: "alpha", hasSubProjectsOnly: true });

    expect(matchesFilters(leaf, withToggle)).toBe(true);
    expect(matchesAllFilters(leaf, withToggle)).toBe(false);
    expect(matchesAllFilters(parent, withToggle)).toBe(true);
  });
});

describe("sort comparators", () => {
  const a = project({
    id: "a",
    name: "apple",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    itemCount: 2,
    subProjectCount: 0,
  });
  const b = project({
    id: "b",
    name: "Banana",
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-01-15T00:00:00.000Z",
    itemCount: 9,
    subProjectCount: 3,
  });
  const c = project({
    id: "c",
    name: "cherry",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-01-15T00:00:00.000Z",
    itemCount: 0,
    subProjectCount: 1,
  });

  it("name: A–Z, case-insensitive", () => {
    expect(ids(sortProjects([c, b, a], "name"))).toEqual(["a", "b", "c"]);
    expect(ids(sortProjects([c, b, a], "name"))).toEqual(["a", "b", "c"]);
  });

  it("recently updated: newest first", () => {
    expect(ids(sortProjects([b, c, a], "recently-updated"))).toEqual(["a", "b", "c"]);
  });

  it("recently created: newest first", () => {
    expect(ids(sortProjects([a, b, c], "recently-created"))).toEqual(["c", "b", "a"]);
  });

  it("most members: descending by item count", () => {
    expect(ids(sortProjects([c, a, b], "most-members"))).toEqual(["b", "a", "c"]);
  });

  it("most sub-projects: descending by sub-project count", () => {
    expect(ids(sortProjects([a, c, b], "most-sub-projects"))).toEqual(["b", "c", "a"]);
  });

  it("accepts Date and ISO-string timestamps interchangeably (the prop arrives either way)", () => {
    const asDate = { ...a, updatedAt: new Date("2026-03-01T00:00:00.000Z") };
    const asString = { ...a, updatedAt: "2026-03-01T00:00:00.000Z" };
    expect(compareProjects("recently-updated")(asDate, b)).toBe(
      compareProjects("recently-updated")(asString, b),
    );
  });

  it("breaks ties by case-insensitive name, so equal keys never leave output to chance", () => {
    const early = project({ id: "z", name: "Zed", updatedAt: "2026-05-01T00:00:00.000Z" });
    const late = project({ id: "y", name: "zed", updatedAt: "2026-05-01T00:00:00.000Z" });
    expect(ids(sortProjects([late, early], "recently-updated"))).toEqual(["y", "z"]);
  });

  it("sinks an unparseable or absent timestamp to the end instead of poisoning the sort", () => {
    const known = project({ id: "known", name: "Known", updatedAt: "2020-01-01T00:00:00.000Z" });
    const unknown = project({ id: "unknown", name: "Unknown", updatedAt: "not-a-date" });
    const missing = project({ id: "missing", name: "Missing", updatedAt: null as unknown as string });
    expect(ids(sortProjects([unknown, missing, known], "recently-updated"))).toEqual([
      "known",
      "missing",
      "unknown",
    ]);
    expect(ids(sortProjects([unknown, missing, known], "recently-created").slice(0, 1))).toEqual([
      "known",
    ]);
  });

  it("is a total order — every pair returns a decisive sign for every key", () => {
    for (const sort of PROJECT_SORTS) {
      const compare = compareProjects(sort);
      expect(compare(a, a)).toBe(0);
      expect(Math.sign(compare(a, b))).toBe(-Math.sign(compare(b, a)));
      expect(PROJECT_SORT_LABELS[sort]).toBeTruthy();
    }
  });

  it("does not mutate the input array", () => {
    const input = [c, b, a];
    sortProjects(input, "name");
    expect(ids(input)).toEqual(["c", "b", "a"]);
  });
});

describe("tree construction", () => {
  it("keeps a two-level tree: roots at the top, children under their parent", () => {
    const { roots, childrenOf } = buildProjectTree(ALL);
    expect(ids(roots)).toEqual(["10-ton", "full-on", "angel-studios", "orphan"]);
    expect(ids(childrenOf.get("10-ton") ?? [])).toEqual(["frame-forge"]);
    expect(ids(childrenOf.get("full-on") ?? [])).toEqual(["fix-it-fleet", "learning-curve"]);
  });

  it("treats a project whose parent is absent from the set as a root (never drops it)", () => {
    const { roots } = buildProjectTree([orphan]);
    expect(ids(roots)).toEqual(["orphan"]);
  });

  it("treats a self-parent as a root", () => {
    const { roots } = buildProjectTree([project({ id: "self", parentId: "self" })]);
    expect(ids(roots)).toEqual(["self"]);
  });

  it("promotes a malformed third level to a root instead of hiding it at a second indent", () => {
    const deep = project({ id: "deep", parentId: "frame-forge" });
    const { roots, childrenOf } = buildProjectTree([...ALL, deep]);
    expect(ids(roots)).toContain("deep");
    expect(ids(childrenOf.get("frame-forge") ?? [])).toEqual([]);
  });

  it("renders both rows of a malformed cycle rather than neither", () => {
    const x = project({ id: "x", parentId: "y" });
    const y = project({ id: "y", parentId: "x" });
    expect(ids(buildProjectTree([x, y]).roots)).toEqual(["x", "y"]);
  });
});

describe("browseProjects — the A1.7 invariant: a matching child is never hidden by its parent", () => {
  it("renders the parent as a CONTEXT row when only the child matches the search", () => {
    const groups = browseProjects(ALL, state({ query: "learning curve" }));
    expect(groups).toHaveLength(1);
    expect(groups[0].parent.id).toBe("full-on");
    expect(groups[0].contextOnly).toBe(true);
    expect(ids(groups[0].children)).toEqual(["learning-curve"]);
    expect(countRenderedRows(groups)).toBe(2);
  });

  it("keeps the child's sibling out of a filtered group, and still renders the child", () => {
    const groups = browseProjects(ALL, state({ query: "fix-it fleet" }));
    expect(groups[0].parent.id).toBe("full-on");
    expect(ids(groups[0].children)).toEqual(["fix-it-fleet"]);
  });

  it("applies the lifecycle filter to rows while the child still survives the parent's filtered state", () => {
    const rows = [
      project({ id: "parent", name: "Parent", lifecycleState: "archived" }),
      project({ id: "child", name: "Child", lifecycleState: "active", parentId: "parent" }),
    ];
    const groups = browseProjects(rows, state({ lifecycle: "active" }));
    expect(groups).toHaveLength(1);
    expect(groups[0].parent.id).toBe("parent");
    expect(groups[0].contextOnly).toBe(true);
    expect(ids(groups[0].children)).toEqual(["child"]);
  });

  it("hides the pair only when NEITHER matches, and never renders an empty group", () => {
    expect(browseProjects(ALL, state({ query: "nothing here" }))).toEqual([]);
    const rows = [
      project({ id: "parent", lifecycleState: "archived", subProjectCount: 1 }),
      project({ id: "child", parentId: "parent", lifecycleState: "archived" }),
    ];
    expect(browseProjects(rows, state({ lifecycle: "active" }))).toEqual([]);
  });

  it("does not mark the parent as a context row when it matches too", () => {
    const groups = browseProjects(
      [project({ id: "p", name: "Same" }), project({ id: "c", name: "Same Child", parentId: "p" })],
      state({ query: "same" }),
    );
    expect(groups[0].contextOnly).toBe(false);
    expect(ids(groups[0].children)).toEqual(["c"]);
  });

  it("keeps the sub-project visible under the has-sub-projects toggle, in both directions", () => {
    // ON: it selects the roots that HAVE a sub-project — and their children come
    // with them. A sub-project is childless by construction, so applying the
    // toggle to rows would have hidden exactly the rows it is named after.
    const on = browseProjects(ALL, state({ hasSubProjectsOnly: true }));
    expect(ids(on.map((g) => g.parent))).toEqual(["10-ton", "full-on"]);
    expect(on.every((g) => g.contextOnly === false)).toBe(true);
    expect(ids(on.flatMap((g) => g.children))).toEqual([
      "frame-forge",
      "fix-it-fleet",
      "learning-curve",
    ]);
    // The counts themselves ARE the reason: a leaf is filtered out, a parent in.
    expect(matchesHasSubProjects(project({ id: "leaf" }), true)).toBe(false);
    expect(matchesHasSubProjects(tenTon, true)).toBe(true);
    // OFF: nothing about the toggle, so nothing is removed.
    const off = browseProjects(ALL, state({ hasSubProjectsOnly: false }));
    expect(countRenderedRows(off)).toBe(ALL.length);
  });

  it("does not hide a sub-project whose parent the lifecycle filter drops", () => {
    // "All states" off, the parent archived, the child active: the parent comes
    // back as a context row and the child is still rendered — the toggle on top
    // of it changes nothing about that.
    const rows = [
      project({ id: "p", name: "Plain parent", lifecycleState: "archived", subProjectCount: 1 }),
      project({ id: "c", name: "Active child", parentId: "p", lifecycleState: "active" }),
    ];
    for (const hasSubProjectsOnly of [false, true]) {
      const groups = browseProjects(rows, state({ lifecycle: "active", hasSubProjectsOnly }));
      expect(groups).toHaveLength(1);
      expect(groups[0].parent.id).toBe("p");
      expect(groups[0].contextOnly).toBe(true);
      expect(ids(groups[0].children)).toEqual(["c"]);
    }
  });
});

describe("browseProjects — ordering", () => {
  const rows = [
    project({ id: "r1", name: "Beta", itemCount: 1, updatedAt: "2026-03-01T00:00:00.000Z" }),
    project({ id: "r2", name: "Alpha", itemCount: 5, updatedAt: "2026-01-01T00:00:00.000Z" }),
    project({ id: "c1", name: "Zeta child", parentId: "r1", itemCount: 4, updatedAt: "2026-05-01T00:00:00.000Z" }),
  ];

  it("orders groups by name on the sort by name", () => {
    expect(ids(browseProjects(rows, state({ sort: "name" })).map((g) => g.parent))).toEqual([
      "r2",
      "r1",
    ]);
  });

  it("orders groups by the parent's own key when the parent matches", () => {
    expect(ids(browseProjects(rows, state({ sort: "most-members" })).map((g) => g.parent))).toEqual([
      "r2",
      "r1",
    ]);
    expect(ids(browseProjects(rows, state({ sort: "recently-updated" })).map((g) => g.parent))).toEqual([
      "r1",
      "r2",
    ]);
  });

  it("orders a context group by the MATCHING CHILD's key, not the context row's", () => {
    // Only the child carries the term in its description, and only the other
    // root carries it in its name. The child is newer than that root, while its
    // own parent is older than it — so the two orderings disagree and the test
    // can tell which one the implementation uses.
    const rows = [
      project({ id: "r1", name: "Beta", updatedAt: "2026-03-01T00:00:00.000Z" }),
      project({
        id: "c1",
        name: "Zeta child",
        parentId: "r1",
        updatedAt: "2026-05-01T00:00:00.000Z",
        description: "Reworked recently.",
      }),
      project({ id: "r3", name: "Recent root", updatedAt: "2026-04-01T00:00:00.000Z" }),
    ];

    const byUpdated = browseProjects(rows, state({ query: "recent", sort: "recently-updated" }));
    expect(ids(byUpdated.map((g) => g.parent))).toEqual(["r1", "r3"]);
    expect(byUpdated[0].contextOnly).toBe(true);
    expect(ids(byUpdated[0].children)).toEqual(["c1"]);

    // Same disagreement on name: "Zeta child" > "Recent root", but the context
    // row is "Beta" < "Recent root".
    const byName = browseProjects(rows, state({ query: "recent", sort: "name" }));
    expect(ids(byName.map((g) => g.parent))).toEqual(["r3", "r1"]);
  });

  it("sorts children under their parent with the same comparator", () => {
    const groups = browseProjects(ALL, state({ sort: "name" }));
    expect(ids(groups.find((g) => g.parent.id === "full-on")!.children)).toEqual([
      "fix-it-fleet",
      "learning-curve",
    ]);
  });

  it("leaves the default order alone (the store already returns updated_at desc)", () => {
    const groups = browseProjects(ALL, DEFAULT_BROWSE_STATE);
    expect(groups.every((g) => g.contextOnly === false)).toBe(true);
    expect(countRenderedRows(groups)).toBe(ALL.length);
  });

  it("renders every row when nothing is filtered — no row is ever lost by the tree", () => {
    for (const sort of PROJECT_SORTS) {
      expect(countRenderedRows(browseProjects(ALL, state({ sort })))).toBe(ALL.length);
    }
  });
});

describe("counting", () => {
  it("counts rendered rows, context rows included", () => {
    const groups = browseProjects(ALL, state({ query: "learning curve" }));
    expect(countRenderedRows(groups)).toBe(2);
  });

  it("counts MATCHES only, so a context row is not reported as a search hit", () => {
    const groups = browseProjects(ALL, state({ query: "learning curve" }));
    expect(countRenderedRows(groups)).toBe(2);
    expect(countMatches(ALL, state({ query: "learning curve" }))).toBe(1);
  });

  it("agrees with the rendered rows when nothing is narrowed", () => {
    expect(countMatches(ALL, DEFAULT_BROWSE_STATE)).toBe(ALL.length);
    expect(countRenderedRows(browseProjects(ALL, DEFAULT_BROWSE_STATE))).toBe(ALL.length);
  });

  it("counts a matching child under the has-sub-projects toggle, and never the context row", () => {
    const rows = [
      project({ id: "p", name: "Parent", lifecycleState: "archived", subProjectCount: 1 }),
      project({ id: "c", name: "Child", parentId: "p", lifecycleState: "active" }),
    ];
    expect(countMatches(rows, state({ lifecycle: "active" }))).toBe(1);
    expect(countRenderedRows(browseProjects(rows, state({ lifecycle: "active" })))).toBe(2);
  });
});
