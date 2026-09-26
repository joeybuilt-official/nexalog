import "dart:async";

import "package:flutter/material.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";
import "package:go_router/go_router.dart";
import "package:intl/intl.dart";

import "../../core/offline/offline_repo.dart";
import "../../core/workspace_providers.dart";
import "../search/search_providers.dart";
import "notes_providers.dart";

/// Notes list (web parity §4: ContentFinder list of notes + New Note). Reads
/// the offline mirror; create works offline via the mutation queue. When the
/// user types a query, the list rebinds to the unified ContentFinder backing
/// (POST /api/search restricted to surfaces:["notes"]) so semantic+lexical
/// hybrid kicks in — falls back to the mirror filter offline.
class NotesListScreen extends ConsumerStatefulWidget {
  const NotesListScreen({super.key});

  @override
  ConsumerState<NotesListScreen> createState() => _NotesListScreenState();
}

class _NotesListScreenState extends ConsumerState<NotesListScreen> {
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

  Future<void> _newNote() async {
    final String? ws = await ref.read(activeWorkspaceIdProvider.future);
    if (ws == null) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text("Sync once online before creating notes.")));
      }
      return;
    }
    final String id = OfflineRepo.newId();
    await ref.read(offlineRepoProvider).create(
      "notes",
      id: id,
      payload: <String, Object?>{
        "workspaceId": ws,
        "title": "",
        "content": "",
        "kind": "note",
        "lifecycleState": "active",
      },
    );
    if (mounted) context.go("/app/notes/$id");
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      floatingActionButton: FloatingActionButton(
        onPressed: _newNote,
        child: const Icon(Icons.add),
      ),
      body: Column(
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
            child: TextField(
              decoration: const InputDecoration(
                hintText: "Search notes",
                prefixIcon: Icon(Icons.search),
                isDense: true,
                border: OutlineInputBorder(),
              ),
              onChanged: _onQuery,
            ),
          ),
          Expanded(
            child: _query.trim().isEmpty
                ? const _NotesMirrorList()
                : _NotesSearchList(query: _query.trim()),
          ),
        ],
      ),
    );
  }
}

class _NotesMirrorList extends ConsumerWidget {
  const _NotesMirrorList();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<Note>> notes = ref.watch(notesListProvider);
    return notes.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (Object e, _) => Center(child: Text("Error: $e")),
      data: (List<Note> list) {
        if (list.isEmpty) return const Center(child: Text("No notes yet"));
        return ListView.separated(
          itemCount: list.length,
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (BuildContext c, int i) {
            final Note n = list[i];
            return ListTile(
              title: Text(n.displayTitle,
                  maxLines: 1, overflow: TextOverflow.ellipsis),
              subtitle: Text(
                n.content.replaceAll("\n", " ").trim(),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              trailing: Text(_fmt(n.updatedAt),
                  style: Theme.of(c).textTheme.labelSmall),
              onTap: () => context.go("/app/notes/${n.id}"),
            );
          },
        );
      },
    );
  }

  String _fmt(String? iso) {
    if (iso == null) return "";
    final DateTime? d = DateTime.tryParse(iso);
    if (d == null) return "";
    return DateFormat.MMMd().format(d.toLocal());
  }
}

class _NotesSearchList extends ConsumerWidget {
  const _NotesSearchList({required this.query});

  final String query;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final SearchQuery sq = SearchQuery(
      query: query,
      surfaces: const <String>["notes"],
    );
    final AsyncValue<SearchOutcome> out = ref.watch(searchProvider(sq));
    return out.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (Object e, _) => Center(child: Text("Error: $e")),
      data: (SearchOutcome o) {
        if (o.results.isEmpty) return const Center(child: Text("No matches"));
        return ListView.separated(
          itemCount: o.results.length,
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (BuildContext c, int i) {
            final SearchResult r = o.results[i];
            return ListTile(
              leading: const Icon(Icons.notes_outlined),
              title: Text(r.title,
                  maxLines: 1, overflow: TextOverflow.ellipsis),
              subtitle: r.snippet == null
                  ? null
                  : Text(r.snippet!,
                      maxLines: 2, overflow: TextOverflow.ellipsis),
              onTap: () => context.go("/app/notes/${r.id}"),
            );
          },
        );
      },
    );
  }
}
