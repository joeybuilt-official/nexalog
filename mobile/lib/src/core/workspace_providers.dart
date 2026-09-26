import "package:dio/dio.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";

import "api/api_client.dart";
import "auth/auth_store.dart";
import "providers.dart";

class Workspace {
  Workspace(this.raw);
  final Map<String, Object?> raw;
  String get id => raw["id"]?.toString() ?? "";
  String get name => raw["name"]?.toString() ?? "";
  String get color => raw["color"]?.toString() ?? "#6366f1";
  String get kind => raw["kind"]?.toString() ?? "personal";
}

/// Workspaces from GET /api/workspaces, cached to the mirror for offline display.
final workspacesProvider = FutureProvider<List<Workspace>>((Ref ref) async {
  ref.watch(mirrorRevisionProvider);
  final dynamic db = ref.watch(appDbProvider);
  final ApiClient api = ref.watch(apiClientProvider);
  try {
    final Response<dynamic> res = await api.get<dynamic>("/api/workspaces");
    final Map<String, Object?> body = res.data is Map
        ? Map<String, Object?>.from(res.data as Map)
        : <String, Object?>{};
    final List<Map<String, Object?>> rows =
        ((body["workspaces"] as List<Object?>?) ?? const [])
            .map((Object? e) => Map<String, Object?>.from(e as Map))
            .toList();
    await db.upsertAll("workspaces", rows);
    return rows.map(Workspace.new).toList();
  } on DioException {
    final List<Map<String, Object?>> cached = await db.readAll("workspaces");
    return cached.map(Workspace.new).toList();
  }
});

/// The active workspace id: stored selection → first fetched workspace → any id
/// already present in the mirror (offline-safe). Offline creates inherit this.
final activeWorkspaceIdProvider = FutureProvider<String?>((Ref ref) async {
  ref.watch(mirrorRevisionProvider);
  final AuthStore auth = ref.watch(authStoreProvider);
  final String? stored = await auth.readWorkspace();
  final List<Workspace> all =
      await ref.watch(workspacesProvider.future).catchError(
            (_) => <Workspace>[],
          );
  if (stored != null && all.any((Workspace w) => w.id == stored)) return stored;
  if (all.isNotEmpty) return all.first.id;
  // Offline + nothing stored: derive from any mirrored row.
  final dynamic db = ref.watch(appDbProvider);
  for (final String entity in const <String>[
    "notes",
    "captureSources",
    "journalEntries",
  ]) {
    final List<Map<String, Object?>> rows = await db.readAll(entity);
    for (final Map<String, Object?> r in rows) {
      final Object? ws = r["workspaceId"];
      if (ws != null && ws.toString().isNotEmpty) return ws.toString();
    }
  }
  return stored;
});

/// Sets the active workspace and refreshes dependents.
Future<void> setActiveWorkspace(WidgetRef ref, String id) async {
  await ref.read(authStoreProvider).writeWorkspace(id);
  ref.read(mirrorRevisionProvider.notifier).state++;
}
