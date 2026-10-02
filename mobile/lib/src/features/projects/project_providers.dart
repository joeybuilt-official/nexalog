// SPDX-License-Identifier: MIT
// NEXALOG-PROJECTS — mirror-backed providers for the Projects surface.
//
// The mirror is the source of truth for the UI (ADR-0001), so the list reads
// `projects` rows straight out of `AppDb` — the same read the notes list uses —
// and hands them to the pure browse layer (`project_browse.dart`). No rule
// lives here and none lives in the widget: this file only projects a stored row
// into a typed model and binds the browse state to `browseProjects`.
//
// **Known gap, stated rather than hidden.** `projects` IS a synced entity
// (`apps/web/app/api/sync/route.ts` lists it in `SYNC_TABLES` and
// `SyncEngine._pullDelta` upserts every entity generically), so project rows do
// reach this mirror — but the sync row carries only the columns of the
// `projects` table. The parent edge lives in `project_items` (`item_kind =
// 'project'`), which is NOT a synced entity, and neither the member count nor
// the sub-project count is computed on the sync path. So [Project.browsable]
// reads `parentId`/`itemCount`/`subProjectCount` as absent and defaults them —
// the tree renders flat and the counts read zero until the server adds those
// fields to the sync payload. The browse rules are complete; only their input
// is thin.

import "package:flutter_riverpod/flutter_riverpod.dart";

import "../../core/providers.dart";
import "project_browse.dart";

/// A project row as mirrored from the server (camelCase keys, matching the
/// Drizzle `projects` row returned by /api/sync).
class Project {
  Project(this.raw);

  final Map<String, Object?> raw;

  String get id => raw["id"]?.toString() ?? "";
  String get workspaceId => raw["workspaceId"]?.toString() ?? "";
  String get name => raw["name"]?.toString() ?? "";
  String? get description => raw["description"]?.toString();
  String get lifecycleState => raw["lifecycleState"]?.toString() ?? "active";
  String? get livingDocUpdatedAt => raw["livingDocUpdatedAt"]?.toString();
  String? get createdAt => raw["createdAt"]?.toString();
  String? get updatedAt => raw["updatedAt"]?.toString();

  /// The parent edge — absent from the sync payload today (see the file header),
  /// so this reads null for every mirrored row and the tree renders flat.
  String? get parentId => raw["parentId"]?.toString();

  /// Grouped members (notes/bookmarks/journal). Not computed on the sync path,
  /// so it reads 0 until the server includes it.
  int get itemCount => _int(raw["itemCount"]);

  /// Live child projects. Not computed on the sync path, so it reads 0.
  int get subProjectCount => _int(raw["subProjectCount"]);

  /// A display name that is never blank — a nameless row still gets a label
  /// rather than an empty line the reader cannot act on.
  String get displayName {
    final String trimmed = name.trim();
    return trimmed.isEmpty ? "Untitled project" : trimmed;
  }

  /// The value the pure browse layer consumes.
  BrowsableProject get browsable => BrowsableProject(
        id: id,
        name: displayName,
        description: description,
        lifecycleState: lifecycleState,
        livingDocUpdatedAt: livingDocUpdatedAt,
        createdAt: createdAt,
        updatedAt: updatedAt,
        parentId: parentId,
        itemCount: itemCount,
        subProjectCount: subProjectCount,
      );

  static int _int(Object? v) {
    if (v is int) return v;
    if (v is num) return v.toInt();
    return int.tryParse(v?.toString() ?? "") ?? 0;
  }
}

/// All projects from the local mirror, newest-first (the store's own order, so
/// nothing moves on first paint). The browse layer re-orders from here.
final projectsListProvider = FutureProvider<List<Project>>((Ref ref) async {
  ref.watch(mirrorRevisionProvider);
  final List<Map<String, Object?>> rows =
      await ref.watch(appDbProvider).readAll("projects");
  final List<Project> projects = rows.map(Project.new).toList()
    ..sort((Project a, Project b) =>
        (b.updatedAt ?? "").compareTo(a.updatedAt ?? ""));
  return projects;
});

/// The rows the screen renders for one browse state — search, filter, sort and
/// the A1.7 tree projection applied IN THE PROVIDER, never in the widget
/// (clean-architecture: a conditional that encodes a rule does not live in a
/// Widget). Watching the mirror revision keeps it in step with a sync.
final projectBrowseGroupsProvider =
    FutureProvider.family<List<BrowseGroup>, BrowseState>(
        (Ref ref, BrowseState state) async {
  final List<Project> projects = await ref.watch(projectsListProvider.future);
  return browseProjects(
    projects.map((Project p) => p.browsable).toList(growable: false),
    state,
  );
});
