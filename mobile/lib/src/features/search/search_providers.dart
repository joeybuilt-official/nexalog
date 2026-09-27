import "package:dio/dio.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";

import "../../core/api/api_client.dart";
import "../../core/api/surface_state.dart";
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
  SearchOutcome(
    this.results,
    this.totalsByKind, {
    this.offline = false,
    this.failure,
  });
  final List<SearchResult> results;
  final Map<String, int> totalsByKind;

  /// True when these results came from the local mirror because the device
  /// could not reach the server. That is a legitimate answer, not a failure.
  final bool offline;

  /// Set when the server REACHED and refused/unavailable — the operator must
  /// see that, because an empty result list would otherwise read as "no
  /// matches" when in fact nothing was searched.
  final SurfaceError? failure;
}

/// ContentFinder backing search (web parity §6/§24). Online POST /api/search
/// (lexical + semantic hybrid + facets).
///
/// Two failure modes, deliberately different:
///   - **genuinely offline** (the request never landed) → fall back to filtering
///     the local mirror, so search keeps working on a plane. Reported as
///     `offline: true`.
///   - **the server answered but the surface is unavailable / faulted** → do NOT
///     degrade to the mirror as if that were an answer. The mirror is a stale
///     partial copy; presenting its zero rows as "no matches" is exactly the
///     silent-empty failure this classification exists to prevent. Carried as
///     [SearchOutcome.failure] so the screen says so.
///
/// Nothing here assumes which of the two a given deployment produces: server
/// results flow whenever the route answers, and the mirror only stands in for a
/// request that never landed.
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
    } on DioException catch (e) {
      final SurfaceError failure =
          SurfaceError.fromDio(e, surface: "Search");
      // Only a request that never landed justifies the mirror fallback.
      if (failure.isOffline) return _offline(q);
      return SearchOutcome(
        const <SearchResult>[],
        const <String, int>{},
        failure: failure,
      );
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

// NOTE: the saved smart-views rail was removed here. It read `/api/query-views`,
// an endpoint this repo's web app does not implement at all — so no backend
// configuration change can make it answer, and a repo that always returned `[]`
// was dead code presenting itself as a feature. If smart views are ever built
// server-side, the panel comes back with a real endpoint behind it.
