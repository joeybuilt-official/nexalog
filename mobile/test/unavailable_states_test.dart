// SPDX-License-Identifier: MIT
//
// Honest-unavailable-state tests for the three screens that can be served a
// failure by their backend surface: Reader, Spaced review, Search.
//
// The guarantee under test is narrow and load-bearing: a server-side failure
// must render an explanation derived from the SERVER'S OWN RESPONSE, and must
// never (a) leak a raw exception dump (`Error: …`, `DioException`, a status
// line as the whole message), (b) crash, or (c) pass itself off as an empty
// result set — an empty list reads as "nothing matched" when nothing was
// searched, and for the review queue as "all caught up" when the queue could not
// be loaded at all.
//
// Both server failure shapes the web app can produce are exercised: the explicit
// degradation `503 {error:"surface_unavailable"}`
// (apps/web/lib/db/surface-unavailable.ts, returned when a route's tables are
// not present in the configured database) and an unhandled `500`. These tests
// assert client behaviour under those responses; they make no claim about what
// any particular deployment currently returns.

import "dart:convert";
import "dart:typed_data";

import "package:dio/dio.dart";
import "package:flutter/material.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";
import "package:flutter_test/flutter_test.dart";
import "package:nexalog_mobile/src/core/api/api_client.dart";
import "package:nexalog_mobile/src/core/api/surface_state.dart";
import "package:nexalog_mobile/src/core/auth/auth_store.dart";
import "package:nexalog_mobile/src/core/providers.dart";
import "package:nexalog_mobile/src/features/bookmarks/reader_screen.dart";
import "package:nexalog_mobile/src/features/review/review_providers.dart";
import "package:nexalog_mobile/src/features/review/review_screen.dart";
import "package:nexalog_mobile/src/features/search/search_screen.dart";

class _FakeAuthStore extends AuthStore {
  _FakeAuthStore(this.token);
  final String? token;
  @override
  Future<String?> readToken() async => token;
}

class _Reply {
  const _Reply(this.status, this.body);
  final int status;
  final Object body;
}

class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this.script);
  final List<Object> script;
  final List<RequestOptions> requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    if (script.isEmpty) throw StateError("FakeAdapter ran out of replies");
    final _Reply reply = script.removeAt(0) as _Reply;
    return ResponseBody.fromString(
      jsonEncode(reply.body),
      reply.status,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>[Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

ApiClient _api(_FakeAdapter adapter) => ApiClient(
      _FakeAuthStore("tok-123"),
      dio: Dio(BaseOptions(baseUrl: "https://nexalog.com"))
        ..httpClientAdapter = adapter,
    );

/// The server's explicit missing-relation degradation, verbatim shape.
const Map<String, Object?> kSurfaceUnavailable = <String, Object?>{
  "error": "surface_unavailable",
  "code": "missing_relation",
  "surface": "GET /api/review",
  "message":
      "This surface is unavailable on this deployment: its database tables are not present. "
          "Nothing was returned to the caller. This is a server-side configuration problem, not a "
          "problem with the request — retry later.",
};

const Map<String, Object?> kServerError = <String, Object?>{
  "error": "internal_error",
  "message": "unexpected failure",
};

/// Assertions that hold for every unavailable panel, whatever the surface.
void _expectHonestPanel(WidgetTester tester) {
  expect(find.byKey(const Key("surface-unavailable-headline")), findsOneWidget);
  expect(find.byKey(const Key("surface-unavailable-detail")), findsOneWidget);
  // Never a raw exception dump.
  expect(find.textContaining("Error:"), findsNothing);
  expect(find.textContaining("DioException"), findsNothing);
  expect(find.textContaining("Bad state"), findsNothing);
  // Never a fake empty/happy state.
  expect(find.text("No matches"), findsNothing);
  expect(find.text("All caught up!"), findsNothing);
  expect(find.text("Nothing awaiting a decision"), findsNothing);
  // No red error widget / crash.
  expect(tester.takeException(), isNull);
}

void main() {
  group("SurfaceError classification", () {
    test("a 503 surface_unavailable is unavailable, not offline", () {
      final SurfaceError e = SurfaceError.fromDio(
        DioException(
          requestOptions: RequestOptions(path: "/api/review"),
          response: Response<dynamic>(
            requestOptions: RequestOptions(path: "/api/review"),
            statusCode: 503,
            data: Map<String, Object?>.from(kSurfaceUnavailable),
          ),
        ),
        surface: "Spaced review",
      );
      expect(e.failure, SurfaceFailure.unavailable);
      expect(e.isOffline, isFalse);
      expect(e.serverError, "surface_unavailable");
      // The copy comes from the server, so it stays true under a repoint.
      expect(e.detail, contains("database tables are not present"));
      expect(e.headline, "Spaced review is not available in v2 yet.");
    });

    test("a 404 (route absent from the deployed manifest) is unavailable", () {
      final SurfaceError e = SurfaceError.fromDio(
        DioException(
          requestOptions: RequestOptions(path: "/api/query-views"),
          response: Response<dynamic>(
            requestOptions: RequestOptions(path: "/api/query-views"),
            statusCode: 404,
            data: <String, Object?>{},
          ),
        ),
        surface: "Saved views",
      );
      expect(e.failure, SurfaceFailure.unavailable);
      expect(e.status, 404);
      expect(e.detail, isNotEmpty);
    });

    test("a 500 is unavailable too — a fault is not an empty answer", () {
      final SurfaceError e = SurfaceError.fromDio(
        DioException(
          requestOptions: RequestOptions(path: "/api/search"),
          response: Response<dynamic>(
            requestOptions: RequestOptions(path: "/api/search"),
            statusCode: 500,
            data: Map<String, Object?>.from(kServerError),
          ),
        ),
        surface: "Search",
      );
      expect(e.failure, SurfaceFailure.unavailable);
      expect(e.status, 500);
    });

    test("a request that never landed is offline — the ONLY mirror-fallback case",
        () {
      final SurfaceError e = SurfaceError.fromDio(
        DioException(
          requestOptions: RequestOptions(path: "/api/search"),
          type: DioExceptionType.connectionError,
        ),
        surface: "Search",
      );
      expect(e.failure, SurfaceFailure.offline);
      expect(e.isOffline, isTrue);
    });

    test("a 400 is a refusal of THIS request, not an outage", () {
      final SurfaceError e = SurfaceError.fromDio(
        DioException(
          requestOptions: RequestOptions(path: "/api/review"),
          response: Response<dynamic>(
            requestOptions: RequestOptions(path: "/api/review"),
            statusCode: 400,
            data: <String, Object?>{"error": "invalid_body"},
          ),
        ),
        surface: "Spaced review",
      );
      expect(e.failure, SurfaceFailure.rejected);
      expect(e.detail, contains("invalid_body"));
    });
  });

  group("ReaderScreen", () {
    Future<void> pump(WidgetTester tester, Object reply) async {
      final _FakeAdapter adapter = _FakeAdapter(<Object>[reply]);
      await tester.pumpWidget(ProviderScope(
        overrides: <Override>[apiClientProvider.overrideWithValue(_api(adapter))],
        child: const MaterialApp(
          home: ReaderScreen(captureId: "01M38ZNA67JAGSYCGSJDYDM3DD"),
        ),
      ));
      await tester.pumpAndSettle();
    }

    testWidgets("503 surface_unavailable renders an honest panel",
        (WidgetTester tester) async {
      await pump(tester, const _Reply(503, kSurfaceUnavailable));
      expect(find.text("Reader is not available in v2 yet."), findsOneWidget);
      // The server's own explanation is shown, not an invented one.
      expect(find.textContaining("database tables are not present"),
          findsOneWidget);
      expect(find.text("server status 503"), findsOneWidget);
      _expectHonestPanel(tester);
    });

    testWidgets("a 500 renders the panel, not a raw dump",
        (WidgetTester tester) async {
      await pump(tester, const _Reply(500, kServerError));
      expect(find.text("Reader is not available in v2 yet."), findsOneWidget);
      expect(find.text("server status 500"), findsOneWidget);
      _expectHonestPanel(tester);
    });
  });

  group("ReviewScreen", () {
    Future<void> pump(WidgetTester tester, Object reply) async {
      final _FakeAdapter adapter = _FakeAdapter(<Object>[reply]);
      final ApiClient api = _api(adapter);
      await tester.pumpWidget(ProviderScope(
        overrides: <Override>[
          reviewRepoProvider.overrideWithValue(ReviewRepo(api)),
        ],
        child: const MaterialApp(home: ReviewScreen()),
      ));
      await tester.pumpAndSettle();
    }

    testWidgets("503 surface_unavailable is NOT reported as 'All caught up!'",
        (WidgetTester tester) async {
      await pump(tester, const _Reply(503, kSurfaceUnavailable));
      expect(
          find.text("Spaced review is not available in v2 yet."), findsOneWidget);
      expect(find.textContaining("database tables are not present"),
          findsOneWidget);
      _expectHonestPanel(tester);
    });

    testWidgets("a 500 renders the panel and offers a retry",
        (WidgetTester tester) async {
      await pump(tester, const _Reply(500, kServerError));
      expect(
          find.text("Spaced review is not available in v2 yet."), findsOneWidget);
      expect(find.text("Try again"), findsOneWidget);
      _expectHonestPanel(tester);
    });
  });

  group("SearchScreen", () {
    Future<void> pump(WidgetTester tester, Object reply) async {
      final _FakeAdapter adapter = _FakeAdapter(<Object>[reply]);
      await tester.pumpWidget(ProviderScope(
        overrides: <Override>[apiClientProvider.overrideWithValue(_api(adapter))],
        // SearchScreen is a bare Column in the app — Material comes from the
        // AppShell's Scaffold, so the harness supplies one.
        child: const MaterialApp(home: Scaffold(body: SearchScreen())),
      ));
      await tester.pumpAndSettle();
    }

    testWidgets("503 surface_unavailable never renders as zero results",
        (WidgetTester tester) async {
      await pump(tester, const _Reply(503, kSurfaceUnavailable));
      expect(find.text("Search is not available in v2 yet."), findsOneWidget);
      expect(find.textContaining("database tables are not present"),
          findsOneWidget);
      _expectHonestPanel(tester);
    });

    testWidgets("a 500 renders the panel, not an empty result list",
        (WidgetTester tester) async {
      await pump(tester, const _Reply(500, kServerError));
      expect(find.text("Search is not available in v2 yet."), findsOneWidget);
      expect(find.text("server status 500"), findsOneWidget);
      _expectHonestPanel(tester);
    });

    testWidgets("a live search still renders its results",
        (WidgetTester tester) async {
      await pump(
        tester,
        const _Reply(200, <String, Object?>{
          "results": <Object?>[
            <String, Object?>{
              "id": "r1",
              "kind": "article",
              "title": "pricing strategy",
              "url": "https://example.com/pricing",
            },
          ],
          "facets": <String, Object?>{
            "totalsByKind": <String, Object?>{"article": 1},
          },
        }),
      );
      expect(find.text("pricing strategy"), findsOneWidget);
      expect(find.byKey(const Key("surface-unavailable-headline")), findsNothing);
      expect(tester.takeException(), isNull);
    });
  });
}
