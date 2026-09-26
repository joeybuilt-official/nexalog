import "package:flutter_test/flutter_test.dart";
import "package:nexalog_mobile/src/core/offline/offline_repo.dart";
import "package:nexalog_mobile/src/features/bookmarks/bookmarks_screen.dart";
import "package:nexalog_mobile/src/features/notes/notes_providers.dart";

void main() {
  test("newId is a v4 uuid", () {
    final String id = OfflineRepo.newId();
    expect(
      RegExp(
        r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
      ).hasMatch(id),
      isTrue,
    );
    expect(OfflineRepo.newId(), isNot(equals(id)));
  });

  test("Note.displayTitle falls back to first content line", () {
    final Note titled = Note(<String, Object?>{"title": "Hello", "content": "x"});
    expect(titled.displayTitle, "Hello");

    final Note untitled =
        Note(<String, Object?>{"title": "", "content": "first line\nsecond"});
    expect(untitled.displayTitle, "first line");

    final Note empty = Note(<String, Object?>{"title": "", "content": ""});
    expect(empty.displayTitle, "Untitled");
  });

  test("Capture.title prefers og title then url", () {
    final Capture withOg =
        Capture(<String, Object?>{"ogTitle": "Title", "url": "https://x"});
    expect(withOg.title, "Title");

    final Capture urlOnly = Capture(<String, Object?>{"url": "https://x"});
    expect(urlOnly.title, "https://x");
  });
}
