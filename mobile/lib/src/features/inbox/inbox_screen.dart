import "package:flutter/material.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";
import "package:go_router/go_router.dart";

import "../notes/notes_providers.dart";

const List<String> _lifecycles = <String>[
  "raw",
  "understanding",
  "refined",
  "active",
  "archived",
];

/// Inbox (web parity §9): lifecycle triage tabs with counts + kind filter, over
/// the offline notes mirror. Bookmark-twin notes are excluded (live on
/// Bookmarks). 200-item cap with a "most recent" notice, matching web.
class InboxScreen extends ConsumerStatefulWidget {
  const InboxScreen({super.key});

  @override
  ConsumerState<InboxScreen> createState() => _InboxScreenState();
}

class _InboxScreenState extends ConsumerState<InboxScreen> {
  String _state = "raw";
  String _kind = "all"; // all | note | daily

  bool _matchesKind(Note n) {
    if (_kind == "all") return true;
    if (_kind == "daily") return n.kind == "daily";
    return n.kind == "note";
  }

  @override
  Widget build(BuildContext context) {
    final List<Note> all = ref.watch(notesListProvider).valueOrNull ?? const [];
    final Map<String, int> counts = <String, int>{
      for (final String s in _lifecycles)
        s: all.where((Note n) => n.lifecycleState == s).length,
    };
    final List<Note> filtered = all
        .where((Note n) => n.lifecycleState == _state && _matchesKind(n))
        .toList();
    final bool capped = filtered.length > 200;
    final List<Note> shown = capped ? filtered.sublist(0, 200) : filtered;

    return Column(
      children: <Widget>[
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
          child: Row(
            children: _lifecycles
                .map((String s) => Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 4),
                      child: ChoiceChip(
                        label: Text("$s ${counts[s]}"),
                        selected: _state == s,
                        onSelected: (_) => setState(() => _state = s),
                      ),
                    ))
                .toList(),
          ),
        ),
        Row(
          children: <Widget>[
            const SizedBox(width: 12),
            const Text("Kind:"),
            const SizedBox(width: 8),
            for (final String k in const <String>["all", "note", "daily"])
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 2),
                child: ChoiceChip(
                  label: Text(k),
                  selected: _kind == k,
                  onSelected: (_) => setState(() => _kind = k),
                ),
              ),
          ],
        ),
        if (capped)
          const Padding(
            padding: EdgeInsets.all(8),
            child: Text("Showing most recent 200"),
          ),
        Expanded(
          child: shown.isEmpty
              ? Center(child: Text("Nothing in $_state"))
              : ListView.separated(
                  itemCount: shown.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (BuildContext c, int i) {
                    final Note n = shown[i];
                    return ListTile(
                      title: Text(n.displayTitle,
                          maxLines: 1, overflow: TextOverflow.ellipsis),
                      subtitle: Text(
                        n.content.replaceAll("\n", " ").trim(),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      trailing: Chip(
                        label: Text(n.lifecycleState,
                            style: Theme.of(c).textTheme.labelSmall),
                        visualDensity: VisualDensity.compact,
                      ),
                      onTap: () => context.go("/app/notes/${n.id}"),
                    );
                  },
                ),
        ),
      ],
    );
  }
}

