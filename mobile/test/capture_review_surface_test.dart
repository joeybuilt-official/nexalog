// SPDX-License-Identifier: MIT
//
// Repo + screen tests for the mobile capture review surface — the operator's
// accept/reject parity with web `/inbox`.
//
// The HTTP layer is faked at Dio's adapter, so the real `CaptureReviewRepo`
// runs: request path, query, the STRICT body the server expects (`{accept}`),
// bearer header attachment, success parsing, and the DioException → typed
// `CaptureDecisionError` mapping the UI branches on.
//
// The widget tests assert the things the UI must guarantee:
//   - a review row shows the worker's proposal (summary / page paths / links);
//   - REJECT IS TWO-STEP (house rule) — the destructive action cannot fire on a
//     single tap, and cancelling sends nothing;
//   - accept is one tap and reports the outcome;
//   - a failure is never silent: a conflict refetches so the list shows
//     reality, and a transport failure keeps the row with the reason on it.

import "dart:convert";
import "dart:typed_data";

import "package:dio/dio.dart";
import "package:flutter/material.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";
import "package:flutter_test/flutter_test.dart";
import "package:nexalog_mobile/src/core/api/api_client.dart";
import "package:nexalog_mobile/src/core/auth/auth_store.dart";
import "package:nexalog_mobile/src/features/captures/capture_review_models.dart";
import "package:nexalog_mobile/src/features/captures/capture_review_repo.dart";
import "package:nexalog_mobile/src/features/captures/capture_review_screen.dart";

/// Auth store that always hands back the same durable bearer token.
class _FakeAuthStore extends AuthStore {
  _FakeAuthStore(this.token);

  final String? token;

  @override
  Future<String?> readToken() async => token;
}

/// One canned HTTP response.
class _Reply {
  const _Reply(this.status, this.body);

  final int status;
  final Object body;
}

/// A transport failure — the request never reached the server.
class _NetworkFailure {
  const _NetworkFailure();
}

/// Records every request and replays its script in order.
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
    if (script.isEmpty) {
      throw StateError("FakeAdapter ran out of replies for ${options.method} ${options.path}");
    }
    final Object next = script.removeAt(0);
    if (next is _NetworkFailure) {
      throw DioException(
        requestOptions: options,
        type: DioExceptionType.connectionError,
        message: "connection refused",
      );
    }
    final _Reply reply = next as _Reply;
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

CaptureReviewRepo _repo(_FakeAdapter adapter, {String? token = "tok-123"}) {
  final ApiClient api = ApiClient(
    _FakeAuthStore(token),
    dio: Dio(BaseOptions(baseUrl: "https://nexalog.com"))
      ..httpClientAdapter = adapter,
  );
  return CaptureReviewRepo(api);
}

const String kCaptureId = "01M38ZNA67JAGSYCGSJDYDM3DD";

Map<String, Object?> _reviewCapture({
  String id = kCaptureId,
  String title = "voice note about pricing",
  Map<String, Object?>? proposal,
}) =>
    <String, Object?>{
      "id": id,
      "title": title,
      "status": "review",
      "kind": "audio",
      "source": "pwa-share",
      "capturedAt": "2026-09-25T18:03:05.000Z",
      "hasAttachments": true,
      "proposal": proposal,
    };

/// The `GET /api/captures` page carrying [captures].
Map<String, Object?> _page(List<Map<String, Object?>> captures) => <String, Object?>{
      "captures": captures,
      "counts": <String, Object?>{"review": captures.length},
    };

const Map<String, Object?> _acceptOk = <String, Object?>{
  "ok": true,
  "captureId": kCaptureId,
  "status": "processed",
};

void main() {
  group("CaptureReviewRepo", () {
    test("lists review captures, sending the status filter and the bearer token", () async {
      final _FakeAdapter adapter = _FakeAdapter(<Object>[
        _Reply(200, _page(<Map<String, Object?>>[_reviewCapture()])),
      ]);

      final CaptureInboxPage page = await _repo(adapter).list(status: "review");

      expect(page.captures, hasLength(1));
      expect(page.captures.single.id, kCaptureId);
      expect(page.reviewCount, 1);

      final RequestOptions req = adapter.requests.single;
      expect(req.method, "GET");
      expect(req.path, "/api/captures");
      expect(req.queryParameters, <String, Object?>{"status": "review"});
      // The durable bearer token rides along automatically; the web
      // getAuthUser() accepts it (ADR-0002), so nothing else is needed.
      expect(req.headers["authorization"], "Bearer tok-123");
    });

    test("omits the query entirely when no filter is asked for", () async {
      final _FakeAdapter adapter = _FakeAdapter(<Object>[
        _Reply(200, _page(const <Map<String, Object?>>[])),
      ]);

      await _repo(adapter).list();

      expect(adapter.requests.single.queryParameters, isEmpty);
    });

    test("accept posts {accept: true} to the capture's own review route", () async {
      final _FakeAdapter adapter = _FakeAdapter(<Object>[const _Reply(200, _acceptOk)]);

      final CaptureDecision decision = await _repo(adapter)
          .decide(captureId: kCaptureId, accept: true);

      expect(decision.status, "processed");
      expect(decision.captureId, kCaptureId);
      final RequestOptions req = adapter.requests.single;
      expect(req.method, "POST");
      expect(req.path, "/api/captures/$kCaptureId/review");
      expect(req.data, <String, Object?>{"accept": true});
    });

    test("reject posts {accept: false} and reports the rejected status", () async {
      final _FakeAdapter adapter = _FakeAdapter(<Object>[
        const _Reply(200, <String, Object?>{
          "ok": true,
          "captureId": kCaptureId,
          "status": "rejected",
        }),
      ]);

      final CaptureDecision decision = await _repo(adapter)
          .decide(captureId: kCaptureId, accept: false);

      expect(decision.status, "rejected");
      expect(adapter.requests.single.data, <String, Object?>{"accept": false});
    });

    test("a 409 maps to invalid_transition carrying the ACTUAL status", () async {
      final _FakeAdapter adapter = _FakeAdapter(<Object>[
        const _Reply(409, <String, Object?>{
          "error": "invalid_transition",
          "message": "Only a review capture can be accepted",
          "from": "processed",
          "to": "processed",
        }),
      ]);

      await expectLater(
        _repo(adapter).decide(captureId: kCaptureId, accept: true),
        throwsA(
          isA<CaptureDecisionError>()
              .having((CaptureDecisionError e) => e.code, "code", "invalid_transition")
              .having((CaptureDecisionError e) => e.status, "status", 409)
              .having((CaptureDecisionError e) => e.from, "from", "processed")
              .having((CaptureDecisionError e) => e.isConflict, "isConflict", isTrue),
        ),
      );
    });

    test("a 404 maps to its stable code", () async {
      await expectLater(
        _repo(_FakeAdapter(<Object>[
          const _Reply(404, <String, Object?>{'error': 'not_found'}),
        ])).decide(captureId: kCaptureId, accept: true),
        throwsA(isA<CaptureDecisionError>()
            .having((CaptureDecisionError e) => e.code, "code", "not_found")
            .having((CaptureDecisionError e) => e.isNotFound, "isNotFound", isTrue)),
      );
    });

    test("a transport failure maps to the network code, not a fake success", () async {
      await expectLater(
        _repo(_FakeAdapter(<Object>[const _NetworkFailure()]))
            .decide(captureId: kCaptureId, accept: false),
        throwsA(isA<CaptureDecisionError>()
            .having((CaptureDecisionError e) => e.code, "code", "network")
            .having((CaptureDecisionError e) => e.status, "status", isNull)),
      );
    });
  });

  group("CaptureReviewScreen", () {
    Future<void> pumpScreen(
      WidgetTester tester, {
      required _FakeAdapter adapter,
    }) async {
      await tester.pumpWidget(ProviderScope(
        overrides: <Override>[
          captureReviewRepoProvider.overrideWithValue(_repo(adapter)),
        ],
        child: const MaterialApp(home: CaptureReviewScreen()),
      ));
      await tester.pumpAndSettle();
    }

    testWidgets("shows the worker's proposal so the operator can judge", (WidgetTester tester) async {
      final _FakeAdapter adapter = _FakeAdapter(<Object>[
        _Reply(200, _page(<Map<String, Object?>>[
          _reviewCapture(proposal: <String, Object?>{
            "summary": "Extracted 1 person, 1 concept",
            "confidence": 0.42,
            "pages": <Object?>[
              <String, Object?>{
                "slug": "people/jane-doe",
                "dir": "people",
                "label": "Jane Doe",
                "type": "person",
                "typeLabel": "Person",
                "href": "/app/graph?slug=people%2Fjane-doe",
              },
            ],
            "links": <Object?>[
              <String, Object?>{
                "from": <String, Object?>{'slug': "people/jane-doe", 'label': "Jane Doe"},
                "to": <String, Object?>{'slug': "concepts/pricing", 'label': "Pricing"},
              },
            ],
          }),
        ])),
      ]);

      await pumpScreen(tester, adapter: adapter);

      expect(find.text("voice note about pricing"), findsOneWidget);
      expect(find.text("WORKER PROPOSAL"), findsOneWidget);
      expect(find.text("Extracted 1 person, 1 concept"), findsOneWidget);
      expect(find.text("confidence 0.42"), findsOneWidget);
      // The page appears twice: as a committed page chip, and as the link's
      // `from` endpoint.
      expect(find.text("Jane Doe"), findsNWidgets(2));
      expect(find.text("Pricing"), findsOneWidget);
      // The type label renders once per page chip (the linked `to` chip has no
      // typeLabel in this fixture).
      expect(find.text("Person"), findsOneWidget);
    });

    testWidgets("reject is TWO-STEP: the dialog gates the decision, cancel sends nothing",
        (WidgetTester tester) async {
      final _FakeAdapter adapter = _FakeAdapter(<Object>[
        _Reply(200, _page(<Map<String, Object?>>[_reviewCapture()])),
      ]);
      await pumpScreen(tester, adapter: adapter);

      await tester.tap(find.byKey(const Key("reject-button")));
      await tester.pumpAndSettle();

      // First tap only ARMS the destructive action — nothing was posted.
      expect(find.text("Reject this capture?"), findsOneWidget);
      expect(adapter.requests, hasLength(1)); // the list GET only

      await tester.tap(find.text("Cancel"));
      await tester.pumpAndSettle();

      expect(find.text("Reject this capture?"), findsNothing);
      expect(adapter.requests, hasLength(1)); // still nothing posted
      expect(find.text("voice note about pricing"), findsOneWidget);
    });

    testWidgets("confirming the dialog posts the reject", (WidgetTester tester) async {
      final _FakeAdapter adapter = _FakeAdapter(<Object>[
        _Reply(200, _page(<Map<String, Object?>>[_reviewCapture()])),
        const _Reply(200, <String, Object?>{
          "ok": true,
          "captureId": kCaptureId,
          "status": "rejected",
        }),
        // The post-decision refetch.
        _Reply(200, _page(const <Map<String, Object?>>[])),
      ]);
      await pumpScreen(tester, adapter: adapter);

      await tester.tap(find.byKey(const Key("reject-button")));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, "Reject"));
      await tester.pumpAndSettle();

      final RequestOptions post =
          adapter.requests.firstWhere((RequestOptions r) => r.method == "POST");
      expect(post.path, "/api/captures/$kCaptureId/review");
      expect(post.data, <String, Object?>{"accept": false});
      // The row leaves the pending list once resolved.
      expect(find.text("voice note about pricing"), findsNothing);
      expect(find.text("Nothing awaiting a decision"), findsOneWidget);
    });

    testWidgets("accept posts in one tap and the row resolves", (WidgetTester tester) async {
      final _FakeAdapter adapter = _FakeAdapter(<Object>[
        _Reply(200, _page(<Map<String, Object?>>[_reviewCapture()])),
        const _Reply(200, _acceptOk),
        _Reply(200, _page(const <Map<String, Object?>>[])),
      ]);
      await pumpScreen(tester, adapter: adapter);

      await tester.tap(find.byKey(const Key("accept-button")));
      await tester.pumpAndSettle();

      final RequestOptions post =
          adapter.requests.firstWhere((RequestOptions r) => r.method == "POST");
      expect(post.data, <String, Object?>{"accept": true});
      expect(find.text("voice note about pricing"), findsNothing);
    });

    testWidgets("a conflict refetches so the list shows reality, never a fake success",
        (WidgetTester tester) async {
      final _FakeAdapter adapter = _FakeAdapter(<Object>[
        _Reply(200, _page(<Map<String, Object?>>[_reviewCapture()])),
        // The row moved under the operator — another client already decided it.
        const _Reply(409, <String, Object?>{
          "error": "invalid_transition",
          "message": "Only a review capture can be accepted",
          "from": "processed",
          "to": "processed",
        }),
        // The refetch confirms it is no longer awaiting a decision.
        _Reply(200, _page(const <Map<String, Object?>>[])),
      ]);
      await pumpScreen(tester, adapter: adapter);

      await tester.tap(find.byKey(const Key("accept-button")));
      await tester.pumpAndSettle();

      expect(adapter.requests.where((RequestOptions r) => r.method == "POST"), hasLength(1));
      // Three calls: the list, the refused decision, and the honest refetch.
      expect(adapter.requests, hasLength(3));
      expect(find.text("voice note about pricing"), findsNothing);
      expect(find.text("Nothing awaiting a decision"), findsOneWidget);
    });

    testWidgets("a transport failure says so in place and the row STAYS for a retry",
        (WidgetTester tester) async {
      final _FakeAdapter adapter = _FakeAdapter(<Object>[
        _Reply(200, _page(<Map<String, Object?>>[_reviewCapture()])),
        const _NetworkFailure(),
      ]);
      await pumpScreen(tester, adapter: adapter);

      await tester.tap(find.byKey(const Key("accept-button")));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key("decision-error")), findsOneWidget);
      expect(find.text("Could not reach the server."), findsOneWidget);
      // The row is still there — the decision was NOT applied, so it stays for
      // the operator to retry rather than vanishing as if it had worked.
      expect(find.text("voice note about pricing"), findsOneWidget);
      expect(find.byKey(const Key("accept-button")), findsOneWidget);
    });

    testWidgets("an empty queue explains itself instead of showing a blank screen",
        (WidgetTester tester) async {
      final _FakeAdapter adapter = _FakeAdapter(<Object>[
        _Reply(200, _page(const <Map<String, Object?>>[])),
      ]);

      await pumpScreen(tester, adapter: adapter);

      expect(find.text("Nothing awaiting a decision"), findsOneWidget);
      expect(find.byKey(const Key("accept-button")), findsNothing);
    });
  });
}
