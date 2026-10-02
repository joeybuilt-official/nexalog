// SPDX-License-Identifier: MIT
// Tests for the pure projects browse layer (search / filter / sort / tree).
// The rules are pure, so these exercise them directly — no widget pump needed.
//
// These mirror the web's `apps/web/lib/__tests__/projects-browse.test.ts`: the
// mobile module is a PORT, so the same fixtures and the same expectations are
// the proof that it did not drift. The A1.7 invariant — a matching sub-project
// is never hidden because its parent was filtered out — is the property that
// earns its own group.

import "package:flutter_test/flutter_test.dart";
import "package:nexalog_mobile/src/features/projects/project_browse.dart";

/// Minimal row factory — only the fields a test cares about are ever named.
BrowsableProject project(
  String id, {
  String? name,
  String? description,
  String lifecycleState = "active",
  String? livingDocUpdatedAt,
  String createdAt = "2026-01-01T00:00:00.000Z",
  String? updatedAt = "2026-01-01T00:00:00.000Z",
  String? parentId,
  int itemCount = 0,
  int subProjectCount = 0,
}) {
  return BrowsableProject(
    id: id,
    name: name ?? id,
    description: description,
    lifecycleState: lifecycleState,
    livingDocUpdatedAt: livingDocUpdatedAt,
    createdAt: createdAt,
    updatedAt: updatedAt,
    parentId: parentId,
    itemCount: itemCount,
    subProjectCount: subProjectCount,
  );
}

BrowseState state({
  String query = "",
  String lifecycle = "all",
  bool hasSubProjectsOnly = false,
  String sort = "recently-updated",
}) =>
    BrowseState(
      query: query,
      lifecycle: lifecycle,
      hasSubProjectsOnly: hasSubProjectsOnly,
      sort: sort,
    );

List<String> ids(List<BrowsableProject> rows) => rows.map((BrowsableProject r) => r.id).toList();

// The operator's real shape: roots and sub-projects. Two roots are named after
// the same brand, one of them carries a second brand in its description, and
// the children sit under two different roots.
final BrowsableProject tenTon = project(
  "10-ton",
  name: "10 Ton",
  description: "Heavy fabrication studio.",
  subProjectCount: 1,
);
final BrowsableProject frameForge = project(
  "frame-forge",
  name: "Frame Forge",
  description: "Bike frame jig and tube-notching tooling.",
  parentId: "10-ton",
);
final BrowsableProject fullOn = project(
  "full-on",
  name: "Full-On Pictures",
  description:
      "Influencer CRM for creator relationships — originally branded Angel Studios, rebranded to Lightcast.",
  subProjectCount: 2,
);
final BrowsableProject fixItFleet = project(
  "fix-it-fleet",
  name: "Fix-It Fleet",
  description: "On-call repair dispatch.",
  parentId: "full-on",
);
final BrowsableProject learningCurve = project(
  "learning-curve",
  name: "Learning Curve",
  description: "Tutorial pipeline.",
  parentId: "full-on",
);
final BrowsableProject angelStudios = project(
  "angel-studios",
  name: "Angel Studios",
  description: "Distribution and release management.",
);
final BrowsableProject orphan = project(
  "orphan",
  name: "Orphan Child",
  description: null,
  parentId: "a-project-that-is-not-here",
);

final List<BrowsableProject> all = <BrowsableProject>[
  tenTon,
  frameForge,
  fullOn,
  fixItFleet,
  learningCurve,
  angelStudios,
  orphan,
];

void main() {
  group("search matcher", () {
    test("matches an empty query, and a whitespace-only one, against everything", () {
      for (final BrowsableProject p in all) {
        expect(matchesQuery(p, ""), isTrue);
        expect(matchesQuery(p, "   \t "), isTrue);
      }
    });

    test("matches on name, case-insensitively", () {
      expect(matchesQuery(fullOn, "full-on"), isTrue);
      expect(matchesQuery(fullOn, "FULL-ON"), isTrue);
      expect(matchesQuery(fullOn, "On PiCtUrEs"), isTrue);
    });

    test("matches on description, case-insensitively", () {
      expect(matchesQuery(fullOn, "influencer"), isTrue);
      expect(matchesQuery(fullOn, "ANGEL STUDIOS"), isTrue);
      expect(matchesQuery(tenTon, "fabrication"), isTrue);
    });

    test("treats a null description as an empty one rather than a match-everything", () {
      expect(matchesQuery(orphan, "orphan"), isTrue);
      expect(matchesQuery(orphan, "dispatch"), isFalse);
    });

    test("requires every token to appear (AND), across name and description together", () {
      // "angel" is in the description, "pictures" in the name — one row, two fields.
      expect(matchesQuery(fullOn, "angel pictures"), isTrue);
      expect(matchesQuery(fullOn, "pictures lightcast"), isTrue);
      // "fleet" is only on another row, so the pair does not match.
      expect(matchesQuery(fullOn, "angel fleet"), isFalse);
    });

    test("does not match a substring that spans two tokens in the wrong order across rows", () {
      expect(matchesQuery(angelStudios, "lightcast"), isFalse);
      expect(matchesQuery(tenTon, "forge"), isFalse);
      expect(matchesQuery(frameForge, "10 ton"), isFalse);
    });
  });

  group("lifecycle filter", () {
    test("offers exactly `all` plus the domain's own lifecycle values — derived, not invented", () {
      expect(kLifecycleFilters, <String>["all", ...kLifecycleStates]);
      expect(kLifecycleFilters, <String>["all", "draft", "active", "archived"]);
    });

    test("`all` passes every state", () {
      for (final String lifecycleState in kLifecycleStates) {
        expect(matchesLifecycle(project("x", lifecycleState: lifecycleState), "all"), isTrue);
      }
    });

    test("narrows to the named state", () {
      final BrowsableProject draft = project("d", lifecycleState: "draft");
      final BrowsableProject active = project("a", lifecycleState: "active");
      expect(matchesLifecycle(draft, "draft"), isTrue);
      expect(matchesLifecycle(draft, "active"), isFalse);
      expect(matchesLifecycle(active, "draft"), isFalse);
      expect(matchesLifecycle(active, "active"), isTrue);
    });
  });

  group("has-sub-projects filter", () {
    test("is inert when off", () {
      expect(matchesHasSubProjects(project("x"), false), isTrue);
      expect(matchesHasSubProjects(frameForge, false), isTrue);
    });

    test("keeps only parents that actually have a sub-project when on", () {
      expect(matchesHasSubProjects(project("leaf"), true), isFalse);
      expect(matchesHasSubProjects(project("p", subProjectCount: 1), true), isTrue);
      expect(matchesHasSubProjects(project("p", subProjectCount: 2), true), isTrue);
    });
  });

  group("filter composition", () {
    test("applies search and lifecycle together on a row", () {
      final List<BrowsableProject> rows = <BrowsableProject>[
        project("a", name: "Alpha", lifecycleState: "active"),
        project("b", name: "Alpha draft", lifecycleState: "draft"),
        project("c", name: "Alpha leaf", lifecycleState: "active"),
      ];
      expect(
        ids(rows.where((BrowsableProject r) => matchesFilters(r, state(query: "alpha"))).toList())
            .length,
        3,
      );
      expect(
        ids(rows
            .where((BrowsableProject r) =>
                matchesFilters(r, state(query: "alpha", lifecycle: "active")))
            .toList()),
        <String>["a", "c"],
      );
      expect(
        ids(rows.where((BrowsableProject r) => matchesFilters(r, state(query: "beta"))).toList()),
        <String>[],
      );
    });

    test("adds the has-sub-projects toggle only in the full predicate", () {
      final BrowsableProject parent = project("a", name: "Alpha", subProjectCount: 1);
      final BrowsableProject leaf = project("c", name: "Alpha leaf", subProjectCount: 0);
      final BrowseState withToggle = state(query: "alpha", hasSubProjectsOnly: true);

      expect(matchesFilters(leaf, withToggle), isTrue);
      expect(matchesAllFilters(leaf, withToggle), isFalse);
      expect(matchesAllFilters(parent, withToggle), isTrue);
    });
  });

  group("sort comparators", () {
    final BrowsableProject a = project(
      "a",
      name: "apple",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
      itemCount: 2,
      subProjectCount: 0,
    );
    final BrowsableProject b = project(
      "b",
      name: "Banana",
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-01-15T00:00:00.000Z",
      itemCount: 9,
      subProjectCount: 3,
    );
    final BrowsableProject c = project(
      "c",
      name: "cherry",
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-01-15T00:00:00.000Z",
      itemCount: 0,
      subProjectCount: 1,
    );

    test("name: A–Z, case-insensitive", () {
      expect(ids(sortProjects(<BrowsableProject>[c, b, a], "name")), <String>["a", "b", "c"]);
      expect(ids(sortProjects(<BrowsableProject>[c, b, a], "name")), <String>["a", "b", "c"]);
    });

    test("recently updated: newest first", () {
      expect(
        ids(sortProjects(<BrowsableProject>[b, c, a], "recently-updated")),
        <String>["a", "b", "c"],
      );
    });

    test("recently created: newest first", () {
      expect(
        ids(sortProjects(<BrowsableProject>[a, b, c], "recently-created")),
        <String>["c", "b", "a"],
      );
    });

    test("most members: descending by item count", () {
      expect(ids(sortProjects(<BrowsableProject>[c, a, b], "most-members")), <String>["b", "a", "c"]);
    });

    test("most sub-projects: descending by sub-project count", () {
      expect(
        ids(sortProjects(<BrowsableProject>[a, c, b], "most-sub-projects")),
        <String>["b", "c", "a"],
      );
    });

    test("breaks ties by case-insensitive name, so equal keys never leave output to chance", () {
      final BrowsableProject early = project(
        "z",
        name: "Zed",
        updatedAt: "2026-05-01T00:00:00.000Z",
      );
      final BrowsableProject late = project(
        "y",
        name: "zed",
        updatedAt: "2026-05-01T00:00:00.000Z",
      );
      expect(
        ids(sortProjects(<BrowsableProject>[late, early], "recently-updated")),
        <String>["y", "z"],
      );
    });

    test("sinks an unparseable or absent timestamp to the end instead of poisoning the sort", () {
      final BrowsableProject known =
          project("known", name: "Known", updatedAt: "2020-01-01T00:00:00.000Z");
      final BrowsableProject unknown = project("unknown", name: "Unknown", updatedAt: "not-a-date");
      final BrowsableProject missing = project("missing", name: "Missing", updatedAt: null);
      expect(
        ids(sortProjects(<BrowsableProject>[unknown, missing, known], "recently-updated")),
        <String>["known", "missing", "unknown"],
      );
      expect(
        ids(sortProjects(<BrowsableProject>[unknown, missing, known], "recently-created")
            .take(1)
            .toList()),
        <String>["known"],
      );
    });

    test("is a total order — every pair returns a decisive sign for every key", () {
      for (final String sort in kProjectSorts) {
        final int Function(BrowsableProject, BrowsableProject) compare = compareProjects(sort);
        expect(compare(a, a), 0);
        expect(compare(a, b).sign, -compare(b, a).sign);
        expect(kProjectSortLabels[sort], isNotNull);
      }
    });

    test("does not mutate the input array", () {
      final List<BrowsableProject> input = <BrowsableProject>[c, b, a];
      sortProjects(input, "name");
      expect(ids(input), <String>["c", "b", "a"]);
    });
  });

  group("tree construction", () {
    test("keeps a two-level tree: roots at the top, children under their parent", () {
      final ProjectTree tree = buildProjectTree(all);
      expect(
        ids(tree.roots),
        <String>["10-ton", "full-on", "angel-studios", "orphan"],
      );
      expect(ids(tree.childrenOf["10-ton"] ?? <BrowsableProject>[]), <String>["frame-forge"]);
      expect(
        ids(tree.childrenOf["full-on"] ?? <BrowsableProject>[]),
        <String>["fix-it-fleet", "learning-curve"],
      );
    });

    test("treats a project whose parent is absent from the set as a root (never drops it)", () {
      expect(ids(buildProjectTree(<BrowsableProject>[orphan]).roots), <String>["orphan"]);
    });

    test("treats a self-parent as a root", () {
      expect(
        ids(buildProjectTree(<BrowsableProject>[project("self", parentId: "self")]).roots),
        <String>["self"],
      );
    });

    test("promotes a malformed third level to a root instead of hiding it at a second indent", () {
      final BrowsableProject deep = project("deep", parentId: "frame-forge");
      final ProjectTree tree = buildProjectTree(<BrowsableProject>[...all, deep]);
      expect(ids(tree.roots), contains("deep"));
      expect(ids(tree.childrenOf["frame-forge"] ?? <BrowsableProject>[]), <String>[]);
    });

    test("renders both rows of a malformed cycle rather than neither", () {
      final BrowsableProject x = project("x", parentId: "y");
      final BrowsableProject y = project("y", parentId: "x");
      expect(ids(buildProjectTree(<BrowsableProject>[x, y]).roots), <String>["x", "y"]);
    });
  });

  group("browseProjects — the A1.7 invariant: a matching child is never hidden by its parent", () {
    test("renders the parent as a CONTEXT row when only the child matches the search", () {
      final List<BrowseGroup> groups = browseProjects(all, state(query: "learning curve"));
      expect(groups.length, 1);
      expect(groups[0].parent.id, "full-on");
      expect(groups[0].contextOnly, isTrue);
      expect(ids(groups[0].children), <String>["learning-curve"]);
      expect(countRenderedRows(groups), 2);
    });

    test("keeps the child's sibling out of a filtered group, and still renders the child", () {
      final List<BrowseGroup> groups = browseProjects(all, state(query: "fix-it fleet"));
      expect(groups[0].parent.id, "full-on");
      expect(ids(groups[0].children), <String>["fix-it-fleet"]);
    });

    test("applies the lifecycle filter to rows while the child still survives the parent's filtered state", () {
      final List<BrowsableProject> rows = <BrowsableProject>[
        project("parent", name: "Parent", lifecycleState: "archived"),
        project("child", name: "Child", lifecycleState: "active", parentId: "parent"),
      ];
      final List<BrowseGroup> groups = browseProjects(rows, state(lifecycle: "active"));
      expect(groups.length, 1);
      expect(groups[0].parent.id, "parent");
      expect(groups[0].contextOnly, isTrue);
      expect(ids(groups[0].children), <String>["child"]);
    });

    test("hides the pair only when NEITHER matches, and never renders an empty group", () {
      expect(browseProjects(all, state(query: "nothing here")), isEmpty);
      final List<BrowsableProject> rows = <BrowsableProject>[
        project("parent", lifecycleState: "archived", subProjectCount: 1),
        project("child", parentId: "parent", lifecycleState: "archived"),
      ];
      expect(browseProjects(rows, state(lifecycle: "active")), isEmpty);
    });

    test("does not mark the parent as a context row when it matches too", () {
      final List<BrowseGroup> groups = browseProjects(
        <BrowsableProject>[
          project("p", name: "Same"),
          project("c", name: "Same Child", parentId: "p"),
        ],
        state(query: "same"),
      );
      expect(groups[0].contextOnly, isFalse);
      expect(ids(groups[0].children), <String>["c"]);
    });

    test("keeps the sub-project visible under the has-sub-projects toggle, in both directions", () {
      // ON: it selects the roots that HAVE a sub-project — and their children come
      // with them. A sub-project is childless by construction, so applying the
      // toggle to rows would have hidden exactly the rows it is named after.
      final List<BrowseGroup> on = browseProjects(all, state(hasSubProjectsOnly: true));
      expect(ids(on.map((BrowseGroup g) => g.parent).toList()), <String>["10-ton", "full-on"]);
      expect(on.every((BrowseGroup g) => g.contextOnly == false), isTrue);
      expect(
        ids(on.expand((BrowseGroup g) => g.children).toList()),
        <String>["frame-forge", "fix-it-fleet", "learning-curve"],
      );
      // The counts themselves ARE the reason: a leaf is filtered out, a parent in.
      expect(matchesHasSubProjects(project("leaf"), true), isFalse);
      expect(matchesHasSubProjects(tenTon, true), isTrue);
      // OFF: nothing about the toggle, so nothing is removed.
      final List<BrowseGroup> off = browseProjects(all, state());
      expect(countRenderedRows(off), all.length);
    });

    test("does not hide a sub-project whose parent the lifecycle filter drops", () {
      // The parent archived, the child active: the parent comes back as a context
      // row and the child is still rendered — the toggle on top changes nothing.
      final List<BrowsableProject> rows = <BrowsableProject>[
        project("p", name: "Plain parent", lifecycleState: "archived", subProjectCount: 1),
        project("c", name: "Active child", parentId: "p", lifecycleState: "active"),
      ];
      for (final bool hasSubProjectsOnly in <bool>[false, true]) {
        final List<BrowseGroup> groups =
            browseProjects(rows, state(lifecycle: "active", hasSubProjectsOnly: hasSubProjectsOnly));
        expect(groups.length, 1);
        expect(groups[0].parent.id, "p");
        expect(groups[0].contextOnly, isTrue);
        expect(ids(groups[0].children), <String>["c"]);
      }
    });
  });

  group("browseProjects — ordering", () {
    final List<BrowsableProject> rows = <BrowsableProject>[
      project("r1", name: "Beta", itemCount: 1, updatedAt: "2026-03-01T00:00:00.000Z"),
      project("r2", name: "Alpha", itemCount: 5, updatedAt: "2026-01-01T00:00:00.000Z"),
      project(
        "c1",
        name: "Zeta child",
        parentId: "r1",
        itemCount: 4,
        updatedAt: "2026-05-01T00:00:00.000Z",
      ),
    ];

    test("orders groups by name on the sort by name", () {
      expect(
        ids(browseProjects(rows, state(sort: "name"))
            .map((BrowseGroup g) => g.parent)
            .toList()),
        <String>["r2", "r1"],
      );
    });

    test("orders groups by the parent's own key when the parent matches", () {
      expect(
        ids(browseProjects(rows, state(sort: "most-members"))
            .map((BrowseGroup g) => g.parent)
            .toList()),
        <String>["r2", "r1"],
      );
      expect(
        ids(browseProjects(rows, state(sort: "recently-updated"))
            .map((BrowseGroup g) => g.parent)
            .toList()),
        <String>["r1", "r2"],
      );
    });

    test("orders a context group by the MATCHING CHILD's key, not the context row's", () {
      // Only the child carries the term in its description, and only the other
      // root carries it in its name. The child is newer than that root, while its
      // own parent is older than it — so the two orderings disagree and the test
      // can tell which one the implementation uses.
      final List<BrowsableProject> rows = <BrowsableProject>[
        project("r1", name: "Beta", updatedAt: "2026-03-01T00:00:00.000Z"),
        project(
          "c1",
          name: "Zeta child",
          parentId: "r1",
          updatedAt: "2026-05-01T00:00:00.000Z",
          description: "Reworked recently.",
        ),
        project("r3", name: "Recent root", updatedAt: "2026-04-01T00:00:00.000Z"),
      ];

      final List<BrowseGroup> byUpdated =
          browseProjects(rows, state(query: "recent", sort: "recently-updated"));
      expect(
        ids(byUpdated.map((BrowseGroup g) => g.parent).toList()),
        <String>["r1", "r3"],
      );
      expect(byUpdated[0].contextOnly, isTrue);
      expect(ids(byUpdated[0].children), <String>["c1"]);

      // Same disagreement on name: "Zeta child" > "Recent root", but the context
      // row is "Beta" < "Recent root".
      final List<BrowseGroup> byName =
          browseProjects(rows, state(query: "recent", sort: "name"));
      expect(
        ids(byName.map((BrowseGroup g) => g.parent).toList()),
        <String>["r3", "r1"],
      );
    });

    test("sorts children under their parent with the same comparator", () {
      final List<BrowseGroup> groups = browseProjects(all, state(sort: "name"));
      expect(
        ids(groups.firstWhere((BrowseGroup g) => g.parent.id == "full-on").children),
        <String>["fix-it-fleet", "learning-curve"],
      );
    });

    test("leaves the default order alone (the store already returns updated_at desc)", () {
      final List<BrowseGroup> groups = browseProjects(all, kDefaultBrowseState);
      expect(groups.every((BrowseGroup g) => g.contextOnly == false), isTrue);
      expect(countRenderedRows(groups), all.length);
    });

    test("renders every row when nothing is filtered — no row is ever lost by the tree", () {
      for (final String sort in kProjectSorts) {
        expect(countRenderedRows(browseProjects(all, state(sort: sort))), all.length);
      }
    });
  });

  group("counting", () {
    test("counts rendered rows, context rows included", () {
      final List<BrowseGroup> groups = browseProjects(all, state(query: "learning curve"));
      expect(countRenderedRows(groups), 2);
    });

    test("counts MATCHES only, so a context row is not reported as a search hit", () {
      final List<BrowseGroup> groups = browseProjects(all, state(query: "learning curve"));
      expect(countRenderedRows(groups), 2);
      expect(countMatches(all, state(query: "learning curve")), 1);
    });

    test("agrees with the rendered rows when nothing is narrowed", () {
      expect(countMatches(all, kDefaultBrowseState), all.length);
      expect(countRenderedRows(browseProjects(all, kDefaultBrowseState)), all.length);
    });

    test("counts a matching child under the has-sub-projects toggle, and never the context row", () {
      final List<BrowsableProject> rows = <BrowsableProject>[
        project("p", name: "Parent", lifecycleState: "archived", subProjectCount: 1),
        project("c", name: "Child", parentId: "p", lifecycleState: "active"),
      ];
      expect(countMatches(rows, state(lifecycle: "active")), 1);
      expect(countRenderedRows(browseProjects(rows, state(lifecycle: "active"))), 2);
    });
  });
}
