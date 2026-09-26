import "dart:developer";
import "dart:io";

import "package:flutter/material.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";
import "package:path/path.dart" as p;
import "package:path_provider/path_provider.dart";
import "package:record/record.dart";

import "../../core/api/api_client.dart";
import "../../core/providers.dart";
import "../../core/workspace_providers.dart";
import "../../theme/app_theme.dart";

/// Voice memo capture. Tap to start recording aac into a temp file via the
/// `record` package; tap stop and POST /api/capture {kind:"voice",
/// content:"[Voice recording]", workspaceId} — v2 deleted the /api/voice R2
/// upload route, so audio is not uploaded. On-device dictation is the richer
/// speech path.
class VoiceMemoScreen extends ConsumerStatefulWidget {
  const VoiceMemoScreen({super.key});

  @override
  ConsumerState<VoiceMemoScreen> createState() => _VoiceMemoScreenState();
}

enum _RecState { idle, recording, saving }

class _VoiceMemoScreenState extends ConsumerState<VoiceMemoScreen> {
  final AudioRecorder _recorder = AudioRecorder();
  _RecState _state = _RecState.idle;
  String? _path;
  DateTime? _startedAt;
  String? _error;

  @override
  void dispose() {
    _recorder.dispose();
    super.dispose();
  }

  Future<void> _start() async {
    log("voice-memo.start", name: "voice");
    setState(() => _error = null);
    final bool ok = await _recorder.hasPermission();
    if (!ok) {
      setState(() => _error = "Microphone permission denied.");
      return;
    }
    final Directory dir = await getTemporaryDirectory();
    final String path = p.join(
      dir.path,
      "memo-${DateTime.now().millisecondsSinceEpoch}.m4a",
    );
    await _recorder.start(
      const RecordConfig(encoder: AudioEncoder.aacLc),
      path: path,
    );
    setState(() {
      _state = _RecState.recording;
      _path = path;
      _startedAt = DateTime.now();
    });
  }

  Future<void> _stop() async {
    log("voice-memo.stop", name: "voice");
    setState(() => _state = _RecState.saving);
    final String? path = await _recorder.stop();
    if (path == null) {
      setState(() {
        _state = _RecState.idle;
        _error = "Recording failed.";
      });
      return;
    }
    final String? ws = await ref.read(activeWorkspaceIdProvider.future);
    if (ws == null) {
      setState(() {
        _state = _RecState.idle;
        _error = "Sync once online before recording.";
      });
      return;
    }
    try {
      final ApiClient api = ref.read(apiClientProvider);
      await api.post<dynamic>(
        "/api/capture",
        data: <String, Object?>{
          "kind": "voice",
          "content": "[Voice recording]",
          "workspaceId": ws,
        },
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Saved")),
      );
      setState(() {
        _state = _RecState.idle;
        _path = null;
        _startedAt = null;
      });
    } catch (e) {
      log("voice-memo.error", name: "voice", error: e);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text("Error: $e")),
      );
      setState(() {
        _state = _RecState.idle;
        _error = e.toString();
      });
    } finally {
      try {
        final File f = File(path);
        if (await f.exists()) await f.delete();
      } catch (_) {}
    }
  }

  String _elapsed() {
    if (_startedAt == null) return "00:00";
    final Duration d = DateTime.now().difference(_startedAt!);
    final String mm = d.inMinutes.remainder(60).toString().padLeft(2, "0");
    final String ss = d.inSeconds.remainder(60).toString().padLeft(2, "0");
    return "$mm:$ss";
  }

  @override
  Widget build(BuildContext context) {
    final bool busy = _state == _RecState.saving;
    final bool recording = _state == _RecState.recording;
    return Scaffold(
      appBar: AppBar(title: const Text("Voice memo")),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Icon(
                recording ? Icons.mic : Icons.mic_none,
                size: 96,
                color: recording ? kCopper : Theme.of(context).colorScheme.outline,
              ),
              const SizedBox(height: 12),
              Text(
                recording ? _elapsed() : (busy ? "Saving…" : "Tap to record"),
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 24),
              FilledButton.icon(
                onPressed: busy
                    ? null
                    : (recording ? _stop : _start),
                icon: Icon(recording ? Icons.stop : Icons.fiber_manual_record),
                label: Text(recording ? "Stop & save" : "Record"),
              ),
              if (_error != null) ...<Widget>[
                const SizedBox(height: 16),
                Text(
                  _error!,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Theme.of(context).colorScheme.error,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
