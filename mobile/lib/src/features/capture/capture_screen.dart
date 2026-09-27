import 'dart:developer';
import "package:flutter/material.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";

import "../../core/api/capture_repo.dart";
import "../../core/voice/voice_dictation.dart";

/// Quick capture against the v2 intake route (POST /api/capture, multipart).
/// Auto-detects url vs text and sends exactly one of the two fields. There is no
/// workspace gate — the intake route needs none, and requiring one made capture
/// depend on a second endpoint — and no offline queue: this used to enqueue into
/// the `/api/sync` mutations route, so a "capture" could sit on the device while
/// the UI claimed success. Success is shown ONLY on a real 201 with a captureId;
/// every failure says what happened and keeps the input.
class CaptureScreen extends ConsumerStatefulWidget {
  const CaptureScreen({super.key});

  @override
  ConsumerState<CaptureScreen> createState() => _CaptureScreenState();
}

class _CaptureScreenState extends ConsumerState<CaptureScreen> {
  final TextEditingController _input = TextEditingController();
  String _detected = "text";
  bool _saved = false;
  bool _saving = false;

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
    if (text.isEmpty || _saving) return;
    setState(() {
      _saving = true;
      _saved = false;
    });
    try {
      await ref.read(captureRepoProvider).post(
            text: _detected == "url" ? null : text,
            url: _detected == "url" ? text : null,
          );
      if (!mounted) return;
      _input.clear();
      setState(() => _saved = true);
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Captured to Inbox")));
    } on CaptureError catch (e) {
      log('capture.error', name: 'capture', error: e.code);
      if (!mounted) return;
      // Honest failure: the capture did NOT land; say so and keep the input.
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _saving = false);
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
            onPressed: _saving ? null : _save,
            icon: _saving
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.save),
            label: Text(_saving ? "Saving…" : "Capture"),
          ),
          if (_saved)
            const Padding(
              padding: EdgeInsets.only(top: 12),
              child: Text("Saved to your Inbox.",
                  textAlign: TextAlign.center),
            ),
        ],
      ),
    );
  }
}
