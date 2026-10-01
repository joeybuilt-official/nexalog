// SPDX-License-Identifier: MIT
//
// One honest answer to "why did this surface not give me data?"
//
// Several screens call routes whose backing store may not exist on a given
// deployment. The server is explicit about that case: the missing-relation
// degradation returns `503 {error:"surface_unavailable", message:"…"}`
// (`apps/web/lib/db/surface-unavailable.ts`), and it deliberately does NOT
// return an empty 200 — a 200 would tell a client "nothing has changed" and be
// indistinguishable from having no data. A route absent from the deployed
// manifest answers 404. An unhandled server fault answers 500.
//
// The old mobile behaviour collapsed all of these into `Text("Error: $e")` (a
// raw DioException dump) or, worse, into a silent zero-result list. Both are
// wrong: the first leaks internals, the second lets the operator conclude their
// content is gone. This module classifies the failure once and derives the copy
// FROM THE SERVER'S RESPONSE, so the wording stays honest if a surface is
// repointed and comes back — a revived route simply stops producing these
// states and the screen renders data again with no client change.

import "package:dio/dio.dart";
import "package:flutter/material.dart";

/// Why a surface produced no data.
enum SurfaceFailure {
  /// The request never reached the server (offline, DNS, timeout, TLS). This is
  /// a device/connectivity condition, NOT a server statement — callers with a
  /// local mirror should use the mirror here rather than show a panel.
  offline,

  /// The server said the surface is unavailable on this deployment
  /// (`surface_unavailable`, or a 5xx / 404 that means the same thing here).
  /// Nothing was returned; the operator's data is not implied to be missing.
  unavailable,

  /// The server refused THIS request (4xx other than 404): bad id, bad query,
  /// expired session. Retrying the same call will fail the same way.
  rejected,

  /// A response shape this client cannot honor (unexpected body, unknown
  /// status).
  unexpected,
}

/// A classified failure, carrying whatever the server chose to say.
class SurfaceError implements Exception {
  const SurfaceError({
    required this.failure,
    required this.surface,
    this.status,
    this.serverError,
    this.serverMessage,
  });

  final SurfaceFailure failure;

  /// Human name of the surface, used in the panel title ("Reader", "Search").
  final String surface;

  final int? status;

  /// The server's stable `error` code, when it sent one
  /// (e.g. `surface_unavailable`).
  final String? serverError;

  /// The server's own sentence, when it sent one. Shown verbatim: it is written
  /// for the operator and it is the only text that stays true when the
  /// deployment changes.
  final String? serverMessage;

  bool get isOffline => failure == SurfaceFailure.offline;
  bool get isUnavailable => failure == SurfaceFailure.unavailable;

  /// Operator-facing headline. Derived from the classification, never from an
  /// exception's toString().
  String get headline {
    switch (failure) {
      case SurfaceFailure.offline:
        return "You appear to be offline.";
      case SurfaceFailure.unavailable:
        return "$surface is not available in v2 yet.";
      case SurfaceFailure.rejected:
        return "$surface could not handle this request.";
      case SurfaceFailure.unexpected:
        return "$surface returned something this app cannot read.";
    }
  }

  /// Supporting sentence. Prefers the server's own wording when present, so the
  /// copy self-corrects if the deployment's explanation changes.
  String get detail {
    final String? server = serverMessage?.trim();
    if (server != null && server.isNotEmpty) return server;
    switch (failure) {
      case SurfaceFailure.offline:
        return "Nothing was requested from the server.";
      case SurfaceFailure.unavailable:
        return "This surface has no data behind it on this deployment. Nothing "
            "was returned — your captures and notes elsewhere are unaffected. "
            "Retry later; if the server is repointed this screen starts working "
            "on its own.";
      case SurfaceFailure.rejected:
        return serverError == null || serverError!.trim().isEmpty
            ? "The server refused the request."
            : "The server said: ${serverError!.trim()}";
      case SurfaceFailure.unexpected:
        return "Try again, and if it persists the client needs an update.";
    }
  }

  /// Classify a Dio failure. [surface] names the feature for the copy.
  static SurfaceError fromDio(DioException e, {required String surface}) {
    final Response<dynamic>? response = e.response;
    // No response at all: the request never landed. That is a connectivity
    // fact, not a server statement — and the only case where a local mirror is
    // a legitimate fallback.
    if (response == null) {
      return SurfaceError(failure: SurfaceFailure.offline, surface: surface);
    }
    final int? status = response.statusCode;
    final Object? data = response.data;
    final Map<String, Object?> body =
        data is Map ? Map<String, Object?>.from(data) : <String, Object?>{};
    final String? code = body["error"]?.toString();
    final String? message = body["message"]?.toString();

    // The server's explicit unavailability signal — match on the stable code,
    // not on wording (clients branch on codes; `.agents/rules/api-design.md`).
    if (code == "surface_unavailable") {
      return SurfaceError(
        failure: SurfaceFailure.unavailable,
        surface: surface,
        status: status,
        serverError: code,
        serverMessage: message,
      );
    }
    if (status == null) {
      return SurfaceError(failure: SurfaceFailure.unexpected, surface: surface);
    }
    // 404: the route is not in the deployed manifest — same operator meaning as
    // unavailable (there is nothing behind this screen here), different cause.
    if (status == 404 || status >= 500) {
      return SurfaceError(
        failure: SurfaceFailure.unavailable,
        surface: surface,
        status: status,
        serverError: code,
        serverMessage: message,
      );
    }
    if (status >= 400) {
      return SurfaceError(
        failure: SurfaceFailure.rejected,
        surface: surface,
        status: status,
        serverError: code,
        serverMessage: message,
      );
    }
    return SurfaceError(
      failure: SurfaceFailure.unexpected,
      surface: surface,
      status: status,
      serverError: code,
      serverMessage: message,
    );
  }

  /// Classify any other throwable (a parse failure, a local fault).
  static SurfaceError fromObject(Object e, {required String surface}) {
    if (e is SurfaceError) return e;
    if (e is DioException) return fromDio(e, surface: surface);
    return SurfaceError(failure: SurfaceFailure.unexpected, surface: surface);
  }
}

/// The panel these screens render instead of a raw error dump or a silent empty
/// list. Retry is offered because unavailability here is a deployment property
/// that can change without an app update.
class SurfaceUnavailablePanel extends StatelessWidget {
  const SurfaceUnavailablePanel({
    required this.error,
    this.onRetry,
    super.key,
  });

  final SurfaceError error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final Color muted = Theme.of(context).colorScheme.outline;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(
              error.isOffline ? Icons.cloud_off : Icons.block,
              size: 44,
              color: muted,
            ),
            const SizedBox(height: 14),
            Text(
              error.headline,
              key: const Key("surface-unavailable-headline"),
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(
              error.detail,
              key: const Key("surface-unavailable-detail"),
              textAlign: TextAlign.center,
              style: TextStyle(color: muted, height: 1.4),
            ),
            if (error.status != null) ...<Widget>[
              const SizedBox(height: 8),
              Text(
                "server status ${error.status}",
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: muted,
                    ),
              ),
            ],
            if (onRetry != null) ...<Widget>[
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh),
                label: const Text("Try again"),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
