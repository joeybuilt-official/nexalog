// SPDX-License-Identifier: MIT
//
// Capture intake repository — the mobile side of `POST /api/capture`, the v2
// intake route (brain-repo backed). Captures are written straight through it
// rather than enqueued into the `/api/sync` mutation queue: a queued write is
// only as good as the queue's drain, and a UI that reports success before the
// server has confirmed the row is indistinguishable from data loss.
//
// The handler does `await req.formData()`, so every field — including
// attachments — travels as multipart form data. A JSON body is a guaranteed
// 400. Field contract (apps/web/app/api/capture/route.ts):
//   text   — free text (OR)
//   url    — a shared/pasted URL
//   file*  — attachments; the handler keeps every entry whose key STARTS WITH
//            `file` (audio is normalized server-side, 25 MB cap)
//   source — pwa-share | web | bookmarklet | mcp (anything else defaults to
//            `web`; the app sends `web` explicitly)
//
// The route handler runs no getAuthUser of its own, but the edge middleware
// still requires the durable bearer — attached automatically by [ApiClient],
// exactly as CaptureReviewRepo relies on.
//
// Failure mapping is deliberate (same pattern as CaptureDecisionError): the
// route answers 201 `{ok:true, captureId}` on success and 400 `{ok:false,
// error}` on every client-visible failure — there is no 409/500 branch on this
// route — so the typed error carries the server's `error` text verbatim and a
// local transport failure maps to its own code. The UI must show success ONLY
// on a real 201; nothing is ever queued locally and claimed as captured.

import "package:dio/dio.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";

import "../providers.dart";
import "api_client.dart";

/// One attachment for a capture: the local file path plus the multipart
/// filename and content type the server should see.
class CaptureFile {
  const CaptureFile({
    required this.path,
    required this.filename,
    required this.contentType,
  });

  final String path;
  final String filename;

  /// MIME type as `type/subtype` (e.g. `audio/mp4`). The server derives the
  /// capture kind from it, so an empty value degrades the intake to `note`.
  final String contentType;
}

class CaptureRepo {
  CaptureRepo(this._api);

  final ApiClient _api;

  /// POST one capture to the live intake route. Exactly one of [text] / [url]
  /// carries the payload (the screens auto-detect which); [files] adds
  /// attachments (voice memo). Returns the server-minted capture id (a ULID)
  /// on 201, and throws [CaptureError] on anything else.
  Future<String> post({
    String? text,
    String? url,
    List<CaptureFile> files = const <CaptureFile>[],
  }) async {
    final String? trimmedText = text?.trim();
    final String? trimmedUrl = url?.trim();
    if ((trimmedText == null || trimmedText.isEmpty) &&
        (trimmedUrl == null || trimmedUrl.isEmpty) &&
        files.isEmpty) {
      throw const CaptureError(code: "empty");
    }
    try {
      final Response<dynamic> res = await _api.post<dynamic>(
        "/api/capture",
        data: await _form(text: trimmedText, url: trimmedUrl, files: files),
      );
      return _parseCreated(res);
    } on DioException catch (e) {
      throw _mapDioException(e);
    }
  }

  Future<FormData> _form({
    String? text,
    String? url,
    required List<CaptureFile> files,
  }) async {
    final Map<String, Object?> fields = <String, Object?>{"source": "web"};
    if (text != null && text.isNotEmpty) fields["text"] = text;
    if (url != null && url.isNotEmpty) fields["url"] = url;
    for (int i = 0; i < files.length; i++) {
      final CaptureFile f = files[i];
      final List<String> parts = f.contentType.split("/");
      // The handler keeps every entry whose key STARTS WITH `file`, so a second
      // attachment travels as `file1`, `file2`, … rather than clobbering the
      // first.
      fields[i == 0 ? "file" : "file$i"] = await MultipartFile.fromFile(
        f.path,
        filename: f.filename,
        contentType:
            parts.length == 2 ? DioMediaType(parts[0], parts[1]) : null,
      );
    }
    return FormData.fromMap(fields);
  }

  String _parseCreated(Response<dynamic> res) {
    final Object? data = res.data;
    final Map<String, Object?> body =
        data is Map ? Map<String, Object?>.from(data) : <String, Object?>{};
    final String captureId = body["captureId"]?.toString() ?? "";
    if (res.statusCode == 201 && body["ok"] == true && captureId.isNotEmpty) {
      return captureId;
    }
    // Anything that is not a well-formed 201 is a failure — never report
    // success on an ambiguous response.
    throw CaptureError(
      code: "unexpected",
      status: res.statusCode,
      serverError: body["error"]?.toString(),
    );
  }

  CaptureError _mapDioException(DioException e) {
    final Response<dynamic>? response = e.response;
    // No response at all: the request never landed (offline, DNS, timeout).
    if (response == null) return const CaptureError(code: "network");

    final Object? data = response.data;
    final Map<String, Object?> body =
        data is Map ? Map<String, Object?>.from(data) : <String, Object?>{};
    final int? status = response.statusCode;
    // The route's only failure branch: 400 {ok:false, error:"<message>"}.
    if (status != null && status >= 400 && status < 500) {
      return CaptureError(
        code: "invalid_request",
        status: status,
        serverError: body["error"]?.toString(),
      );
    }
    return CaptureError(
      code: "unexpected",
      status: status,
      serverError: body["error"]?.toString(),
    );
  }
}

/// A failed capture, typed by code — the UI branches on the code and shows
/// [message] (which carries the server's own text when it sent one).
class CaptureError implements Exception {
  const CaptureError({required this.code, this.status, this.serverError});

  /// `invalid_request` (the server refused, 4xx), `network` (the request never
  /// reached the server), `unexpected` (a response shape this client cannot
  /// honor), `empty` (local guard: nothing to send).
  final String code;
  final int? status;

  /// The server's `error` string from the JSON body, when present.
  final String? serverError;

  bool get isNetwork => code == "network";

  /// Operator-facing sentence. Never claims the capture landed.
  String get message {
    switch (code) {
      case "network":
        return "Could not reach the server. The capture was NOT saved.";
      case "invalid_request":
        return serverError == null || serverError!.trim().isEmpty
            ? "The server rejected this capture."
            : "Capture rejected: ${serverError!.trim()}";
      default:
        return "The capture could not be saved. Try again.";
    }
  }
}

final captureRepoProvider = Provider<CaptureRepo>(
  (Ref ref) => CaptureRepo(ref.watch(apiClientProvider)),
);
