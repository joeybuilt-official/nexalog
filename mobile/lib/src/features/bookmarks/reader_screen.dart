import "package:dio/dio.dart";
import "package:flutter/material.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";

import "../../core/api/api_client.dart";
import "../../core/api/surface_state.dart";
import "../../core/providers.dart";

/// Reader mode (web parity §5): sanitised reader text for a capture. GET
/// /api/captures/:id/reader → {ok, state, html, text, paywalled, readMinutes}.
/// Renders text (html stripped); shows extracting/failed states. Online.
///
/// A failure here is classified ([SurfaceError]) rather than stringified: the
/// operator sees why, never a raw `Error: $e`. The classification is derived
/// from the server's own response, so nothing about what a given deployment can
/// serve is baked into this screen — reader text renders whenever the route
/// answers.
final readerProvider = FutureProvider.autoDispose
    .family<Map<String, Object?>, String>((Ref ref, String id) async {
  final ApiClient api = ref.watch(apiClientProvider);
  try {
    final Response<dynamic> res =
        await api.get<dynamic>("/api/captures/$id/reader");
    return res.data is Map
        ? Map<String, Object?>.from(res.data as Map)
        : <String, Object?>{};
  } on DioException catch (e) {
    throw SurfaceError.fromDio(e, surface: "Reader");
  }
});

String _stripHtml(String html) => html
    .replaceAll(RegExp(r"<(script|style)[^>]*>[\s\S]*?</\1>"), " ")
    .replaceAll(RegExp(r"<br\s*/?>", caseSensitive: false), "\n")
    .replaceAll(RegExp(r"</p>", caseSensitive: false), "\n\n")
    .replaceAll(RegExp(r"<[^>]+>"), " ")
    .replaceAll(RegExp(r"[ \t]+"), " ")
    .replaceAll(RegExp(r"\n{3,}"), "\n\n")
    .trim();

class ReaderScreen extends ConsumerWidget {
  const ReaderScreen({required this.captureId, super.key});

  final String captureId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<Map<String, Object?>> reader =
        ref.watch(readerProvider(captureId));
    return Scaffold(
      appBar: AppBar(title: const Text("Reader")),
      body: reader.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (Object e, _) => SurfaceUnavailablePanel(
          error: SurfaceError.fromObject(e, surface: "Reader"),
          onRetry: () => ref.invalidate(readerProvider(captureId)),
        ),
        data: (Map<String, Object?> r) {
          final String state = r["state"]?.toString() ?? "";
          final String text = r["text"]?.toString() ??
              (r["html"] is String ? _stripHtml(r["html"] as String) : "");
          if (text.trim().isEmpty) {
            final bool extracting = state == "pending" || state == "extracting";
            return Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Icon(extracting ? Icons.hourglass_empty : Icons.error_outline,
                      size: 40),
                  const SizedBox(height: 12),
                  Text(extracting
                      ? "Extracting article…"
                      : "Reader text unavailable"),
                  const SizedBox(height: 8),
                  TextButton.icon(
                    onPressed: () => ref.invalidate(readerProvider(captureId)),
                    icon: const Icon(Icons.refresh),
                    label: const Text("Retry"),
                  ),
                ],
              ),
            );
          }
          final int? mins = r["readMinutes"] is int
              ? r["readMinutes"] as int
              : int.tryParse(r["readMinutes"]?.toString() ?? "");
          return ListView(
            padding: const EdgeInsets.all(20),
            children: <Widget>[
              if (mins != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Text("$mins min read",
                      style: Theme.of(context).textTheme.labelMedium),
                ),
              if (r["paywalled"] == true)
                const Padding(
                  padding: EdgeInsets.only(bottom: 12),
                  child: Chip(label: Text("paywalled")),
                ),
              SelectableText(
                text,
                style: const TextStyle(fontSize: 17, height: 1.5),
              ),
            ],
          );
        },
      ),
    );
  }
}
