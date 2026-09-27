import "package:flutter/material.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";

import "../../core/api/capture_repo.dart";
import "../../core/voice/voice_dictation.dart";

/// Global quick-capture (web parity §3 ⌘⇧C modal). Available from any screen via
/// the app-bar "+"; auto-detects url vs text and POSTs straight to the v2 intake
/// route (multipart /api/capture). No workspace gate (the intake route needs
/// none) and no offline queue: this used to enqueue into the `/api/sync`
/// mutations path, where a success toast over a write that had not reached the
/// server was silent data loss. The sheet closes ONLY on a real 201; a failure
/// keeps the text and shows the server's reason.
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
  bool _saving = false;

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
    if (text.isEmpty || _saving) return;
    setState(() => _saving = true);
    try {
      await ref.read(captureRepoProvider).post(
            text: _detected == "url" ? null : text,
            url: _detected == "url" ? text : null,
          );
      if (!mounted) return;
      Navigator.of(context).pop();
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Captured to Inbox")));
    } on CaptureError catch (e) {
      if (!mounted) return;
      // Honest failure: nothing was saved, so keep the sheet and the text.
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _saving = false);
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
          onPressed: _saving ? null : _save,
          icon: _saving
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.save),
          label: Text(_saving ? "Saving…" : "Capture"),
        ),
        const SizedBox(height: 12),
      ],
    );
  }
}
