import "package:flutter/material.dart";
import "package:speech_to_text/speech_recognition_result.dart";
import "package:speech_to_text/speech_to_text.dart";

/// On-device speech-to-text dictation (web parity §21 voice memo). A reusable
/// mic button that streams the recognized transcript into [controller]; works
/// fully offline once the device's recognizer is installed (no /api/voice
/// round-trip, unlike the web SpeechRecognition path).
class MicButton extends StatefulWidget {
  const MicButton({
    super.key,
    required this.controller,
    this.onFinal,
    this.tooltip = "Dictate",
  });

  final TextEditingController controller;

  /// Called with the full text once a listening session ends (for autosave).
  final void Function(String text)? onFinal;
  final String tooltip;

  @override
  State<MicButton> createState() => _MicButtonState();
}

class _MicButtonState extends State<MicButton> {
  final SpeechToText _stt = SpeechToText();
  bool _available = false;
  bool _listening = false;
  String _base = "";

  Future<void> _toggle() async {
    if (_listening) {
      await _stt.stop();
      if (mounted) setState(() => _listening = false);
      widget.onFinal?.call(widget.controller.text);
      return;
    }
    if (!_available) {
      _available = await _stt.initialize(
        onStatus: (String s) {
          if ((s == "done" || s == "notListening") && mounted && _listening) {
            setState(() => _listening = false);
            widget.onFinal?.call(widget.controller.text);
          }
        },
        onError: (dynamic _) {
          if (mounted) setState(() => _listening = false);
        },
      );
    }
    if (!_available) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text("Speech recognition unavailable on this device.")));
      }
      return;
    }
    _base = widget.controller.text.trim();
    setState(() => _listening = true);
    await _stt.listen(
      listenOptions: SpeechListenOptions(partialResults: true),
      onResult: (SpeechRecognitionResult r) {
        final String words = r.recognizedWords.trim();
        if (words.isEmpty) return;
        final String merged = _base.isEmpty ? words : "$_base $words";
        widget.controller.value = TextEditingValue(
          text: merged,
          selection: TextSelection.collapsed(offset: merged.length),
        );
      },
    );
  }

  @override
  void dispose() {
    if (_listening) _stt.stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return IconButton(
      tooltip: _listening ? "Stop dictation" : widget.tooltip,
      icon: Icon(
        _listening ? Icons.mic : Icons.mic_none,
        color: _listening ? Colors.red : null,
      ),
      onPressed: _toggle,
    );
  }
}
