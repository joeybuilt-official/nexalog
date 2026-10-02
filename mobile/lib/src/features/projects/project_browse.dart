// SPDX-License-Identifier: MIT
// NEXALOG-PROJECTS — pure browse layer for the mobile projects list: search,
// filter, sort, and the tree projection the screen renders.
//
// **No Flutter imports, no IO, no clock.** A conditional that encodes a rule
// does not live in a widget, so the rules are unit-testable with plain values
// and the screen holds only state and markup (clean-architecture).
//
// This is a PORT of the web's `apps/web/lib/projects/browse.ts` — the RULES are
// mirrored, not re-derived and not invented. The one thing it must never break
// is the load-bearing invariant of ADR-0001 Amendment A1.7: **a project that is
// itself a sub-project is never hidden because its parent was filtered out.** A
// parent row is always rendered for any rendered child — as a CONTEXT ROW
// (dimmed, [BrowseGroup.contextOnly]) with the matching child indented under it.
// Nothing is ever promoted out of the tree or dropped.
//
// Two structural rules also live here rather than in the screen, because they
// are the same "never drop a row" rule:
//
//   1. a project whose parent is not in the set is a root (its parent was
//      deleted or belongs to another workspace), and
//   2. a project whose parent is ITSELF a child — which the two-level nesting
//      policy forbids, so this is malformed data — is promoted to a root rather
//      than rendered at a second indent level. That also makes a bad-data cycle
//      (a.parentId = b, b.parentId = a) render both rows instead of neither.
//
// **Resolved by server enrichment.** `GET /api/sync` returns `projects` rows
// with `parentId`, `itemCount` and `subProjectCount` merged in by the server
// (using the same batched helpers the web list uses). The mobile client reads
// them like any other synced field. If they are absent, the model defaults them
// so an old or partial sync degrades gracefully rather than crashing.

/// The lifecycle states the domain defines — web `LIFECYCLE_STATES`. Declared
/// here as the mobile twin so this module depends on nothing.
const List<String> kLifecycleStates = <String>['draft', 'active', 'archived'];

/// `all` plus every lifecycle value — derived, never a hand-written list.
const List<String> kLifecycleFilters = <String>['all', ...kLifecycleStates];

/// The sort keys, in the order the control lists them — web `PROJECT_SORTS`.
const List<String> kProjectSorts = <String>[
  'name',
  'recently-updated',
  'recently-created',
  'most-members',
  'most-sub-projects',
];

/// Human labels for the sort control — web `PROJECT_SORT_LABELS`.
const Map<String, String> kProjectSortLabels = <String, String>{
  'name': 'Name (A\u2013Z)',
  'recently-updated': 'Recently updated',
  'recently-created': 'Recently created',
  'most-members': 'Most members',
  'most-sub-projects': 'Most sub-projects',
};

/// Human labels for the lifecycle filter — web `LIFECYCLE_LABEL`.
const Map<String, String> kLifecycleFilterLabels = <String, String>{
  'all': 'All states',
  'draft': 'Draft',
  'active': 'Active',
  'archived': 'Archived',
};

/// The fields browsing needs. A `Project` satisfies it structurally.
///
/// Timestamps are ISO-8601 strings (what the mirror holds) or null. `parentId`
/// is null when the project is a root — including when the server did not send
/// one (see the known gap in the file header).
class BrowsableProject {
  const BrowsableProject({
    required this.id,
    required this.name,
    this.description,
    this.lifecycleState = 'active',
    this.livingDocUpdatedAt,
    this.createdAt,
    this.updatedAt,
    this.parentId,
    this.itemCount = 0,
    this.subProjectCount = 0,
  });

  final String id;
  final String name;
  final String? description;
  final String lifecycleState;
  final String? livingDocUpdatedAt;
  final String? createdAt;
  final String? updatedAt;
  final String? parentId;
  final int itemCount;
  final int subProjectCount;
}

/// The browse controls' state.
class BrowseState {
  const BrowseState({
    this.query = '',
    this.lifecycle = 'all',
    this.hasSubProjectsOnly = false,
    this.sort = 'recently-updated',
  });

  final String query;
  final String lifecycle;

  /// Narrow to projects that have at least one sub-project.
  final bool hasSubProjectsOnly;
  final String sort;

  BrowseState copyWith({
    String? query,
    String? lifecycle,
    bool? hasSubProjectsOnly,
    String? sort,
  }) {
    return BrowseState(
      query: query ?? this.query,
      lifecycle: lifecycle ?? this.lifecycle,
      hasSubProjectsOnly: hasSubProjectsOnly ?? this.hasSubProjectsOnly,
      sort: sort ?? this.sort,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is BrowseState &&
      other.query == query &&
      other.lifecycle == lifecycle &&
      other.hasSubProjectsOnly == hasSubProjectsOnly &&
      other.sort == sort;

  @override
  int get hashCode => Object.hash(query, lifecycle, hasSubProjectsOnly, sort);
}

/// The list's default order — the store's own `updated_at desc`, so nothing
/// moves on first paint.
const BrowseState kDefaultBrowseState = BrowseState();

/// One root row plus the sub-projects rendered under it.
class BrowseGroup {
  const BrowseGroup({
    required this.parent,
    required this.contextOnly,
    required this.children,
  });

  final BrowsableProject parent;

  /// The parent does not match and is rendered only because one of its children
  /// does. A1.7: a parent row is always rendered for any rendered child.
  final bool contextOnly;

  /// The matching sub-projects rendered under this root, in sort order.
  final List<BrowsableProject> children;
}

// ---- search ---------------------------------------------------------------

/// Whitespace-separated, lowercased, empties dropped.
List<String> tokenizeQuery(String query) =>
    query.toLowerCase().split(RegExp(r'\s+')).where((String t) => t.isNotEmpty).toList();

/// Instant text match over `name` AND `description`, case-insensitive. Every
/// token must appear in one of the two, so "angel release" matches the project
/// whose name carries both words in either order and does not match one that
/// only carries "angel". An empty/whitespace query matches everything.
bool matchesQuery(BrowsableProject project, String query) {
  final List<String> tokens = tokenizeQuery(query);
  if (tokens.isEmpty) return true;
  final String haystack = '${project.name}\n${project.description ?? ''}'.toLowerCase();
  return tokens.every(haystack.contains);
}

bool matchesLifecycle(BrowsableProject project, String filter) =>
    filter == 'all' || project.lifecycleState == filter;

bool matchesHasSubProjects(BrowsableProject project, bool only) =>
    !only || project.subProjectCount > 0;

/// Search + lifecycle. The A1.7-safe scope narrowing the ROOT ROW must satisfy.
bool matchesFilters(BrowsableProject project, BrowseState state) =>
    matchesQuery(project, state.query) && matchesLifecycle(project, state.lifecycle);

/// Every predicate, including the has-sub-projects toggle. This is what the
/// sub-project rows are filtered by.
bool matchesAllFilters(BrowsableProject project, BrowseState state) =>
    matchesFilters(project, state) &&
    matchesHasSubProjects(project, state.hasSubProjectsOnly);

// ---- sort -----------------------------------------------------------------

/// Epoch millis, or `0` for an absent/unparseable timestamp — which is older
/// than every real row, so unknown dates sink to the end of a newest-first sort
/// instead of poisoning the comparator.
int _timeMs(String? value) {
  if (value == null) return 0;
  final DateTime? parsed = DateTime.tryParse(value);
  return parsed?.millisecondsSinceEpoch ?? 0;
}

/// Name, case-insensitive, then id — so equal keys never leave output to chance.
int _tieBreak(BrowsableProject a, BrowsableProject b) {
  final int byName = a.name.toLowerCase().compareTo(b.name.toLowerCase());
  return byName != 0 ? byName : a.id.compareTo(b.id);
}

/// A comparator for one sort key. Total and deterministic: no key comparison
/// ends in 0.
int Function(BrowsableProject, BrowsableProject) compareProjects(String sort) {
  return (BrowsableProject a, BrowsableProject b) {
    int delta;
    switch (sort) {
      case 'name':
        delta = a.name.toLowerCase().compareTo(b.name.toLowerCase());
      case 'recently-updated':
        delta = _timeMs(b.updatedAt) - _timeMs(a.updatedAt);
      case 'recently-created':
        delta = _timeMs(b.createdAt) - _timeMs(a.createdAt);
      case 'most-members':
        delta = b.itemCount - a.itemCount;
      case 'most-sub-projects':
        delta = b.subProjectCount - a.subProjectCount;
      default:
        delta = 0;
    }
    return delta != 0 ? delta : _tieBreak(a, b);
  };
}

/// Sort a flat list with one of the list's keys. Does not mutate the input.
List<BrowsableProject> sortProjects(List<BrowsableProject> projects, String sort) {
  final List<BrowsableProject> copy = List<BrowsableProject>.of(projects);
  copy.sort(compareProjects(sort));
  return copy;
}

// ---- tree -----------------------------------------------------------------

/// The split of a flat list into root rows and their children.
class ProjectTree {
  const ProjectTree({required this.roots, required this.childrenOf});

  final List<BrowsableProject> roots;
  final Map<String, List<BrowsableProject>> childrenOf;
}

/// Split the flat list into root rows and their children, honouring the two
/// structural rules in the file header (unresolvable parent -> root; parent that
/// is itself a child -> promoted to root). Input order is preserved; ordering is
/// the caller's job.
ProjectTree buildProjectTree(List<BrowsableProject> projects) {
  final Map<String, BrowsableProject> byId = <String, BrowsableProject>{
    for (final BrowsableProject p in projects) p.id: p,
  };

  String? parentOf(BrowsableProject project) {
    final String? parentId = project.parentId;
    if (parentId == null || parentId == project.id || !byId.containsKey(parentId)) return null;
    return parentId;
  }

  bool isRoot(BrowsableProject project) {
    final String? parentId = parentOf(project);
    if (parentId == null) return true;
    // The parent must itself be a root — anything else would be a second indent
    // level at best and a cycle at worst, and either way it would hide a row.
    return parentOf(byId[parentId]!) != null;
  }

  final List<BrowsableProject> roots = <BrowsableProject>[];
  final Map<String, List<BrowsableProject>> childrenOf = <String, List<BrowsableProject>>{};

  for (final BrowsableProject project in projects) {
    if (isRoot(project)) {
      roots.add(project);
      continue;
    }
    final String parentId = parentOf(project)!;
    childrenOf.putIfAbsent(parentId, () => <BrowsableProject>[]).add(project);
  }

  return ProjectTree(roots: roots, childrenOf: childrenOf);
}

/// The list the screen renders. Roots (and context roots) come out in sort
/// order, each carrying only the sub-projects that match — with the A1.7
/// guarantee that a matching child is always rendered, and its parent rendered
/// for it.
///
/// **Where the has-sub-projects toggle applies, and why it is not symmetrical.**
/// A sub-project is childless by construction (the two-level policy forbids a
/// third level), so its `subProjectCount` is always 0 and applying that toggle
/// to sub-project rows would filter out every one of them — including the rows
/// the toggle is named after. So the toggle narrows ROOT rows only:
///
///   - a ROOT row is kept iff it passes every filter, or one of its sub-projects
///     is kept (A1.7 — the parent then renders as a context row);
///   - a SUB-PROJECT row is kept iff it passes search + lifecycle. The toggle
///     never removes one.
///
/// A group is ordered by its REPRESENTATIVE row: the parent when the parent is
/// kept on its own merits, else its first matching child.
List<BrowseGroup> browseProjects(List<BrowsableProject> projects, BrowseState state) {
  final ProjectTree tree = buildProjectTree(projects);
  final int Function(BrowsableProject, BrowsableProject) compare = compareProjects(state.sort);

  final List<BrowseGroup> groups = <BrowseGroup>[];
  for (final BrowsableProject parent in tree.roots) {
    final bool parentMatches = matchesAllFilters(parent, state);
    final List<BrowsableProject> children = (tree.childrenOf[parent.id] ?? <BrowsableProject>[])
        .where((BrowsableProject child) => matchesFilters(child, state))
        .toList()
      ..sort(compare);
    if (!parentMatches && children.isEmpty) continue;
    groups.add(BrowseGroup(parent: parent, contextOnly: !parentMatches, children: children));
  }

  BrowsableProject representative(BrowseGroup group) =>
      group.contextOnly && group.children.isNotEmpty ? group.children.first : group.parent;

  groups.sort(
    (BrowseGroup a, BrowseGroup b) => compare(representative(a), representative(b)),
  );
  return groups;
}

/// Rows rendered — the parent of every group plus its children (context rows
/// included).
int countRenderedRows(List<BrowseGroup> groups) =>
    groups.fold(0, (int total, BrowseGroup group) => total + 1 + group.children.length);

/// How many rendered rows match what the reader asked for, in their own right —
/// context rows are excluded, because counting a parent the reader did not ask
/// for as a hit would overstate the result set.
int countMatches(List<BrowsableProject> projects, BrowseState state) {
  final ProjectTree tree = buildProjectTree(projects);
  int matches = 0;
  for (final BrowsableProject root in tree.roots) {
    if (matchesAllFilters(root, state)) matches += 1;
    for (final BrowsableProject child in tree.childrenOf[root.id] ?? <BrowsableProject>[]) {
      if (matchesFilters(child, state)) matches += 1;
    }
  }
  return matches;
}
