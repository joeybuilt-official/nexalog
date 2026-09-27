// SPDX-License-Identifier: MIT
//
// Repo tests for the mobile capture intake (`POST /api/capture`).
//
// The HTTP layer is faked at Dio's adapter (the pattern
// capture_review_surface_test.dart established), so the real CaptureRepo runs.
// The multipart body is read off the request STREAM, because Dio serializes
// FormData before the adapter sees it — asserting on `options.data` alone
// would prove nothing about what the server receives.
//
// Contract under test (apps/web/app/api/capture/route.ts):
//   - multipart form data, field `source: web`
//   - exactly one of `text` / `url` (never both, never neither)
//   - 201 {ok:true, captureId} → the id is returned
//   - 400 {ok:false, error} → typed CaptureError carrying the server text
//   - no response at all → the `network` code, never a fake success

import "dart:convert";
import "dart:typed_data";

import "package:dio/dio.dart";
import "package:flutter_test/flutter_test.dart";
import "package:nexalog_mobile/src/core/api/api_client.dart";
import "package:nexalog_mobile/src/core/api/capture_repo.dart";
import "package:nexalog_mobile/src/core/auth/auth_store.dart";

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

class _NetworkFailure {
  const _NetworkFailure();
}

/// Records every request — including the raw multipart body — and replays its
/// script in order.
class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this.script);

  final List<Object> script;
  final List<RequestOptions> requests = <RequestOptions>[];

  /// The decoded request body per request (parallel to [requests]).
  final List<String> bodies = <String>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    String body = "";
    if (requestStream != null) {
      final BytesBuilder builder = BytesBuilder();
      await for (final Uint8List chunk in requestStream) {
        builder.add(chunk);
      }
      body = utf8.decode(builder.takeBytes(), allowMalformed: true);
    }
    bodies.add(body);
    if (script.isEmpty) {
      throw StateError(
          "FakeAdapter ran out of replies for ${options.method} ${options.path}");
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

CaptureRepo _repo(_FakeAdapter adapter, {String? token = "tok-123"}) {
  final ApiClient api = ApiClient(
    _FakeAuthStore(token),
    dio: Dio(BaseOptions(baseUrl: "https://nexalog.com"))
      ..httpClientAdapter = adapter,
  );
  return CaptureRepo(api);
}

const String kCaptureId = "01M38ZNA67JAGSYCGSJDYDM3DD";

/// The multipart content type Dio sets on the request. Note it lands in the
/// `headers` map (dio_mixin sets `headers[contentTypeHeader]` for FormData),
/// NOT in `options.contentType` — asserting the latter proves nothing.
String? _multipartContentType(RequestOptions req) {
  for (final MapEntry<String, Object?> e in req.headers.entries) {
    if (e.key.toLowerCase() == "content-type") {
      return e.value?.toString();
    }
  }
  return req.contentType?.toString();
}

void main() {
  group("CaptureRepo", () {
    test("posts multipart to /api/capture with source=web and the bearer", () async {
      final _FakeAdapter adapter = _FakeAdapter(<Object>[
        const _Reply(201, <String, Object?>{"ok": true, "captureId": kCaptureId}),
      ]);

      final String id = await _repo(adapter).post(text: "a thought");

      expect(id, kCaptureId);
      final RequestOptions req = adapter.requests.single;
      expect(req.method, "POST");
      expect(req.path, "/api/capture");
      // Multipart, with a boundary — never JSON (the handler does formData()).
      expect(_multipartContentType(req), startsWith("multipart/form-data"));
      expect(_multipartContentType(req), contains("boundary="));
      expect(req.headers["authorization"], "Bearer tok-123");

      final String body = adapter.bodies.single;
      expect(body, contains('name="source"'));
      expect(body, contains("web"));
      expect(body, contains('name="text"'));
      expect(body, contains("a thought"));
      // text-only: no url field.
      expect(body, isNot(contains('name="url"')));
    });

    test("a url goes in the url field, not text", () async {
      final _FakeAdapter adapter = _FakeAdapter(<Object>[
        const _Reply(201, <String, Object?>{"ok": true, "captureId": kCaptureId}),
      ]);

      await _repo(adapter).post(url: "https://example.com/post");

      final String body = adapter.bodies.single;
      expect(body, contains('name="url"'));
      expect(body, contains("https://example.com/post"));
      expect(body, isNot(contains('name="text"')));
      expect(body, contains('name="source"'));
    });

    test("an empty payload is refused locally without touching the network", () async {
      final _FakeAdapter adapter = _FakeAdapter(<Object>[]);

      await expectLater(
        _repo(adapter).post(text: "   "),
        throwsA(isA<CaptureError>()
            .having((CaptureError e) => e.code, "code", "empty")),
      );
      expect(adapter.requests, isEmpty);
    });

    test("a 400 maps to invalid_request carrying the server's error text", () async {
      final _FakeAdapter adapter = _FakeAdapter(<Object>[
        const _Reply(400, <String, Object?>{
          "ok": false,
          "error": "text or url required",
        }),
      ]);

      await expectLater(
        _repo(adapter).post(text: "x"),
        throwsA(isA<CaptureError>()
            .having((CaptureError e) => e.code, "code", "invalid_request")
            .having((CaptureError e) => e.status, "status", 400)
            .having((CaptureError e) => e.serverError, "serverError",
                "text or url required")
            .having((CaptureError e) => e.message, "message",
                contains("text or url required"))),
      );
    });

    test("a transport failure maps to network and says NOT saved", () async {
      final _FakeAdapter adapter = _FakeAdapter(<Object>[const _NetworkFailure()]);

      await expectLater(
        _repo(adapter).post(text: "offline thought"),
        throwsA(isA<CaptureError>()
            .having((CaptureError e) => e.code, "code", "network")
            .having((CaptureError e) => e.status, "status", isNull)
            .having((CaptureError e) => e.isNetwork, "isNetwork", isTrue)
            .having((CaptureError e) => e.message, "message",
                contains("NOT saved"))),
      );
    });

    test("a malformed 201 (no captureId) is unexpected, never success", () async {
      final _FakeAdapter adapter = _FakeAdapter(<Object>[
        const _Reply(201, <String, Object?>{"ok": true}),
      ]);

      await expectLater(
        _repo(adapter).post(text: "x"),
        throwsA(isA<CaptureError>()
            .having((CaptureError e) => e.code, "code", "unexpected")
            .having((CaptureError e) => e.status, "status", 201)),
      );
    });
  });
}
