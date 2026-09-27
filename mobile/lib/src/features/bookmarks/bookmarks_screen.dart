import "dart:async";

import "package:flutter/material.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";
import "package:go_router/go_router.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/surface_state.dart";
import "../../core/providers.dart";
import "../search/search_providers.dart";

/// A capture/bookmark row mirrored from the server (camelCase, matching the
/// Drizzle `capture_sources` row returned by /api/sync).
class Capture {
  Capture(this.raw);
  final Map<String, Object?> raw;

  String get id => raw["id"]?.toString() ?? "";
  String? get url => raw["url"]?.toString();
  String get kind =>
      raw["kindClassified"]?.toString() ?? raw["kind"]?.toString() ?? "other";
  String get state => raw["state"]?.toString() ?? "raw";
  String? get updatedAt => raw["updatedAt"]?.toString();

  String get title {
    for (final String k in const <String>[
      "derivedTitle",
      "ogTitle",
      "themeLabel",
    ]) {
      final String? v = raw[k]?.toString();
      if (v != null && v.trim().isNotEmpty) return v.trim();
    }
    final String content = raw["content"]?.toString() ?? "";
    if (content.trim().isNotEmpty) return content.trim().split("\n").first;
    return url ?? "Untitled";
  }
}

final bookmarksProvider = FutureProvider<List<Capture>>((Ref ref) async {
  ref.watch(mirrorRevisionProvider);
  final List<Map<String, Object?>> rows =
      await ref.watch(appDbProvider).readAll("captureSources");
  final List<Capture> caps = rows.map(Capture.new).toList()
    ..sort((Capture a, Capture b) =>
        (b.updatedAt ?? "").compareTo(a.updatedAt ?? ""));
  return caps;
});

IconData _kindIcon(String kind) {
  switch (kind) {
    case "video":
      return Icons.smart_display_outlined;
    case "article":
      return Icons.article_outlined;
    case "reference":
      return Icons.menu_book_outlined;
    case "homepage":
      return Icons.public;
    default:
      return Icons.bookmark_outline;
  }
}

/// Bookmarks list (web parity §5). Empty query → offline-mirrored captures.
/// Non-empty query → unified ContentFinder via POST /api/search restricted to
/// surfaces:["bookmarks"] (article+reference+social+homepage+other) so hybrid
/// lexical+semantic ranking applies; falls back to the mirror filter offline.
class BookmarksScreen extends ConsumerStatefulWidget {
  const BookmarksScreen({super.key});

  @override
  ConsumerState<BookmarksScreen> createState() => _BookmarksScreenState();
}

class _BookmarksScreenState extends ConsumerState<BookmarksScreen> {
  Timer? _debounce;
  String _query = "";

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  void _onQuery(String v) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 250),
        () => setState(() => _query = v));
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
          child: TextField(
            decoration: const InputDecoration(
              hintText: "Search bookmarks",
              prefixIcon: Icon(Icons.search),
              isDense: true,
              border: OutlineInputBorder(),
            ),
            onChanged: _onQuery,
          ),
        ),
        Expanded(
          child: _query.trim().isEmpty
              ? const _BookmarksMirrorList()
              : _BookmarksSearchList(query: _query.trim()),
        ),
      ],
    );
  }
}

class _BookmarksMirrorList extends ConsumerWidget {
  const _BookmarksMirrorList();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<Capture>> caps = ref.watch(bookmarksProvider);
    return caps.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (Object e, _) => SurfaceUnavailablePanel(
          error: SurfaceError.fromObject(e, surface: "Bookmarks"),
        ),
      data: (List<Capture> list) {
        if (list.isEmpty) return const Center(child: Text("No bookmarks yet"));
        return ListView.separated(
          itemCount: list.length,
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (BuildContext c, int i) {
            final Capture cap = list[i];
            return ListTile(
              leading: Icon(_kindIcon(cap.kind)),
              title: Text(cap.title,
                  maxLines: 2, overflow: TextOverflow.ellipsis),
              subtitle: cap.url == null
                  ? null
                  : Text(cap.url!,
                      maxLines: 1, overflow: TextOverflow.ellipsis),
              trailing: IconButton(
                icon: const Icon(Icons.chrome_reader_mode_outlined),
                tooltip: "Reader",
                onPressed: () => context.go("/app/bookmarks/${cap.id}/reader"),
              ),
              onTap: cap.url == null
                  ? null
                  : () => launchUrl(Uri.parse(cap.url!),
                      mode: LaunchMode.externalApplication),
            );
          },
        );
      },
    );
  }
}

class _BookmarksSearchList extends ConsumerWidget {
  const _BookmarksSearchList({required this.query});

  final String query;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final SearchQuery sq = SearchQuery(
      query: query,
      surfaces: const <String>["bookmarks"],
    );
    final AsyncValue<SearchOutcome> out = ref.watch(searchProvider(sq));
    return out.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (Object e, _) => SurfaceUnavailablePanel(
          error: SurfaceError.fromObject(e, surface: "Bookmarks"),
        ),
      data: (SearchOutcome o) {
        if (o.failure != null) {
          return SurfaceUnavailablePanel(error: o.failure!);
        }
        if (o.results.isEmpty) return const Center(child: Text("No matches"));
        return ListView.separated(
          itemCount: o.results.length,
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (BuildContext c, int i) {
            final SearchResult r = o.results[i];
            return ListTile(
              leading: Icon(_kindIcon(r.kind)),
              title:
                  Text(r.title, maxLines: 2, overflow: TextOverflow.ellipsis),
              subtitle: r.url == null
                  ? (r.snippet == null
                      ? null
                      : Text(r.snippet!,
                          maxLines: 1, overflow: TextOverflow.ellipsis))
                  : Text(r.url!,
                      maxLines: 1, overflow: TextOverflow.ellipsis),
              trailing: IconButton(
                icon: const Icon(Icons.chrome_reader_mode_outlined),
                tooltip: "Reader",
                onPressed: () => context.go("/app/bookmarks/${r.id}/reader"),
              ),
              onTap: r.url == null
                  ? null
                  : () => launchUrl(Uri.parse(r.url!),
                      mode: LaunchMode.externalApplication),
            );
          },
        );
      },
    );
  }
}
