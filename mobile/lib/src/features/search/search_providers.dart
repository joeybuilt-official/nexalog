import "package:dio/dio.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";

import "../../core/api/api_client.dart";
import "../../core/providers.dart";
import "../bookmarks/bookmarks_screen.dart";
import "../notes/notes_providers.dart";

/// One ContentFinder result row, matching the /api/search SearchResult shape.
class SearchResult {
  SearchResult(this.raw);
  final Map<String, Object?> raw;
  String get id => raw["id"]?.toString() ?? "";
  String get kind => raw["kind"]?.toString() ?? "other";
  String get title {
    final String t = raw["title"]?.toString() ?? "";
    return t.trim().isEmpty ? (raw["urlHost"]?.toString() ?? "Untitled") : t.trim();
  }

  String? get url => raw["url"]?.toString();
  String? get snippet =>
      raw["snippet"]?.toString() ?? raw["summary"]?.toString();
  String? get themeLabel => raw["themeLabel"]?.toString();
  String? get urlHost => raw["urlHost"]?.toString();
  String? get createdAt => raw["createdAt"]?.toString();
  String? get openedAt => raw["openedAt"]?.toString();
  int? get readMinutes => _num(raw["readMinutes"]);
  int? get watchMinutes => _num(raw["watchMinutes"]);
  bool get isNote => kind == "note";

  static int? _num(Object? v) {
    if (v == null) return null;
    if (v is int) return v;
    if (v is num) return v.toInt();
    return int.tryParse(v.toString());
  }
}

class SearchQuery {
  const SearchQuery({
    this.query = "",
    this.sort = "relevance",
    this.kind,
    this.surfaces = const <String>["notes", "bookmarks"],
    this.ageRange,
  });
  final String query;
  final String sort; // relevance | recency | last_opened
  final String? kind; // facet filter (kindClassified) or null for all
  // Surface restriction the /api/search endpoint accepts:
  //   notes | bookmarks | video | article | reference | social | homepage
  // List surfaces (Notes/Bookmarks/Watch/Reading/Reference) bind this
  // so global facet chips don't leak across surfaces.
  final List<String> surfaces;
  // Age filter: today | 7d | 30d | 90d | 1y | all
  final String? ageRange;

  SearchQuery copyWith({
    String? query,
    String? sort,
    Object? kind = _unset,
    List<String>? surfaces,
    Object? ageRange = _unset,
  }) =>
      SearchQuery(
        query: query ?? this.query,
        sort: sort ?? this.sort,
        kind: kind == _unset ? this.kind : kind as String?,
        surfaces: surfaces ?? this.surfaces,
        ageRange: ageRange == _unset ? this.ageRange : ageRange as String?,
      );
  static const Object _unset = Object();

  @override
  bool operator ==(Object other) =>
      other is SearchQuery &&
      other.query == query &&
      other.sort == sort &&
      other.kind == kind &&
      other.ageRange == ageRange &&
      _listEq(other.surfaces, surfaces);

  @override
  int get hashCode => Object.hash(query, sort, kind, ageRange, Object.hashAll(surfaces));

  static bool _listEq(List<String> a, List<String> b) {
    if (a.length != b.length) return false;
    for (int i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }
}

class SearchOutcome {
  SearchOutcome(this.results, this.totalsByKind, {this.offline = false});
  final List<SearchResult> results;
  final Map<String, int> totalsByKind;
  final bool offline;
}

/// ContentFinder backing search (web parity §6/§24). Online POST /api/search
/// (lexical + semantic hybrid + facets); on failure falls back to filtering the
/// local mirror so search still works offline.
class SearchRepo {
  SearchRepo(this._api, this._ref);
  final ApiClient _api;
  final Ref _ref;

  Future<SearchOutcome> run(SearchQuery q) async {
    try {
      final Map<String, Object?> body = <String, Object?>{
        "surfaces": q.surfaces,
        "query": q.query,
        "sort": q.sort,
        "limit": 50,
      };
      if (q.ageRange != null) {
        body["filters"] = <String, Object?>{"ageRange": q.ageRange};
      }
      final Response<dynamic> res = await _api.post<dynamic>("/api/search", data: body);
      final Map<String, Object?> resBody = res.data is Map
          ? Map<String, Object?>.from(res.data as Map)
          : <String, Object?>{};
      List<SearchResult> results =
          ((resBody["results"] as List<Object?>?) ?? const [])
              .map((Object? e) => SearchResult(Map<String, Object?>.from(e as Map)))
              .toList();
      if (q.kind != null) {
        results = results.where((SearchResult r) => r.kind == q.kind).toList();
      }
      final Map<String, Object?> facets = resBody["facets"] is Map
          ? Map<String, Object?>.from(resBody["facets"] as Map)
          : <String, Object?>{};
      final Map<String, int> totals = <String, int>{};
      if (facets["totalsByKind"] is Map) {
        (facets["totalsByKind"] as Map).forEach((Object? k, Object? v) {
          totals[k.toString()] = v is int ? v : int.tryParse(v.toString()) ?? 0;
        });
      }
      return SearchOutcome(results, totals);
    } on DioException {
      return _offline(q);
    }
  }

  Future<SearchOutcome> _offline(SearchQuery q) async {
    final dynamic db = _ref.read(appDbProvider);
    final String ql = q.query.toLowerCase();
    final List<SearchResult> out = <SearchResult>[];
    final bool wantNotes = q.surfaces.contains("notes");
    final Set<String> captureKinds = _captureKindsForSurfaces(q.surfaces);
    if (wantNotes) {
      for (final Map<String, Object?> r in await db.readAll("notes")) {
        final Note n = Note(r);
        if (n.kind == "bookmark") continue;
        if (ql.isEmpty ||
            n.displayTitle.toLowerCase().contains(ql) ||
            n.content.toLowerCase().contains(ql)) {
          out.add(SearchResult(<String, Object?>{
            "id": n.id,
            "kind": "note",
            "title": n.displayTitle,
          }));
        }
      }
    }
    if (captureKinds.isNotEmpty) {
      for (final Map<String, Object?> r in await db.readAll("captureSources")) {
        final Capture c = Capture(r);
        if (!captureKinds.contains(c.kind)) continue;
        if (ql.isEmpty ||
            c.title.toLowerCase().contains(ql) ||
            (c.url ?? "").toLowerCase().contains(ql)) {
          out.add(SearchResult(<String, Object?>{
            "id": c.id,
            "kind": c.kind,
            "title": c.title,
            "url": c.url,
          }));
        }
      }
    }
    final List<SearchResult> filtered =
        q.kind == null ? out : out.where((SearchResult r) => r.kind == q.kind).toList();
    return SearchOutcome(filtered, <String, int>{}, offline: true);
  }

  // Mirror /api/search expansion: surfaces=["bookmarks"] fans out to
  // article+reference+social+homepage+other (video has its own surface).
  static Set<String> _captureKindsForSurfaces(List<String> surfaces) {
    final Set<String> kinds = <String>{};
    for (final String s in surfaces) {
      if (s == "bookmarks") {
        kinds.addAll(const <String>[
          "article",
          "reference",
          "social",
          "homepage",
          "other",
        ]);
      } else if (s != "notes") {
        kinds.add(s);
      }
    }
    return kinds;
  }
}

final searchRepoProvider =
    Provider<SearchRepo>((Ref ref) => SearchRepo(ref.watch(apiClientProvider), ref));

final searchProvider =
    FutureProvider.family<SearchOutcome, SearchQuery>((Ref ref, SearchQuery q) {
  return ref.watch(searchRepoProvider).run(q);
});

// Saved smart-views from /api/query-views (P4).
class SavedView {
  SavedView(this.raw);
  final Map<String, Object?> raw;
  String get id => raw["id"]?.toString() ?? "";
  String get name => raw["name"]?.toString() ?? "";
  String get query => raw["query"]?.toString() ?? "";
}

class SavedViewsRepo {
  SavedViewsRepo(this._api);
  final ApiClient _api;

  Future<List<SavedView>> list() async {
    try {
      final Response<dynamic> res = await _api.get<dynamic>("/api/query-views");
      final Map<String, Object?> body = res.data is Map
          ? Map<String, Object?>.from(res.data as Map)
          : <String, Object?>{};
      final List<Object?> raw = (body["views"] as List<Object?>?) ?? const <Object?>[];
      return raw.map((Object? e) => SavedView(Map<String, Object?>.from(e as Map))).toList();
    } on DioException {
      return const <SavedView>[];
    }
  }
}

final savedViewsProvider = FutureProvider<List<SavedView>>((Ref ref) {
  return SavedViewsRepo(ref.watch(apiClientProvider)).list();
});
