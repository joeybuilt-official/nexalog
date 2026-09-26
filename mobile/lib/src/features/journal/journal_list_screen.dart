import "package:flutter/material.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";
import "package:go_router/go_router.dart";
import "package:intl/intl.dart";

import "journal_providers.dart";

/// Journal index (web parity §8): today CTA + recent entries with mood/energy.
class JournalListScreen extends ConsumerWidget {
  const JournalListScreen({super.key});

  static String todayDate() =>
      DateFormat("yyyy-MM-dd").format(DateTime.now());

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<JournalEntry>> entries =
        ref.watch(journalListProvider);
    final String today = todayDate();
    return Scaffold(
      body: entries.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (Object e, _) => Center(child: Text("Error: $e")),
        data: (List<JournalEntry> all) {
          final bool hasToday = all.any((JournalEntry e) => e.entryDate == today);
          return ListView(
            children: <Widget>[
              Card(
                margin: const EdgeInsets.all(12),
                child: ListTile(
                  leading: const Icon(Icons.wb_sunny_outlined),
                  title: Text(hasToday ? "Open today" : "Start today"),
                  subtitle: Text(DateFormat("EEEE, MMMM d")
                      .format(DateTime.now())),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => context.go("/app/journal/$today"),
                ),
              ),
              const Padding(
                padding: EdgeInsets.fromLTRB(16, 8, 16, 4),
                child: Text("Recent"),
              ),
              ...all.where((JournalEntry e) => e.entryDate != today).map(
                    (JournalEntry e) => ListTile(
                      title: Text(_fmtDate(e.entryDate)),
                      subtitle: Text(
                        e.body.replaceAll("\n", " ").trim(),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      trailing: Text(
                        "${moodLabel(e.mood)} · ${moodLabel(e.energy)}",
                        style: Theme.of(context).textTheme.labelSmall,
                      ),
                      onTap: () => context.go("/app/journal/${e.entryDate}"),
                    ),
                  ),
              if (all.isEmpty)
                const Padding(
                  padding: EdgeInsets.all(32),
                  child: Center(child: Text("No journal entries yet")),
                ),
            ],
          );
        },
      ),
    );
  }

  String _fmtDate(String iso) {
    final DateTime? d = DateTime.tryParse(iso);
    return d == null ? iso : DateFormat("EEE, MMM d, y").format(d);
  }
}
