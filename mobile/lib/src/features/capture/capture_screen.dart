import 'dart:developer';
import "package:flutter/material.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";

import "../../core/offline/offline_repo.dart";
import "../../core/voice/voice_dictation.dart";
import "../../core/workspace_providers.dart";

/// Quick capture (web parity §3: POST /api/capture). Auto-detects url vs text.
/// Offline-first: a url is queued as a capture_sources row (server enrichment +
/// twin-note classification runs server-side when the intent drains); free text
/// is queued as a raw note. The voice memo + share-target paths follow.
class CaptureScreen extends ConsumerStatefulWidget {
  const CaptureScreen({super.key});

  @override
  ConsumerState<CaptureScreen> createState() => _CaptureScreenState();
}

class _CaptureScreenState extends ConsumerState<CaptureScreen> {
  final TextEditingController _input = TextEditingController();
  String _detected = "text";
  bool _saved = false;

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  bool _looksLikeUrl(String s) {
    final String t = s.trim();
    return t.startsWith("http://") || t.startsWith("https://");
  }

  void _onChanged(String v) {
    final String k = _looksLikeUrl(v) ? "url" : "text";
    if (k != _detected) setState(() => _detected = k);
  }

  Future<void> _save() async {
    log('route.start', name: 'capture');
    final String text = _input.text.trim();
    if (text.isEmpty) return;
    final String? ws = await ref.read(activeWorkspaceIdProvider.future);
    if (ws == null) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text("Sync once online before capturing.")));
      }
      return;
    }
    final OfflineRepo repo = ref.read(offlineRepoProvider);
    if (_detected == "url") {
      await repo.create(
        "captureSources",
        id: OfflineRepo.newId(),
        payload: <String, Object?>{
          "workspaceId": ws,
          "kind": "url",
          "content": "",
          "url": text,
          "state": "raw",
        },
      );
    } else {
      await repo.create(
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
    }
    _input.clear();
    if (mounted) {
      setState(() => _saved = true);
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Captured to Inbox")));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              Chip(
                avatar: Icon(
                    _detected == "url" ? Icons.link : Icons.notes,
                    size: 16),
                label: Text(_detected == "url" ? "Link" : "Text"),
              ),
              const Spacer(),
              MicButton(
                controller: _input,
                tooltip: "Dictate a note",
                onFinal: (String t) => _onChanged(t),
              ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _input,
            autofocus: true,
            minLines: 4,
            maxLines: 10,
            decoration: const InputDecoration(
              hintText: "Paste a link or jot a thought…",
              border: OutlineInputBorder(),
            ),
            onChanged: _onChanged,
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: _save,
            icon: const Icon(Icons.save),
            label: const Text("Capture"),
          ),
          if (_saved)
            const Padding(
              padding: EdgeInsets.only(top: 12),
              child: Text("Saved. Will sync when online.",
                  textAlign: TextAlign.center),
            ),
        ],
      ),
    );
  }
}
