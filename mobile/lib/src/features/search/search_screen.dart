import 'dart:developer';
import "dart:async";

import "package:flutter/material.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";
import "package:go_router/go_router.dart";
import "package:url_launcher/url_launcher.dart";

import "result_lenses.dart";
import "search_providers.dart";

/// Global search / ContentFinder (web parity §6/§24): hybrid semantic+lexical
/// search via POST /api/search with sort + kind facet chips; offline falls back
/// to the local mirror. Debounced input. Result-lens switcher renders the same
/// rows as list / table / board / calendar (parity components/content-finder).
class SearchScreen extends ConsumerStatefulWidget {
  const SearchScreen({super.key});

  @override
  ConsumerState<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends ConsumerState<SearchScreen> {
  Timer? _debounce;
  SearchQuery _q = const SearchQuery();
  ResultLens _lens = ResultLens.list;

  static const Map<String, String> _sorts = <String, String>{
    "relevance": "Relevance",
    "recency": "Recent",
    "last_opened": "Last opened",
  };

  static const Map<String, String> _ages = <String, String>{
    "today": "Today",
    "7d": "7 days",
    "30d": "30 days",
    "90d": "3 months",
    "1y": "1 year",
    "all": "All time",
  };

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  void _onQuery(String v) {
    log('route.start', name: 'search');
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 250),
        () => setState(() => _q = _q.copyWith(query: v)));
  }

  IconData _icon(String kind) {
    switch (kind) {
      case "note":
        return Icons.notes_outlined;
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

  void _open(SearchResult r) {
    if (r.isNote) {
      context.go("/app/notes/${r.id}");
    } else if (r.url != null) {
      launchUrl(Uri.parse(r.url!), mode: LaunchMode.externalApplication);
    }
  }

  Widget _renderLens(SearchOutcome o) {
    switch (_lens) {
      case ResultLens.table:
        return ResultTable(results: o.results);
      case ResultLens.board:
        return ResultBoard(results: o.results);
      case ResultLens.calendar:
        return ResultCalendar(results: o.results);
      case ResultLens.list:
        return ListView.separated(
          itemCount: o.results.length,
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (BuildContext c, int i) {
            final SearchResult r = o.results[i];
            return ListTile(
              leading: Icon(_icon(r.kind)),
              title: Text(r.title,
                  maxLines: 1, overflow: TextOverflow.ellipsis),
              subtitle: r.snippet == null
                  ? null
                  : Text(r.snippet!,
                      maxLines: 2, overflow: TextOverflow.ellipsis),
              onTap: () => _open(r),
            );
          },
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<SearchOutcome> out = ref.watch(searchProvider(_q));
    return Column(
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
          child: TextField(
            autofocus: true,
            decoration: const InputDecoration(
              hintText: "Search notes & bookmarks",
              prefixIcon: Icon(Icons.search),
              border: OutlineInputBorder(),
              isDense: true,
            ),
            onChanged: _onQuery,
          ),
        ),
        Row(
          children: <Widget>[
            const SizedBox(width: 12),
            PopupMenuButton<String>(
              initialValue: _q.sort,
              onSelected: (String s) => setState(() => _q = _q.copyWith(sort: s)),
              itemBuilder: (BuildContext c) => _sorts.entries
                  .map((MapEntry<String, String> e) =>
                      PopupMenuItem<String>(value: e.key, child: Text(e.value)))
                  .toList(),
              child: Chip(
                avatar: const Icon(Icons.sort, size: 16),
                label: Text(_sorts[_q.sort] ?? "Sort"),
              ),
            ),
            const SizedBox(width: 8),
            PopupMenuButton<String?>(
              initialValue: _q.ageRange,
              onSelected: (String? a) => setState(() => _q = _q.copyWith(ageRange: a)),
              itemBuilder: (BuildContext c) => <PopupMenuEntry<String?>>[
                const PopupMenuItem<String?>(value: null, child: Text("Any time")),
                ..._ages.entries.map((MapEntry<String, String> e) =>
                    PopupMenuItem<String?>(value: e.key, child: Text(e.value))),
              ],
              child: Chip(
                avatar: const Icon(Icons.calendar_today_outlined, size: 16),
                label: Text(_q.ageRange != null ? (_ages[_q.ageRange] ?? _q.ageRange!) : "Age"),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _FacetChips(
                outcome: out.valueOrNull,
                active: _q.kind,
                onSelect: (String? k) => setState(() => _q = _q.copyWith(kind: k)),
              ),
            ),
            PopupMenuButton<ResultLens>(
              initialValue: _lens,
              tooltip: "View",
              onSelected: (ResultLens l) => setState(() => _lens = l),
              itemBuilder: (BuildContext c) => ResultLens.values
                  .map((ResultLens l) => PopupMenuItem<ResultLens>(
                        value: l,
                        child: Row(
                          children: <Widget>[
                            Icon(kResultLensIcons[l], size: 16),
                            const SizedBox(width: 8),
                            Text(kResultLensLabels[l] ?? ""),
                          ],
                        ),
                      ))
                  .toList(),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                child: Icon(kResultLensIcons[_lens]),
              ),
            ),
          ],
        ),
        Expanded(
          child: out.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (Object e, _) => Center(child: Text("Error: $e")),
            data: (SearchOutcome o) {
              if (_q.query.isEmpty && o.results.isEmpty) {
                return _SavedViewsPanel(
                  onSelect: (String q) =>
                      setState(() => _q = _q.copyWith(query: q)),
                );
              }
              if (o.results.isEmpty) {
                return const Center(child: Text("No matches"));
              }
              return _renderLens(o);
            },
          ),
        ),
      ],
    );
  }
}

// Shows saved smart-views when the search query is empty (P4 parity).
class _SavedViewsPanel extends ConsumerWidget {
  const _SavedViewsPanel({required this.onSelect});
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<SavedView>> views = ref.watch(savedViewsProvider);
    return views.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (_, __) => const Center(child: Text("Type to search")),
      data: (List<SavedView> list) {
        if (list.isEmpty) return const Center(child: Text("Type to search"));
        return ListView(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          children: <Widget>[
            Text("Saved views",
                style: Theme.of(context)
                    .textTheme
                    .labelSmall
                    ?.copyWith(color: Theme.of(context).colorScheme.outline)),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 4,
              children: list
                  .map((SavedView v) => ActionChip(
                        label: Text(v.name),
                        avatar: const Icon(Icons.bookmark_outline, size: 16),
                        onPressed: () => onSelect(v.query),
                      ))
                  .toList(),
            ),
          ],
        );
      },
    );
  }
}

class _FacetChips extends StatelessWidget {
  const _FacetChips({
    required this.outcome,
    required this.active,
    required this.onSelect,
  });

  final SearchOutcome? outcome;
  final String? active;
  final ValueChanged<String?> onSelect;

  @override
  Widget build(BuildContext context) {
    final Map<String, int> totals = outcome?.totalsByKind ?? const {};
    if (totals.isEmpty) return const SizedBox.shrink();
    final List<MapEntry<String, int>> kinds = totals.entries
        .where((MapEntry<String, int> e) => e.value > 0)
        .toList()
      ..sort((MapEntry<String, int> a, MapEntry<String, int> b) =>
          b.value.compareTo(a.value));
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: <Widget>[
          for (final MapEntry<String, int> e in kinds)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 2),
              child: FilterChip(
                label: Text("${e.key} ${e.value}"),
                selected: active == e.key,
                onSelected: (bool sel) => onSelect(sel ? e.key : null),
              ),
            ),
        ],
      ),
    );
  }
}
