// SPDX-License-Identifier: MIT
//
// Today screen tests.
//
// 1. The "Recent captures" section must read the LIVE inbox (`GET /api/captures`
//    through the real CaptureReviewRepo over a faked Dio adapter), render the
//    rows, and send a tap to the capture-review surface. That is the store the
//    backend actually serves.
// 2. The mirrored "Recently saved" section is kept alongside it — that is the
//    operator's note library, and it renders its rows when the mirror has rows.
//    What it must NOT do while empty is imply the notes went missing, so the
//    empty state explains the sync dependency and points at the captures above,
//    which are unaffected.
//
// `notesListProvider` is overridden rather than backed by sqflite: it is the
// mirror read, and the mirror is not what these tests are about (no sqflite in
// the Flutter test environment).

import "dart:convert";
import "dart:typed_data";

import "package:dio/dio.dart";
import "package:flutter/material.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";
import "package:flutter_test/flutter_test.dart";
import "package:go_router/go_router.dart";
import "package:nexalog_mobile/src/core/api/api_client.dart";
import "package:nexalog_mobile/src/core/auth/auth_store.dart";
import "package:nexalog_mobile/src/features/captures/capture_review_repo.dart";
import "package:nexalog_mobile/src/features/notes/notes_providers.dart";
import "package:nexalog_mobile/src/features/today/today_screen.dart";

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

CaptureReviewRepo _reviewRepo(_FakeAdapter adapter) {
  final ApiClient api = ApiClient(
    _FakeAuthStore("tok-123"),
    dio: Dio(BaseOptions(baseUrl: "https://nexalog.com"))
      ..httpClientAdapter = adapter,
  );
  return CaptureReviewRepo(api);
}

Map<String, Object?> _page(List<Map<String, Object?>> captures) =>
    <String, Object?>{
      "captures": captures,
      "counts": <String, Object?>{"review": captures.length},
    };

Map<String, Object?> _capture(String id, String title, String status) =>
    <String, Object?>{
      "id": id,
      "title": title,
      "status": status,
      "kind": "note",
      "source": "web",
      "capturedAt": "2026-09-25T18:03:05.000Z",
      "hasAttachments": false,
    };

/// Pumps TodayScreen with the live captures route faked and the mirror read
/// overridden to [mirrorNotes]. [router], when given, makes navigation
/// observable.
Future<void> _pump(
  WidgetTester tester, {
  required _FakeAdapter adapter,
  List<Note> mirrorNotes = const <Note>[],
  GoRouter? router,
}) async {
  await tester.pumpWidget(ProviderScope(
    overrides: <Override>[
      captureReviewRepoProvider.overrideWithValue(_reviewRepo(adapter)),
      // Replaces the create function wholesale, so the mirror read (and the
      // appDbProvider it needs) is never touched in the test environment.
      notesListProvider.overrideWith((ref) async => mirrorNotes),
    ],
    child: MaterialApp.router(
      routerConfig: router ??
          GoRouter(
            initialLocation: "/app/today",
            routes: <RouteBase>[
              GoRoute(
                path: "/app/today",
                // TodayScreen is a bare ListView in the app — Material comes
                // from the AppShell's Scaffold, so the harness supplies one.
                builder: (_, __) => const Scaffold(body: TodayScreen()),
              ),
            ],
          ),
    ),
  ));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets("renders recent captures from the live inbox and links to review",
      (WidgetTester tester) async {
    final _FakeAdapter adapter = _FakeAdapter(<Object>[
      _Reply(200, _page(<Map<String, Object?>>[
        _capture("01AAA", "shipping plan", "review"),
        _capture("01BBB", "pricing note", "processed"),
      ])),
    ]);

    final GoRouter router = GoRouter(
      initialLocation: "/app/today",
      routes: <RouteBase>[
        GoRoute(
          path: "/app/today",
          builder: (_, __) => const Scaffold(body: TodayScreen()),
        ),
        GoRoute(
          path: "/app/captures/review",
          builder: (_, __) => const Scaffold(body: Text("REVIEW SURFACE STUB")),
        ),
      ],
    );

    await _pump(tester, adapter: adapter, router: router);

    // The list actually hit the live captures route.
    expect(
      adapter.requests.any((RequestOptions r) => r.path == "/api/captures"),
      isTrue,
    );
    expect(find.text("Recent captures"), findsOneWidget);
    expect(find.text("shipping plan"), findsOneWidget);
    expect(find.text("pricing note"), findsOneWidget);
    // Status is shown on the row.
    expect(find.textContaining("review"), findsWidgets);

    // Tapping a recent capture navigates to the capture-review surface.
    await tester.tap(find.byKey(const Key("recent-capture-01AAA")));
    await tester.pumpAndSettle();
    expect(find.text("REVIEW SURFACE STUB"), findsOneWidget);
  });

  testWidgets("an empty inbox says so instead of showing a blank section",
      (WidgetTester tester) async {
    final _FakeAdapter adapter = _FakeAdapter(<Object>[
      _Reply(200, _page(const <Map<String, Object?>>[])),
    ]);

    await _pump(tester, adapter: adapter);

    expect(find.text("Recent captures"), findsOneWidget);
    expect(find.text("Nothing captured yet."), findsOneWidget);
  });

  testWidgets("the mirrored notes section survives, and an empty mirror explains itself",
      (WidgetTester tester) async {
    final _FakeAdapter adapter = _FakeAdapter(<Object>[
      _Reply(200, _page(<Map<String, Object?>>[
        _capture("01AAA", "shipping plan", "review"),
      ])),
    ]);

    await _pump(tester, adapter: adapter);

    // Kept, not removed — a repoint of the v1 store revives it with no change.
    expect(find.text("Recently saved"), findsOneWidget);
    expect(find.byKey(const Key("recently-saved-empty")), findsOneWidget);
    // The empty state must not read as "your notes are gone": it names the sync
    // dependency and points at the captures, which are unaffected.
    expect(find.textContaining("No notes mirrored to this device yet"),
        findsOneWidget);
    expect(find.textContaining("Your captures above are unaffected"),
        findsOneWidget);
    // No raw exception text reaches the operator.
    expect(find.textContaining("Error:"), findsNothing);
  });

  testWidgets("mirrored notes render their rows when the mirror does have rows",
      (WidgetTester tester) async {
    final _FakeAdapter adapter = _FakeAdapter(<Object>[
      _Reply(200, _page(const <Map<String, Object?>>[])),
    ]);

    await _pump(
      tester,
      adapter: adapter,
      mirrorNotes: <Note>[
        Note(<String, Object?>{
          "id": "n1",
          "title": "standing agenda",
          "content": "weekly",
          "kind": "note",
        }),
      ],
    );

    expect(find.text("Recently saved"), findsOneWidget);
    expect(find.text("standing agenda"), findsOneWidget);
    expect(find.byKey(const Key("recently-saved-empty")), findsNothing);
  });

  testWidgets("a failed captures read reports honestly and never claims success",
      (WidgetTester tester) async {
    final _FakeAdapter adapter = _FakeAdapter(<Object>[
      const _Reply(503, <String, Object?>{
        "error": "surface_unavailable",
        "message": "unavailable on this deployment",
      }),
    ]);

    await _pump(tester, adapter: adapter);

    expect(find.text("Recent captures"), findsOneWidget);
    expect(find.byKey(const Key("recent-captures-error")), findsOneWidget);
    expect(find.text("Could not load recent captures."), findsOneWidget);
    // The server's own reason is not leaked as a raw exception dump.
    expect(find.textContaining("DioException"), findsNothing);
  });
}
