import "package:flutter/material.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";
import "package:go_router/go_router.dart";
import "package:intl/intl.dart";

import "../../core/offline/offline_repo.dart";
import "../../core/providers.dart";
import "../../core/voice/voice_dictation.dart";
import "../../core/workspace_providers.dart";
import "../notes/notes_providers.dart";

/// Today landing (web parity §7): long-form date header, a capture bar that
/// saves a raw thought offline, and a recently-saved list. v2 dropped the
/// queue-backed brief/lens sections with the /api/queue route.
class TodayScreen extends ConsumerStatefulWidget {
  const TodayScreen({super.key});

  @override
  ConsumerState<TodayScreen> createState() => _TodayScreenState();
}

class _TodayScreenState extends ConsumerState<TodayScreen> {
  final TextEditingController _capture = TextEditingController();

  @override
  void dispose() {
    _capture.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final String text = _capture.text.trim();
    if (text.isEmpty) return;
    final String? ws = await ref.read(activeWorkspaceIdProvider.future);
    if (ws == null) return;
    await ref.read(offlineRepoProvider).create(
      "notes",
      id: OfflineRepo.newId(),
      payload: <String, Object?>{
        "workspaceId": ws,
        "title": "",
        "content": text,
        "kind": "note",
        "lifecycleState": "raw",
      },
    );
    _capture.clear();
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<Note>> notes = ref.watch(notesListProvider);
    final String today =
        DateFormat("EEEE, MMMM d").format(DateTime.now());
    return ListView(
      padding: const EdgeInsets.all(16),
      children: <Widget>[
        Text(today,
            style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 16),
        TextField(
          controller: _capture,
          minLines: 1,
          maxLines: 4,
          textInputAction: TextInputAction.send,
          decoration: InputDecoration(
            hintText: "Capture a thought…",
            border: const OutlineInputBorder(),
            suffixIcon: Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                MicButton(controller: _capture, tooltip: "Dictate a thought"),
                IconButton(
                  icon: const Icon(Icons.send),
                  onPressed: _save,
                ),
              ],
            ),
          ),
          onSubmitted: (_) => _save(),
        ),
        const SizedBox(height: 24),
        Text("Recently saved",
            style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        ...notes.when(
          loading: () => <Widget>[const LinearProgressIndicator()],
          error: (Object e, _) => <Widget>[Text("Error: $e")],
          data: (List<Note> all) => all
              .take(8)
              .map((Note n) => Card(
                    child: ListTile(
                      title: Text(n.displayTitle,
                          maxLines: 1, overflow: TextOverflow.ellipsis),
                      subtitle: Text(
                        n.content.replaceAll("\n", " ").trim(),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      onTap: () => context.go("/app/notes/${n.id}"),
                    ),
                  ))
              .toList(),
        ),
      ],
    );
  }
}
