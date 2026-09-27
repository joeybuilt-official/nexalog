// SPDX-License-Identifier: MIT
//
// Voice-memo upload tests: the recording must reach the live intake route as a
// multipart `file` entry with its audio MIME type, there must be NO
// `workspaceId` field (the v1 JSON body carried one and the live route 400s on
// a JSON body anyway), and the local file lifecycle is the whole point —
// deleted only after a confirmed 201, retained on failure so no audio is lost
// silently.

import "dart:convert";
import "dart:io";
import "dart:typed_data";

import "package:dio/dio.dart";
import "package:flutter_test/flutter_test.dart";
import "package:nexalog_mobile/src/core/api/api_client.dart";
import "package:nexalog_mobile/src/core/api/capture_repo.dart";
import "package:nexalog_mobile/src/core/auth/auth_store.dart";
import "package:nexalog_mobile/src/features/voice/voice_memo_upload.dart";

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

class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this.script);

  final List<Object> script;
  final List<RequestOptions> requests = <RequestOptions>[];
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
      throw StateError("FakeAdapter ran out of replies");
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

CaptureRepo _repo(_FakeAdapter adapter) {
  final ApiClient api = ApiClient(
    _FakeAuthStore("tok-123"),
    dio: Dio(BaseOptions(baseUrl: "https://nexalog.com"))
      ..httpClientAdapter = adapter,
  );
  return CaptureRepo(api);
}

const String kCaptureId = "01M38ZNA67JAGSYCGSJDYDM3DD";

/// Writes a stand-in recording file with recognisable bytes.
Future<File> _writeRecording(Directory dir) async {
  final File f = File("${dir.path}/memo-1.m4a");
  await f.writeAsBytes(utf8.encode("fake-aac-payload"));
  return f;
}

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
  group("uploadVoiceMemo", () {
    late Directory tmp;

    setUp(() async {
      tmp = await Directory.systemTemp.createTemp("voice-memo-test");
    });

    tearDown(() async {
      if (await tmp.exists()) await tmp.delete(recursive: true);
    });

    test("sends the recording as a multipart file with audio MIME, no workspaceId",
        () async {
      final File recording = await _writeRecording(tmp);
      final _FakeAdapter adapter = _FakeAdapter(<Object>[
        const _Reply(201, <String, Object?>{"ok": true, "captureId": kCaptureId}),
      ]);

      final String id = await uploadVoiceMemo(
        repo: _repo(adapter),
        path: recording.path,
        filename: "memo-1.m4a",
      );

      expect(id, kCaptureId);
      final RequestOptions req = adapter.requests.single;
      expect(req.path, "/api/capture");
      expect(req.method, "POST");
      expect(_multipartContentType(req), startsWith("multipart/form-data"));
      expect(_multipartContentType(req), contains("boundary="));

      final String body = adapter.bodies.single;
      // The attachment travels under a `file`-prefixed key, which is what the
      // handler collects.
      expect(body, contains('name="file"'));
      expect(body, contains('filename="memo-1.m4a"'));
      expect(body, contains("audio/m4a"));
      expect(body, contains("fake-aac-payload"));
      expect(body, contains('name="source"'));
      // The v1 workspace concept never rides along on the v2 intake.
      expect(body, isNot(contains("workspaceId")));
      expect(body, isNot(contains('name="kind"')));

      // Confirmed by the server, so the local copy is retired.
      expect(await recording.exists(), isFalse);
    });

    test("keeps the local recording when the server rejects it", () async {
      final File recording = await _writeRecording(tmp);
      final _FakeAdapter adapter = _FakeAdapter(<Object>[
        const _Reply(400, <String, Object?>{
          "ok": false,
          "error": "attachment too large",
        }),
      ]);

      await expectLater(
        uploadVoiceMemo(
          repo: _repo(adapter),
          path: recording.path,
          filename: "memo-1.m4a",
        ),
        throwsA(isA<CaptureError>()
            .having((CaptureError e) => e.code, "code", "invalid_request")
            .having((CaptureError e) => e.serverError, "serverError",
                "attachment too large")),
      );

      // Nothing was accepted, so nothing may be deleted.
      expect(await recording.exists(), isTrue);
      expect(await recording.readAsString(), "fake-aac-payload");
    });

    test("keeps the local recording when the request never lands", () async {
      final File recording = await _writeRecording(tmp);
      final _FakeAdapter adapter =
          _FakeAdapter(<Object>[const _NetworkFailure()]);

      await expectLater(
        uploadVoiceMemo(
          repo: _repo(adapter),
          path: recording.path,
          filename: "memo-1.m4a",
        ),
        throwsA(isA<CaptureError>()
            .having((CaptureError e) => e.code, "code", "network")),
      );

      expect(await recording.exists(), isTrue);
    });

    test("optional text rides along with the audio", () async {
      final File recording = await _writeRecording(tmp);
      final _FakeAdapter adapter = _FakeAdapter(<Object>[
        const _Reply(201, <String, Object?>{"ok": true, "captureId": kCaptureId}),
      ]);

      await uploadVoiceMemo(
        repo: _repo(adapter),
        path: recording.path,
        filename: "memo-1.m4a",
        text: "remember to follow up",
      );

      final String body = adapter.bodies.single;
      expect(body, contains('name="text"'));
      expect(body, contains("remember to follow up"));
      expect(body, contains('name="file"'));
    });
  });
}
