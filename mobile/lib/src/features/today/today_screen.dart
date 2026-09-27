import "package:flutter/material.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";
import "package:go_router/go_router.dart";
import "package:intl/intl.dart";

import "../../core/api/capture_repo.dart";
import "../../core/providers.dart";
import "../../core/voice/voice_dictation.dart";
import "../captures/capture_review_models.dart";
import "../captures/capture_review_repo.dart";
import "../notes/notes_providers.dart";

/// Today landing: long-form date header, a capture bar that posts straight to
/// the v2 intake (POST /api/capture), a "Recent captures" list read from the
/// capture inbox (GET /api/captures via CaptureReviewRepo), and the mirrored
/// "Recently saved" notes below it.
///
/// The two lists read genuinely different stores, and both are kept:
///   - **Recent captures** — `GET /api/captures` (the brain repo). Shows what
///     this device has just captured, immediately, without waiting on a sync.
///   - **Recently saved** — the local notes mirror, filled by the `/api/sync`
///     delta. This is the operator's note library, so it stays exactly where it
///     was; the section is additive to the capture list, not a replacement for
///     it. Its empty state explains the dependency rather than reading as "your
///     notes are gone", because a mirror that has not pulled yet is
///     indistinguishable from an empty library unless the screen says which.
///
/// v2 dropped the queue-backed brief/lens sections with the /api/queue route;
/// /api/today/cards is deliberately NOT wired.
class TodayScreen extends ConsumerStatefulWidget {
  const TodayScreen({super.key});

  @override
  ConsumerState<TodayScreen> createState() => _TodayScreenState();
}

/// The most recent captures, any status — newest first, small page.
final recentCapturesProvider = FutureProvider<CaptureInboxPage>((Ref ref) async {
  ref.watch(mirrorRevisionProvider);
  return ref.watch(captureReviewRepoProvider).list(limit: 8);
});

class _TodayScreenState extends ConsumerState<TodayScreen> {
  final TextEditingController _capture = TextEditingController();
  bool _sending = false;
  String? _captureError;

  @override
  void dispose() {
    _capture.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final String text = _capture.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() {
      _sending = true;
      _captureError = null;
    });
    try {
      await ref.read(captureRepoProvider).post(text: text);
      if (!mounted) return;
      _capture.clear();
      // Honest success: only a real 201 lands here. Refresh the recent list.
      ref.invalidate(recentCapturesProvider);
    } on CaptureError catch (e) {
      if (!mounted) return;
      setState(() => _captureError = e.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<CaptureInboxPage> captures =
        ref.watch(recentCapturesProvider);
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
                _sending
                    ? const Padding(
                        padding: EdgeInsets.all(12),
                        child: SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2)),
                      )
                    : IconButton(
                        icon: const Icon(Icons.send),
                        onPressed: _save,
                      ),
              ],
            ),
          ),
          onSubmitted: (_) => _save(),
        ),
        if (_captureError != null) ...<Widget>[
          const SizedBox(height: 8),
          Text(
            _captureError!,
            key: const Key("capture-error"),
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        ],
        const SizedBox(height: 24),
        Text("Recent captures",
            style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        ...captures.when(
          loading: () => <Widget>[const LinearProgressIndicator()],
          error: (Object e, _) => <Widget>[
            // The inbox could not be read: say so rather than rendering the
            // section as if the inbox were empty. Never a raw exception dump.
            Text(
              "Could not load recent captures.",
              key: const Key("recent-captures-error"),
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ],
          data: (CaptureInboxPage page) {
            if (page.captures.isEmpty) {
              return <Widget>[
                Text(
                  "Nothing captured yet.",
                  style:
                      TextStyle(color: Theme.of(context).colorScheme.outline),
                ),
              ];
            }
            return page.captures
                .map((CaptureItem c) => _RecentCaptureTile(item: c))
                .toList();
          },
        ),
        const SizedBox(height: 24),
        Text("Recently saved",
            style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        ...notes.when(
          loading: () => <Widget>[const LinearProgressIndicator()],
          error: (Object e, _) => <Widget>[
            // A mirror read is local storage, so this should not happen; if it
            // does, say so rather than rendering a section that looks empty.
            Text(
              "Could not read your saved notes on this device.",
              key: const Key("recently-saved-error"),
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ],
          data: (List<Note> all) {
            if (all.isEmpty) {
              return const <Widget>[
                _MirrorEmptyNote(key: Key("recently-saved-empty")),
              ];
            }
            return all
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
                .toList();
          },
        ),
      ],
    );
  }
}

/// The graceful empty state for the mirrored notes section.
///
/// Honest about WHY it can be empty: the mirror fills from the `/api/sync`
/// delta, so on a first run, before a sync has pulled, or on a deployment where
/// that surface cannot serve, the list is empty while the library is not. A bare
/// "nothing here yet" would let an operator conclude their notes vanished — the
/// exact silent-loss failure this cutover exists to remove.
class _MirrorEmptyNote extends StatelessWidget {
  const _MirrorEmptyNote({super.key});

  @override
  Widget build(BuildContext context) {
    return Text(
      "No notes mirrored to this device yet. Notes arrive by syncing from the "
      "server; if that surface is unavailable on this deployment, this list "
      "stays empty. Your captures above are unaffected.",
      style: TextStyle(color: Theme.of(context).colorScheme.outline),
    );
  }
}

class _RecentCaptureTile extends StatelessWidget {
  const _RecentCaptureTile({required this.item});

  final CaptureItem item;

  @override
  Widget build(BuildContext context) {
    final DateTime? at = DateTime.tryParse(item.capturedAt);
    final String when = at == null
        ? ""
        : DateFormat.MMMd().add_jm().format(at.toLocal());
    return Card(
      key: Key("recent-capture-${item.id}"),
      child: ListTile(
        title: Text(
          item.title.trim().isEmpty ? "(untitled)" : item.title,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        subtitle: Text(
          <String>[item.status, when].where((String s) => s.isNotEmpty).join(" · "),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: const Icon(Icons.chevron_right),
        // The capture review screen is the surface that can act on any capture
        // (accept/reject a proposal), so every row deep-links there.
        onTap: () => context.go("/app/captures/review"),
      ),
    );
  }
}
