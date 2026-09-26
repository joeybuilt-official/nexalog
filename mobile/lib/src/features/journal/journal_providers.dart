import "package:flutter_riverpod/flutter_riverpod.dart";

import "../../core/providers.dart";

/// A journal entry mirrored from the server (camelCase, matching the Drizzle
/// `journal_entries` row returned by /api/sync).
class JournalEntry {
  JournalEntry(this.raw);
  final Map<String, Object?> raw;

  String get id => raw["id"]?.toString() ?? "";
  String get workspaceId => raw["workspaceId"]?.toString() ?? "";
  String get entryDate => raw["entryDate"]?.toString() ?? "";
  String get body => raw["body"]?.toString() ?? "";
  int? get mood => _int(raw["mood"]);
  int? get energy => _int(raw["energy"]);
  String? get updatedAt => raw["updatedAt"]?.toString();

  static int? _int(Object? v) {
    if (v == null) return null;
    if (v is int) return v;
    return int.tryParse(v.toString());
  }
}

const List<String> kMoodLabels = <String>["low", "meh", "ok", "good", "high"];

String moodLabel(int? v) =>
    (v == null || v < 1 || v > 5) ? "—" : kMoodLabels[v - 1];

/// All journal entries from the local mirror, newest date first.
final journalListProvider = FutureProvider<List<JournalEntry>>((Ref ref) async {
  ref.watch(mirrorRevisionProvider);
  final List<Map<String, Object?>> rows =
      await ref.watch(appDbProvider).readAll("journalEntries");
  final List<JournalEntry> list = rows.map(JournalEntry.new).toList()
    ..sort((JournalEntry a, JournalEntry b) =>
        b.entryDate.compareTo(a.entryDate));
  return list;
});

/// The entry for a given date (YYYY-MM-DD), or null if none exists locally.
final journalByDateProvider =
    FutureProvider.family<JournalEntry?, String>((Ref ref, String date) async {
  ref.watch(mirrorRevisionProvider);
  final List<JournalEntry> all = await ref.watch(journalListProvider.future);
  for (final JournalEntry e in all) {
    if (e.entryDate == date) return e;
  }
  return null;
});
