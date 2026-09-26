import "dart:async";

import "package:flutter/material.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";
import "package:go_router/go_router.dart";
import "package:intl/intl.dart";

import "../../core/offline/offline_repo.dart";
import "../../core/voice/voice_dictation.dart";
import "../../core/workspace_providers.dart";
import "journal_providers.dart";

/// Dated journal entry editor (web parity §8): body + mood (1-5) + energy (1-5)
/// with debounced autosave. Upserts by date offline (update if the entry is
/// already mirrored, else create).
class JournalEntryScreen extends ConsumerStatefulWidget {
  const JournalEntryScreen({required this.date, super.key});

  final String date;

  @override
  ConsumerState<JournalEntryScreen> createState() => _JournalEntryScreenState();
}

class _JournalEntryScreenState extends ConsumerState<JournalEntryScreen> {
  final TextEditingController _body = TextEditingController();
  Timer? _debounce;
  bool _loaded = false;
  bool _saving = false;
  int? _mood;
  int? _energy;
  String? _existingId;

  @override
  void dispose() {
    _debounce?.cancel();
    _body.dispose();
    super.dispose();
  }

  void _onChanged() {
    _debounce?.cancel();
    _debounce = Timer(const Duration(seconds: 1), _save);
  }

  Future<void> _save() async {
    final String? ws = await ref.read(activeWorkspaceIdProvider.future);
    if (ws == null) return;
    setState(() => _saving = true);
    final Map<String, Object?> payload = <String, Object?>{
      "workspaceId": ws,
      "entryDate": widget.date,
      "body": _body.text,
      "mood": _mood,
      "energy": _energy,
    };
    final OfflineRepo repo = ref.read(offlineRepoProvider);
    if (_existingId != null) {
      await repo.update("journalEntries", id: _existingId!, payload: payload);
    } else {
      final String id = OfflineRepo.newId();
      _existingId = id;
      await repo.create("journalEntries", id: id, payload: payload);
    }
    if (mounted) setState(() => _saving = false);
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<JournalEntry?> entry =
        ref.watch(journalByDateProvider(widget.date));
    return entry.when(
      loading: () =>
          const Scaffold(body: Center(child: CircularProgressIndicator())),
      error: (Object e, _) => Scaffold(body: Center(child: Text("Error: $e"))),
      data: (JournalEntry? e) {
        if (!_loaded) {
          if (e != null) {
            _existingId = e.id;
            _body.text = e.body;
            _mood = e.mood;
            _energy = e.energy;
          }
          _loaded = true;
        }
        final DateTime? d = DateTime.tryParse(widget.date);
        return Scaffold(
          appBar: AppBar(
            leading: IconButton(
              icon: const Icon(Icons.arrow_back),
              onPressed: () => context.go("/app/journal"),
            ),
            title: Text(
              d == null ? widget.date : DateFormat("EEE, MMM d").format(d),
            ),
            actions: <Widget>[
              if (_saving)
                const Padding(
                  padding: EdgeInsets.only(right: 16),
                  child: Center(child: Text("Saving…")),
                ),
              MicButton(
                controller: _body,
                tooltip: "Dictate journal",
                onFinal: (_) => _onChanged(),
              ),
            ],
          ),
          body: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                _Scale(
                  label: "Mood",
                  value: _mood,
                  onChanged: (int v) {
                    setState(() => _mood = v);
                    _onChanged();
                  },
                ),
                _Scale(
                  label: "Energy",
                  value: _energy,
                  onChanged: (int v) {
                    setState(() => _energy = v);
                    _onChanged();
                  },
                ),
                const SizedBox(height: 12),
                Expanded(
                  child: TextField(
                    controller: _body,
                    maxLines: null,
                    expands: true,
                    textAlignVertical: TextAlignVertical.top,
                    decoration: const InputDecoration(
                      hintText: "How was today?",
                      border: OutlineInputBorder(),
                    ),
                    onChanged: (_) => _onChanged(),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _Scale extends StatelessWidget {
  const _Scale({required this.label, required this.value, required this.onChanged});

  final String label;
  final int? value;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: <Widget>[
        SizedBox(width: 64, child: Text(label)),
        for (int i = 1; i <= 5; i++)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 2),
            child: ChoiceChip(
              label: Text("$i"),
              selected: value == i,
              onSelected: (_) => onChanged(i),
            ),
          ),
      ],
    );
  }
}
