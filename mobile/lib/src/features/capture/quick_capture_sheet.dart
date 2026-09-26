import "package:flutter/material.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";

import "../../core/offline/offline_repo.dart";
import "../../core/voice/voice_dictation.dart";
import "../../core/workspace_providers.dart";

/// Global quick-capture (web parity §3 ⌘⇧C modal). Available from any screen via
/// the app-bar "+"; auto-detects url vs text and queues offline (capture_sources
/// for a url, raw note for text) — works fully offline.
Future<void> showQuickCapture(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (BuildContext c) => Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(c).viewInsets.bottom,
        left: 16,
        right: 16,
        top: 8,
      ),
      child: const _QuickCaptureBody(),
    ),
  );
}

class _QuickCaptureBody extends ConsumerStatefulWidget {
  const _QuickCaptureBody();

  @override
  ConsumerState<_QuickCaptureBody> createState() => _QuickCaptureBodyState();
}

class _QuickCaptureBodyState extends ConsumerState<_QuickCaptureBody> {
  final TextEditingController _input = TextEditingController();
  String _detected = "text";

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  bool _isUrl(String s) {
    final String t = s.trim();
    return t.startsWith("http://") || t.startsWith("https://");
  }

  Future<void> _save() async {
    final String text = _input.text.trim();
    if (text.isEmpty) return;
    final String? ws = await ref.read(activeWorkspaceIdProvider.future);
    if (ws == null) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text("Sync once online before capturing.")));
      }
      return;
    }
    final OfflineRepo repo = ref.read(offlineRepoProvider);
    if (_detected == "url") {
      await repo.create("captureSources",
          id: OfflineRepo.newId(),
          payload: <String, Object?>{
            "workspaceId": ws,
            "kind": "url",
            "content": "",
            "url": text,
            "state": "raw",
          });
    } else {
      await repo.create("notes",
          id: OfflineRepo.newId(),
          payload: <String, Object?>{
            "workspaceId": ws,
            "title": "",
            "content": text,
            "kind": "note",
            "lifecycleState": "raw",
          });
    }
    if (mounted) {
      Navigator.of(context).pop();
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Captured to Inbox")));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Row(
          children: <Widget>[
            Chip(
              avatar: Icon(_detected == "url" ? Icons.link : Icons.notes, size: 16),
              label: Text(_detected == "url" ? "Link" : "Text"),
            ),
            const Spacer(),
            MicButton(
              controller: _input,
              tooltip: "Dictate a note",
              onFinal: (String t) {
                final String k = _isUrl(t) ? "url" : "text";
                if (k != _detected) setState(() => _detected = k);
              },
            ),
          ],
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _input,
          autofocus: true,
          minLines: 3,
          maxLines: 8,
          decoration: const InputDecoration(
            hintText: "Paste a link or jot a thought…",
            border: OutlineInputBorder(),
          ),
          onChanged: (String v) {
            final String k = _isUrl(v) ? "url" : "text";
            if (k != _detected) setState(() => _detected = k);
          },
        ),
        const SizedBox(height: 12),
        FilledButton.icon(
          onPressed: _save,
          icon: const Icon(Icons.save),
          label: const Text("Capture"),
        ),
        const SizedBox(height: 12),
      ],
    );
  }
}
