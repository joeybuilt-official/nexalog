import "package:flutter/material.dart";

/// Temporary stand-in for a web surface not yet ported to native. Tracked in
/// parity-nexalog.md; replaced screen-by-screen. Never shipped in an APK — the
/// ship gate (ADR-0006) requires full parity, no placeholders.
class PlaceholderScreen extends StatelessWidget {
  const PlaceholderScreen({required this.title, super.key});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              const Icon(Icons.construction_rounded, size: 40),
              const SizedBox(height: 12),
              Text("$title — native screen in progress",
                  textAlign: TextAlign.center),
            ],
          ),
        ),
      ),
    );
  }
}
