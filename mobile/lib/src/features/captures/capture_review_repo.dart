// SPDX-License-Identifier: MIT
//
// Capture review repository — the mobile side of the capture inbox that
// `/inbox` serves on web.
//
// Two calls, both against routes that already exist server-side:
//   GET  /api/captures            → the captures, with per-status counts
//   POST /api/captures/{id}/review → { accept: boolean } (the operator decision)
//
// Bearer auth is attached by [ApiClient] automatically, and the web
// `getAuthUser()` accepts a bearer token (ADR-0002), so no extra wiring here.
//
// Failure mapping is deliberate: the server answers with a STABLE code, and
// this repo turns it into a typed [CaptureDecisionError] so the UI never has to
// read a message string to know what happened. A 409 means the row moved under
// the operator and carries `from` — the screen can then say which status it
// actually holds instead of showing a generic failure.

import "package:dio/dio.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";

import "../../core/api/api_client.dart";
import "../../core/providers.dart";
import "capture_review_models.dart";

class CaptureReviewRepo {
  CaptureReviewRepo(this._api);

  final ApiClient _api;

  /// The list the operator triages. [status] filters server-side; omit it for
  /// everything. [limit] caps the returned page (counts always cover the whole
  /// inbox).
  Future<CaptureInboxPage> list({
    String? status,
    int? limit,
  }) async {
    final Map<String, Object?> query = <String, Object?>{};
    if (status != null) query["status"] = status;
    if (limit != null) query["limit"] = limit;
    final Response<dynamic> res = await _api.get<dynamic>(
      "/api/captures",
      query: query.isEmpty ? null : query,
    );
    if (res.data is! Map) {
      throw const CaptureDecisionError(code: "unexpected");
    }
    return CaptureInboxPage.fromJson(
      Map<String, Object?>.from(res.data as Map),
    );
  }

  /// Apply the operator's decision. Returns the status the capture now carries
  /// (`processed` on accept, `rejected` on reject).
  Future<CaptureDecision> decide({
    required String captureId,
    required bool accept,
  }) async {
    try {
      final Response<dynamic> res = await _api.post<dynamic>(
        "/api/captures/${Uri.encodeComponent(captureId)}/review",
        data: <String, Object?>{'accept': accept},
      );
      final Object? data = res.data;
      final Map<String, Object?> body =
          data is Map ? Map<String, Object?>.from(data) : <String, Object?>{};
      return CaptureDecision(
        captureId: body['captureId']?.toString() ?? captureId,
        status: body['status']?.toString() ?? (accept ? "processed" : "rejected"),
      );
    } on DioException catch (e) {
      throw _mapDioException(e);
    }
  }

  CaptureDecisionError _mapDioException(DioException e) {
    final Response<dynamic>? response = e.response;
    // No response at all: the request never landed (offline, DNS, timeout).
    if (response == null) return const CaptureDecisionError(code: "network");

    final Object? data = response.data;
    final Map<String, Object?> body =
        data is Map ? Map<String, Object?>.from(data) : <String, Object?>{};

    final String code = body['error']?.toString() ?? "unexpected";
    return CaptureDecisionError(
      code: code,
      status: response.statusCode,
      from: body['from']?.toString(),
      to: body['to']?.toString(),
    );
  }
}

final captureReviewRepoProvider = Provider<CaptureReviewRepo>(
  (Ref ref) => CaptureReviewRepo(ref.watch(apiClientProvider)),
);

/// Captures awaiting an operator decision (`status: review`), newest first.
///
/// Watches [mirrorRevisionProvider] so a successful decision refreshes the
/// list — the same bump the offline mirror providers use.
final reviewCapturesProvider = FutureProvider<CaptureInboxPage>((Ref ref) async {
  ref.watch(mirrorRevisionProvider);
  return ref.watch(captureReviewRepoProvider).list(status: "review");
});
