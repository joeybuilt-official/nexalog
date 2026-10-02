// SPDX-License-Identifier: MIT
// NEXALOG-PROJECTS — the mobile Projects browse surface.
//
// Mirror of the web's `apps/web/app/(app)/app/projects/projects-browser.tsx`:
// search, lifecycle filter, the has-sub-projects toggle, and sort, with a
// project's sub-projects rendered one level under it and a filtered-out parent
// rendered as a dimmed CONTEXT row rather than hiding its matching child
// (ADR-0001 Amendment A1.7).
//
// **This widget holds only state and markup.** Every rule — what matches, what
// order, and the never-hide-a-parent guarantee — lives in the pure
// `project_browse.dart` module, and the rows are projected from the mirror in
// `project_providers.dart`. Nothing here re-derives a filter.
//
// **There is no project detail surface on mobile, and this screen does not
// invent one.** The web has `/app/projects/[id]`; the native router has no such
// route (`mobile/lib/src/router.dart`), so a row is NOT tappable — a row that
// looks tappable and goes nowhere is worse than one that plainly does not.
// Building the detail surface is its own milestone, recorded as a gap against
// `docs/agents/platform/mobile/parity.md` rather than smuggled into a list PR.

import "package:flutter/material.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";

import "../../theme/knowledge_garden_tokens.dart";
import "project_browse.dart";
import "project_providers.dart";

class ProjectsScreen extends ConsumerStatefulWidget {
  const ProjectsScreen({super.key});

  @override
  ConsumerState<ProjectsScreen> createState() => _ProjectsScreenState();
}

class _ProjectsScreenState extends ConsumerState<ProjectsScreen> {
  BrowseState _state = kDefaultBrowseState;

  /// Collapsed roots, by id. A root whose children are the match (a context
  /// row) is never collapsible — collapsing it would hide the row the reader
  /// searched for, which is the one thing A1.7 forbids.
  final Set<String> _collapsed = <String>{};

  void _toggleCollapsed(String id) {
    setState(() {
      if (!_collapsed.remove(id)) _collapsed.add(id);
    });
  }

  bool get _filtering =>
      _state.query.trim().isNotEmpty ||
      _state.lifecycle != kDefaultBrowseState.lifecycle ||
      _state.hasSubProjectsOnly ||
      _state.sort != kDefaultBrowseState.sort;

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<Project>> projects = ref.watch(projectsListProvider);
    final AsyncValue<List<BrowseGroup>> groups =
        ref.watch(projectBrowseGroupsProvider(_state));

    return Scaffold(
      body: Column(
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                TextField(
                  key: const Key("projects-search"),
                  decoration: const InputDecoration(
                    hintText: "Search name or description\u2026",
                    prefixIcon: Icon(Icons.search),
                    isDense: true,
                    border: OutlineInputBorder(),
                  ),
                  onChanged: (String v) =>
                      setState(() => _state = _state.copyWith(query: v)),
                ),
                const SizedBox(height: 8),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: <Widget>[
                      for (final String filter in kLifecycleFilters)
                        Padding(
                          padding: const EdgeInsets.only(right: 6),
                          child: ChoiceChip(
                            key: Key("projects-lifecycle-$filter"),
                            label: Text(
                              kLifecycleFilterLabels[filter] ?? filter,
                            ),
                            selected: _state.lifecycle == filter,
                            onSelected: (_) => setState(() =>
                                _state = _state.copyWith(lifecycle: filter)),
                          ),
                        ),
                      Padding(
                        padding: const EdgeInsets.only(right: 6),
                        child: FilterChip(
                          key: const Key("projects-has-sub-projects"),
                          label: const Text("Has sub-projects"),
                          selected: _state.hasSubProjectsOnly,
                          onSelected: (bool v) => setState(() => _state =
                              _state.copyWith(hasSubProjectsOnly: v)),
                        ),
                      ),
                    ],
                  ),
                ),
                Row(
                  children: <Widget>[
                    const Icon(Icons.sort, size: 18),
                    const SizedBox(width: 8),
                    Expanded(
                      child: DropdownButton<String>(
                        key: const Key("projects-sort"),
                        isExpanded: true,
                        value: _state.sort,
                        onChanged: (String? v) {
                          if (v == null) return;
                          setState(() => _state = _state.copyWith(sort: v));
                        },
                        items: kProjectSorts
                            .map((String s) => DropdownMenuItem<String>(
                                  value: s,
                                  child: Text(kProjectSortLabels[s] ?? s),
                                ))
                            .toList(),
                      ),
                    ),
                    if (_filtering)
                      TextButton(
                        onPressed: () =>
                            setState(() => _state = kDefaultBrowseState),
                        child: const Text("Reset"),
                      ),
                  ],
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: groups.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (Object e, _) => const Center(
                key: Key("projects-error"),
                child: Padding(
                  padding: EdgeInsets.all(24),
                  child: Text(
                    "Could not read your projects on this device.",
                    textAlign: TextAlign.center,
                  ),
                ),
              ),
              data: (List<BrowseGroup> list) {
                if (list.isEmpty) {
                  return _EmptyProjects(
                    filtering: _filtering,
                    total: projects.valueOrNull?.length,
                    onReset: () => setState(() => _state = kDefaultBrowseState),
                  );
                }
                return ListView.builder(
                  padding: const EdgeInsets.all(12),
                  itemCount: list.length,
                  itemBuilder: (BuildContext c, int i) {
                    final BrowseGroup group = list[i];
                    // A context row is rendered FOR its child, so it stays open.
                    final bool expanded =
                        group.contextOnly || !_collapsed.contains(group.parent.id);
                    final bool disclosure = !group.contextOnly &&
                        group.children.isNotEmpty;
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        _ProjectRow(
                          project: group.parent,
                          contextOnly: group.contextOnly,
                          disclosure: disclosure
                              ? _Disclosure(
                                  expanded: expanded,
                                  toggle: () => _toggleCollapsed(group.parent.id),
                                )
                              : null,
                        ),
                        if (expanded)
                          for (final BrowsableProject child in group.children)
                            Padding(
                              padding: const EdgeInsets.only(left: 20),
                              child: _ProjectRow(project: child, child: true),
                            ),
                      ],
                    );
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _Disclosure {
  const _Disclosure({required this.expanded, required this.toggle});

  final bool expanded;
  final VoidCallback toggle;
}

/// One row. [child] is the one-level indent under a root; [contextOnly] marks a
/// row rendered ONLY because a matching sub-project needs its parent (A1.7) — it
/// is dimmed and says so, rather than looking like an ordinary search hit.
class _ProjectRow extends StatelessWidget {
  const _ProjectRow({
    required this.project,
    this.child = false,
    this.contextOnly = false,
    this.disclosure,
  });

  final BrowsableProject project;
  final bool child;
  final bool contextOnly;
  final _Disclosure? disclosure;

  @override
  Widget build(BuildContext context) {
    final KnowledgeGardenTokens tokens = KnowledgeGardenTokens.of(context);
    final TextTheme text = Theme.of(context).textTheme;

    final Widget row = Card(
      margin: const EdgeInsets.symmetric(vertical: 4),
      // Dim a context row without a colour literal — the gate forbids
      // `Colors.transparent` and raw colours, and opacity is the honest way to
      // say "seen only because its child matched".
      child: Opacity(
        opacity: contextOnly ? 0.6 : 1,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              if (disclosure != null)
                InkWell(
                  key: Key("projects-disclosure-${project.id}"),
                  onTap: disclosure!.toggle,
                  child: Icon(
                    disclosure!.expanded
                        ? Icons.expand_more
                        : Icons.chevron_right,
                    size: 20,
                    color: tokens.mutedForeground,
                  ),
                )
              else
                Icon(
                  child ? Icons.subdirectory_arrow_right : Icons.folder_outlined,
                  size: 20,
                  color: tokens.mutedForeground,
                ),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      project.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: text.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                        color: tokens.foreground,
                      ),
                    ),
                    if (project.description != null &&
                        project.description!.trim().isNotEmpty)
                      Text(
                        project.description!,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: text.bodySmall
                            ?.copyWith(color: tokens.mutedForeground),
                      ),
                    if (contextOnly)
                      Text(
                        "Shown because a sub-project matches.",
                        style:
                            text.bodySmall?.copyWith(color: tokens.mutedForeground),
                      ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: <Widget>[
                  _LifecycleBadge(state: project.lifecycleState),
                  const SizedBox(height: 4),
                  Text(
                    "${project.itemCount} ${project.itemCount == 1 ? "item" : "items"}",
                    style: text.labelSmall?.copyWith(color: tokens.mutedForeground),
                  ),
                  if (!child && project.subProjectCount > 0)
                    Text(
                      "${project.subProjectCount} sub",
                      style:
                          text.labelSmall?.copyWith(color: tokens.mutedForeground),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
    return row;
  }
}

/// Lifecycle chip, drawn entirely from Knowledge Garden tokens (the colour gate
/// forbids any literal here).
class _LifecycleBadge extends StatelessWidget {
  const _LifecycleBadge({required this.state});

  final String state;

  @override
  Widget build(BuildContext context) {
    final KnowledgeGardenTokens tokens = KnowledgeGardenTokens.of(context);
    final bool active = state == "active";
    final Color bg = active ? tokens.accent : tokens.muted;
    final Color fg = active ? tokens.accentForeground : tokens.mutedForeground;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(
        state,
        style: Theme.of(context)
            .textTheme
            .labelSmall
            ?.copyWith(color: fg, fontWeight: FontWeight.w600),
      ),
    );
  }
}

class _EmptyProjects extends StatelessWidget {
  const _EmptyProjects({
    required this.filtering,
    required this.total,
    required this.onReset,
  });

  final bool filtering;
  final int? total;
  final VoidCallback onReset;

  @override
  Widget build(BuildContext context) {
    final KnowledgeGardenTokens tokens = KnowledgeGardenTokens.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    // A mirror read is local storage; an empty list is either "no projects
    // synced yet" or "your filters matched nothing". Say which, because a bare
    // "nothing here" lets an operator conclude their projects vanished.
    final bool neverSynced = (total ?? 0) == 0;
    return Center(
      key: const Key("projects-empty"),
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(Icons.folder_outlined, size: 40, color: tokens.mutedForeground),
            const SizedBox(height: 12),
            Text(
              neverSynced ? "No projects on this device" : "No projects match",
              textAlign: TextAlign.center,
              style: text.titleSmall?.copyWith(color: tokens.foreground),
            ),
            const SizedBox(height: 4),
            Text(
              neverSynced
                  ? "Projects arrive by syncing from the server. If the sync "
                      "surface is unavailable on this deployment, this list stays "
                      "empty."
                  : "Nothing here matches that search and filter combination. "
                      "Widen it, or reset the controls.",
              textAlign: TextAlign.center,
              style: text.bodySmall?.copyWith(color: tokens.mutedForeground),
            ),
            if (filtering && !neverSynced) ...<Widget>[
              const SizedBox(height: 12),
              OutlinedButton(
                onPressed: onReset,
                child: const Text("Reset controls"),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
