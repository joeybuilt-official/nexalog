import "package:flutter/material.dart";
import "package:go_router/go_router.dart";
import "package:url_launcher/url_launcher.dart";

import "search_providers.dart";

/// Database-style lenses over a /api/search result set — table / board /
/// calendar — mirroring components/content-finder/lenses.tsx on the web.
/// All lenses consume the same `SearchResult` list the list view uses.

enum ResultLens { list, table, board, calendar }

const Map<ResultLens, String> kResultLensLabels = <ResultLens, String>{
  ResultLens.list: "List",
  ResultLens.table: "Table",
  ResultLens.board: "Board",
  ResultLens.calendar: "Calendar",
};

const Map<ResultLens, IconData> kResultLensIcons = <ResultLens, IconData>{
  ResultLens.list: Icons.view_list_outlined,
  ResultLens.table: Icons.table_rows_outlined,
  ResultLens.board: Icons.view_column_outlined,
  ResultLens.calendar: Icons.calendar_month_outlined,
};

void openResult(BuildContext context, SearchResult r) {
  if (r.isNote) {
    context.go("/app/notes/${r.id}");
  } else if (r.url != null) {
    launchUrl(Uri.parse(r.url!), mode: LaunchMode.externalApplication);
  }
}

String _shortDate(String? v) {
  if (v == null) return "—";
  final DateTime? d = DateTime.tryParse(v);
  if (d == null) return "—";
  const List<String> mo = <String>[
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return "${mo[d.month - 1]} ${d.day}, ${d.year}";
}

String _timeLabel(SearchResult r) {
  if (r.readMinutes != null) return "${r.readMinutes}m read";
  if (r.watchMinutes != null) return "${r.watchMinutes}m watch";
  return "—";
}

class ResultTable extends StatelessWidget {
  const ResultTable({super.key, required this.results});
  final List<SearchResult> results;

  @override
  Widget build(BuildContext context) {
    if (results.isEmpty) {
      return const _Empty(label: "Nothing to show in this table.");
    }
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: DataTable(
        columnSpacing: 16,
        headingTextStyle: Theme.of(context).textTheme.labelSmall,
        columns: const <DataColumn>[
          DataColumn(label: Text("Title")),
          DataColumn(label: Text("Type")),
          DataColumn(label: Text("Theme")),
          DataColumn(label: Text("Saved")),
          DataColumn(label: Text("Opened")),
          DataColumn(label: Text("Time")),
        ],
        rows: <DataRow>[
          for (final SearchResult r in results)
            DataRow(
              cells: <DataCell>[
                DataCell(
                  ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 280),
                    child: Text(
                      r.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  onTap: () => openResult(context, r),
                ),
                DataCell(Text(r.kind)),
                DataCell(Text(r.themeLabel ?? "—",
                    maxLines: 1, overflow: TextOverflow.ellipsis)),
                DataCell(Text(_shortDate(r.createdAt))),
                DataCell(Text(_shortDate(r.openedAt))),
                DataCell(Text(_timeLabel(r))),
              ],
            ),
        ],
      ),
    );
  }
}

class ResultBoard extends StatelessWidget {
  const ResultBoard({super.key, required this.results});
  final List<SearchResult> results;

  static const List<String> _order = <String>[
    "note",
    "article",
    "video",
    "reference",
    "social",
    "homepage",
    "other",
  ];

  @override
  Widget build(BuildContext context) {
    if (results.isEmpty) {
      return const _Empty(label: "Nothing to show on this board.");
    }
    final Map<String, List<SearchResult>> groups = <String, List<SearchResult>>{};
    for (final SearchResult r in results) {
      final String k = r.kind.isEmpty ? "other" : r.kind;
      groups.putIfAbsent(k, () => <SearchResult>[]).add(r);
    }
    final List<MapEntry<String, List<SearchResult>>> cols = groups.entries.toList()
      ..sort((MapEntry<String, List<SearchResult>> a,
              MapEntry<String, List<SearchResult>> b) {
        int ra = _order.indexOf(a.key);
        int rb = _order.indexOf(b.key);
        if (ra == -1) ra = _order.length;
        if (rb == -1) rb = _order.length;
        return ra.compareTo(rb);
      });
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          for (final MapEntry<String, List<SearchResult>> col in cols)
            Container(
              width: 240,
              margin: const EdgeInsets.symmetric(horizontal: 4),
              decoration: BoxDecoration(
                border: Border.all(color: Theme.of(context).dividerColor),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: <Widget>[
                        Text(col.key,
                            style: Theme.of(context).textTheme.labelMedium),
                        Text("${col.value.length}",
                            style: Theme.of(context).textTheme.labelSmall),
                      ],
                    ),
                  ),
                  const Divider(height: 1),
                  ConstrainedBox(
                    constraints: const BoxConstraints(maxHeight: 480),
                    child: ListView.separated(
                      shrinkWrap: true,
                      padding: const EdgeInsets.all(6),
                      itemCount: col.value.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 4),
                      itemBuilder: (BuildContext c, int i) {
                        final SearchResult r = col.value[i];
                        return InkWell(
                          onTap: () => openResult(c, r),
                          child: Container(
                            padding: const EdgeInsets.all(8),
                            decoration: BoxDecoration(
                              border: Border.all(
                                  color: Theme.of(c).dividerColor),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: <Widget>[
                                Text(
                                  r.title,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: Theme.of(c).textTheme.bodyMedium,
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  _shortDate(r.createdAt),
                                  style: Theme.of(c).textTheme.bodySmall,
                                ),
                              ],
                            ),
                          ),
                        );
                      },
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class ResultCalendar extends StatefulWidget {
  const ResultCalendar({super.key, required this.results});
  final List<SearchResult> results;

  @override
  State<ResultCalendar> createState() => _ResultCalendarState();
}

class _ResultCalendarState extends State<ResultCalendar> {
  late DateTime _anchor;

  static const List<String> _weekdays = <String>[
    "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat",
  ];
  static const List<String> _monthNames = <String>[
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  @override
  void initState() {
    super.initState();
    _anchor = _initialAnchor(widget.results);
  }

  @override
  void didUpdateWidget(covariant ResultCalendar old) {
    super.didUpdateWidget(old);
    // Re-anchor only if the new newest createdAt is in a different month than
    // the current anchor (avoids fighting user navigation while results trail).
    final DateTime fresh = _initialAnchor(widget.results);
    if (fresh.year != _anchor.year || fresh.month != _anchor.month) {
      if (old.results.isEmpty && widget.results.isNotEmpty) {
        _anchor = fresh;
      }
    }
  }

  static DateTime _initialAnchor(List<SearchResult> results) {
    final String? newest = results.isEmpty ? null : results.first.createdAt;
    final DateTime d =
        newest != null ? (DateTime.tryParse(newest) ?? DateTime.now()) : DateTime.now();
    return DateTime(d.year, d.month, 1);
  }

  @override
  Widget build(BuildContext context) {
    final Map<String, List<SearchResult>> byDay = <String, List<SearchResult>>{};
    for (final SearchResult r in widget.results) {
      final String? c = r.createdAt;
      if (c == null) continue;
      final DateTime? d = DateTime.tryParse(c);
      if (d == null) continue;
      final String key = "${d.year}-${d.month}-${d.day}";
      byDay.putIfAbsent(key, () => <SearchResult>[]).add(r);
    }
    final int year = _anchor.year;
    final int month = _anchor.month;
    final int firstDow = DateTime(year, month, 1).weekday % 7; // Sun=0
    final int daysInMonth = DateTime(year, month + 1, 0).day;
    final DateTime now = DateTime.now();
    final List<int?> cells = <int?>[];
    for (int i = 0; i < firstDow; i++) {
      cells.add(null);
    }
    for (int d = 1; d <= daysInMonth; d++) {
      cells.add(d);
    }
    while (cells.length % 7 != 0) {
      cells.add(null);
    }
    return Column(
      children: <Widget>[
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Text("${_monthNames[month - 1]} $year",
                  style: Theme.of(context).textTheme.titleSmall),
            ),
            Row(
              children: <Widget>[
                IconButton(
                  icon: const Icon(Icons.chevron_left),
                  tooltip: "Previous month",
                  onPressed: () => setState(
                      () => _anchor = DateTime(year, month - 1, 1)),
                ),
                TextButton(
                  onPressed: () => setState(
                      () => _anchor = DateTime(now.year, now.month, 1)),
                  child: const Text("Today"),
                ),
                IconButton(
                  icon: const Icon(Icons.chevron_right),
                  tooltip: "Next month",
                  onPressed: () => setState(
                      () => _anchor = DateTime(year, month + 1, 1)),
                ),
              ],
            ),
          ],
        ),
        const Divider(height: 1),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Row(
            children: <Widget>[
              for (final String w in _weekdays)
                Expanded(
                  child: Center(
                    child: Text(w,
                        style: Theme.of(context).textTheme.labelSmall),
                  ),
                ),
            ],
          ),
        ),
        const Divider(height: 1),
        Expanded(
          child: GridView.builder(
            padding: const EdgeInsets.all(2),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 7,
              childAspectRatio: 0.85,
            ),
            itemCount: cells.length,
            itemBuilder: (BuildContext c, int i) {
              final int? day = cells[i];
              if (day == null) {
                return Container(
                  decoration: BoxDecoration(
                    border: Border.all(
                        color: Theme.of(c).dividerColor.withValues(alpha: 0.3)),
                  ),
                );
              }
              final String key = "$year-$month-$day";
              final List<SearchResult> items =
                  byDay[key] ?? const <SearchResult>[];
              final bool isToday =
                  now.year == year && now.month == month && now.day == day;
              return Container(
                decoration: BoxDecoration(
                  border: Border.all(
                      color: Theme.of(c).dividerColor.withValues(alpha: 0.4)),
                ),
                padding: const EdgeInsets.all(2),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      "$day",
                      style: Theme.of(c).textTheme.labelSmall?.copyWith(
                            fontWeight:
                                isToday ? FontWeight.bold : FontWeight.normal,
                          ),
                    ),
                    Expanded(
                      child: ListView(
                        padding: EdgeInsets.zero,
                        children: <Widget>[
                          for (int j = 0;
                              j < items.length && j < 3;
                              j++)
                            InkWell(
                              onTap: () => openResult(c, items[j]),
                              child: Container(
                                margin:
                                    const EdgeInsets.symmetric(vertical: 1),
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 2, vertical: 1),
                                decoration: BoxDecoration(
                                  color: Theme.of(c)
                                      .colorScheme
                                      .surfaceContainerHighest,
                                  borderRadius: BorderRadius.circular(2),
                                ),
                                child: Text(
                                  items[j].title,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(fontSize: 10),
                                ),
                              ),
                            ),
                          if (items.length > 3)
                            Padding(
                              padding: const EdgeInsets.only(left: 2),
                              child: Text(
                                "+${items.length - 3} more",
                                style: const TextStyle(fontSize: 9),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty({required this.label});
  final String label;
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Text(label,
            style: Theme.of(context).textTheme.bodyMedium,
            textAlign: TextAlign.center),
      ),
    );
  }
}
