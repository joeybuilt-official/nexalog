// SPDX-License-Identifier: MIT
//
// Voice-memo upload — the one place a recording is handed to the live v2
// intake route and the local file is retired.
//
// Kept as a free function (not screen state) for two reasons: it is the whole
// data-loss contract in one readable place, and it is testable without the
// recorder plugin. The contract:
//   - the audio travels as a multipart `file` entry (the handler keeps every
//     form key starting with `file` and derives the capture kind from the MIME
//     type, normalizing audio server-side);
//   - there is NO workspaceId field — the v1 route this replaced wanted one and
//     the live route rejects a JSON body outright;
//   - the local recording is deleted ONLY after a real 201. On failure the file
//     stays on disk so nothing is lost silently, and the caller gets the typed
//     [CaptureError] to show honestly.

import "dart:io";

import "../../core/api/capture_repo.dart";

/// Upload the recording at [path] as a voice capture. Returns the server's
/// capture id and deletes the local file once the server has confirmed it.
/// Throws [CaptureError] (file retained) on any failure.
Future<String> uploadVoiceMemo({
  required CaptureRepo repo,
  required String path,
  required String filename,
  String? text,
  String contentType = "audio/m4a",
}) async {
  final String id = await repo.post(
    text: text,
    files: <CaptureFile>[
      CaptureFile(path: path, filename: filename, contentType: contentType),
    ],
  );
  // Success confirmed by the server (201 + captureId) — only now is the local
  // copy redundant. A delete failure must not undo the successful capture.
  try {
    final File f = File(path);
    if (await f.exists()) await f.delete();
  } on FileSystemException {
    // The capture is safe server-side; leaving the temp file behind is
    // harmless and is not an error worth showing the operator.
  }
  return id;
}
