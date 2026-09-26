import "package:dio/dio.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";

import "../../core/api/api_client.dart";
import "../../core/providers.dart";

/// A note row as mirrored from the server (camelCase keys, matching the Drizzle
/// `notes` row shape returned by /api/sync).
class Note {
  Note(this.raw);
  final Map<String, Object?> raw;

  String get id => raw["id"]?.toString() ?? "";
  String get workspaceId => raw["workspaceId"]?.toString() ?? "";
  String get title => raw["title"]?.toString() ?? "";
  String get content => raw["content"]?.toString() ?? "";
  String get kind => raw["kind"]?.toString() ?? "note";
  String get lifecycleState => raw["lifecycleState"]?.toString() ?? "active";
  String? get date => raw["date"]?.toString();
  String? get updatedAt => raw["updatedAt"]?.toString();

  String? get captureId => raw["captureId"]?.toString();
  Map<String, Object?>? get pendingSuggestion {
    final Object? raw0 = raw["pendingSuggestion"];
    if (raw0 is Map) return Map<String, Object?>.from(raw0);
    return null;
  }

  String get displayTitle {
    if (title.trim().isNotEmpty) return title.trim();
    final String firstLine = content.trim().split("\n").first.trim();
    return firstLine.isEmpty ? "Untitled" : firstLine;
  }
}

int _cmpUpdatedDesc(Note a, Note b) =>
    (b.updatedAt ?? "").compareTo(a.updatedAt ?? "");

/// All notes from the local mirror, newest first. Excludes bookmark-twin notes
/// (kind == "bookmark") which live on the Bookmarks surface (web parity §9).
final notesListProvider = FutureProvider<List<Note>>((Ref ref) async {
  ref.watch(mirrorRevisionProvider);
  final List<Map<String, Object?>> rows =
      await ref.watch(appDbProvider).readAll("notes");
  final List<Note> notes = rows
      .map(Note.new)
      .where((Note n) => n.kind != "bookmark")
      .toList()
    ..sort(_cmpUpdatedDesc);
  return notes;
});

final noteByIdProvider =
    FutureProvider.family<Note?, String>((Ref ref, String id) async {
  ref.watch(mirrorRevisionProvider);
  final Map<String, Object?>? row =
      await ref.watch(appDbProvider).readOne("notes", id);
  return row == null ? null : Note(row);
});

/// Tags on a note (web parity §4). Online GET /api/notes/:id/tags → {tags:[{id,name}]}.
final noteTagsProvider = FutureProvider.autoDispose
    .family<List<Map<String, Object?>>, String>((Ref ref, String id) async {
  final ApiClient api = ref.watch(apiClientProvider);
  try {
    final Response<dynamic> res = await api.get<dynamic>("/api/notes/$id/tags");
    final Map<String, Object?> body = res.data is Map
        ? Map<String, Object?>.from(res.data as Map)
        : <String, Object?>{};
    return ((body["tags"] as List<Object?>?) ?? const [])
        .map((Object? e) => Map<String, Object?>.from(e as Map))
        .toList();
  } on DioException {
    return const <Map<String, Object?>>[];
  }
});

Future<void> addNoteTag(WidgetRef ref, String noteId, String name) async {
  await ref
      .read(apiClientProvider)
      .post<dynamic>("/api/notes/$noteId/tags", data: <String, Object?>{"name": name});
  ref.invalidate(noteTagsProvider(noteId));
}

Future<void> removeNoteTag(WidgetRef ref, String noteId, String tagId) async {
  await ref
      .read(apiClientProvider)
      .delete<dynamic>("/api/notes/$noteId/tags", data: <String, Object?>{"tagId": tagId});
  ref.invalidate(noteTagsProvider(noteId));
}

/// Notes that link here (web parity §4). Online GET /api/notes/:id/backlinks →
/// {backlinks:[{id,title,updatedAt}]}; empty on failure (offline-tolerant).
final backlinksProvider = FutureProvider.autoDispose
    .family<List<Map<String, Object?>>, String>((Ref ref, String id) async {
  return _list(ref, "/api/notes/$id/backlinks", "backlinks");
});

/// Unlinked mentions (web parity §4): other notes whose text mentions this note's
/// title but aren't linked yet. GET /api/notes/:id/unlinked-mentions → {mentions}.
final unlinkedMentionsProvider = FutureProvider.autoDispose
    .family<List<Map<String, Object?>>, String>((Ref ref, String id) async {
  return _list(ref, "/api/notes/$id/unlinked-mentions", "mentions");
});

/// Append-only content version history. GET /api/notes/:id/snapshots → {snapshots}.
final snapshotsProvider = FutureProvider.autoDispose
    .family<List<Map<String, Object?>>, String>((Ref ref, String id) async {
  return _list(ref, "/api/notes/$id/snapshots", "snapshots");
});

Future<List<Map<String, Object?>>> _list(
  Ref ref,
  String path,
  String key,
) async {
  try {
    final Response<dynamic> res =
        await ref.watch(apiClientProvider).get<dynamic>(path);
    final Map<String, Object?> body = res.data is Map
        ? Map<String, Object?>.from(res.data as Map)
        : <String, Object?>{};
    return ((body[key] as List<Object?>?) ?? const [])
        .map((Object? e) => Map<String, Object?>.from(e as Map))
        .toList();
  } on DioException {
    return const <Map<String, Object?>>[];
  }
}

/// Create a wikilink from this note to [targetNoteId] (one-click "Link" on an
/// unlinked mention). POST /api/notes/:id/links {targetNoteId}.
Future<void> linkNote(WidgetRef ref, String noteId, String targetNoteId) async {
  await ref.read(apiClientProvider).post<dynamic>(
    "/api/notes/$noteId/links",
    data: <String, Object?>{"targetNoteId": targetNoteId},
  );
  ref.invalidate(backlinksProvider(noteId));
  ref.invalidate(unlinkedMentionsProvider(noteId));
}
