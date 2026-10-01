import "dart:io";

import "package:flutter_test/flutter_test.dart";

/// **The wall against hardcoded colors in mobile UI code.**
///
/// The web gets this for free: `apps/web/app/globals.css` disables the default
/// Tailwind palette (`--color-*: initial`), so `bg-zinc-900` fails to *compile*
/// and colour can only enter a screen through a semantic token. Dart has no such
/// switch — `Colors.red` always compiles — so the wall has to be a test.
///
/// This test fails when a colour literal appears anywhere under `mobile/lib`
/// except the design-token file that is supposed to own it
/// (`lib/src/theme/knowledge_garden_tokens.dart`).
///
/// ## What it catches
///
/// | Pattern | Example it fails on |
/// |---|---|
/// | `Color(0x…)` | `Color(0xFF4E7A3C)` |
/// | `Color.fromARGB` / `Color.fromRGBO` | `Color.fromARGB(255, 78, 122, 60)` |
/// | The Material palette | `Colors.red`, `Colors.blue.shade100`, `Colors.grey` |
/// | A bare 8-digit hex int | `0xFF4E7A3C` passed to something colour-shaped |
///
/// ## The boundary drawn, and why
///
/// * **Scanned:** `mobile/lib/**/*.dart` — every line the app can actually
///   render. Only *production UI code* can drift.
/// * **Exempt — one file, named:** `lib/src/theme/knowledge_garden_tokens.dart`.
///   A token file that could not name a colour would be useless; this is where
///   the web's `globals.css` values live, with the `--var` each one came from
///   recorded in a comment beside it. The exemption is an explicit path, not a
///   `theme/` directory or a `*_tokens.dart` glob, so a second token file has to
///   be added to this list on purpose — i.e. reviewed.
/// * **Not scanned:** `mobile/test/**`. Test fixtures legitimately need colours
///   (asserting contrast, faking a palette), and a test cannot ship a bad colour
///   to a user.
/// * **Deliberately NOT exempt:** everything else, including `main.dart`,
///   `app.dart`, every `features/**` widget, and `core/`.
///
/// ## What it cannot catch — stated plainly
///
/// This is a text scan, and it is honest about being one. It does **not** catch:
///
/// * a colour computed at runtime (`Color(int.parse(someHex))`, or
///   `Color(v)` from a server payload such as the workspace accent in
///   `features/shell/app_shell.dart`), and
/// * a colour laundered through a constant defined outside `lib/`.
///
/// Those are deliberate evasion, not the accidental drift this gate exists to
/// stop. The gate's job is the same one `scripts/check-docs.sh` states for
/// itself: enforce presence, not correctness.
///
/// The [negative control](#a-synthetic-violation-is-detected) below is what
/// keeps this from being a gate that passes vacuously — the failure mode this
/// repo has a documented habit of (see `docs/agents/platform/mobile/parity.md`
/// §1). If the detector ever stops detecting, that test goes red.
void main() {
  /// The one file allowed to hold raw colour literals.
  const String tokenFile = "lib/src/theme/knowledge_garden_tokens.dart";

  /// Colours that are not palette *choices* but the absence of paint. Kept as an
  /// explicit, named allow-list rather than a silent carve-out: adding an entry
  /// is a reviewable edit to this test, which is the point.
  const List<String> allowedLiteralExceptions = <String>[];

  // ── the detector ───────────────────────────────────────────────────────────
  // Patterns 2-3 are anchored so identifiers that merely *contain* a palette
  // name cannot fire: `Colors.red` matches, `myColors.redisUrl` does not,
  // `kColors` cannot (no `Colors.`), and `Colorscheme.of` cannot (no dot).

  /// A palette member access: `Colors.red`, `Colors.blue.shade100`, `Colors.grey`.
  final RegExp paletteAccess = RegExp(r"(?<![A-Za-z0-9_$])Colors\.[A-Za-z]");

  /// A `Color` constructor carrying a literal, in any of its three literal forms.
  final RegExp colorLiteral = RegExp(
    r"Color\s*\(\s*0x|Color\.fromARGB\s*\(|Color\.fromRGBO\s*\(",
  );

  /// A bare 8-digit hex int (`0xFF4E7A3C`) — the shape of every web hex, so a
  /// literal that dodges `Color(` still trips here.
  final RegExp hexLiteral = RegExp(r"0x[0-9a-fA-F]{8}\b");

  /// Lines this scanner must ignore regardless of content: `///` and `//` doc
  /// and inline comments. A comment naming a token's hex value is documentation
  /// (the token file's whole style), not a rendered colour.
  final RegExp commentLine = RegExp(r"^\s*(///|//)");

  List<String> violationsIn(String path, String source) {
    final List<String> found = <String>[];
    final List<String> lines = source.split("\n");
    for (int i = 0; i < lines.length; i++) {
      final String line = lines[i];
      if (commentLine.hasMatch(line)) continue;
      if (allowedLiteralExceptions.any(line.contains)) continue;
      final bool hit = paletteAccess.hasMatch(line) ||
          colorLiteral.hasMatch(line) ||
          hexLiteral.hasMatch(line);
      if (hit) found.add("$path:${i + 1}: ${line.trim()}");
    }
    return found;
  }

  List<File> dartFilesUnder(Directory dir) {
    return dir
        .listSync(recursive: true)
        .whereType<File>()
        .where((File f) => f.path.endsWith(".dart"))
        .toList()
      ..sort((File a, File b) => a.path.compareTo(b.path));
  }

  // ── the negative control ───────────────────────────────────────────────────
  group("the detector itself", () {
    test("a synthetic violation is detected", () {
      const String bad = '''
import "package:flutter/material.dart";
class Bad extends StatelessWidget {
  Widget build(BuildContext c) => Container(
    color: Colors.red.shade400,
    child: const Text("x", style: TextStyle(color: Color(0xFF4E7A3C))),
  );
}
''';
      final List<String> hits = violationsIn("synthetic.dart", bad);
      expect(hits, hasLength(2),
          reason: "the detector must fire on BOTH a palette access and a literal — "
              "if this fails the enforcement test below proves nothing");
    });

    test("clean, token-driven code is not flagged", () {
      const String good = '''
import "package:flutter/material.dart";
import "../theme/knowledge_garden_tokens.dart";
class Good extends StatelessWidget {
  Widget build(BuildContext context) {
    final KnowledgeGardenTokens t = KnowledgeGardenTokens.of(context);
    return Container(
      color: t.surface,
      child: Icon(Icons.circle, color: gardenGroupToken(GardenGroup.people, t)),
    );
  }
}
''';
      expect(violationsIn("good.dart", good), isEmpty);
    });

    test("comment lines and lookalike identifiers are not flagged", () {
      const String near = '''
// Colors.red is the old way; we use tokens now.
/// person: Color(0xFF4E7A3C) — the --t-person value, recorded for traceability.
final Uri colorsEndpoint = Uri.parse("/v1/colors");
final String redisKey = "colors.redis";
''';
      expect(violationsIn("near.dart", near), isEmpty);
    });
  });

  // ── the gate ───────────────────────────────────────────────────────────────
  test("no hardcoded colour literals in mobile UI code", () {
    final Directory lib = Directory("lib");
    expect(lib.existsSync(), isTrue,
        reason: "run from mobile/ (flutter test does this by default)");

    final List<File> files = dartFilesUnder(lib);
    expect(files, isNotEmpty, reason: "scanned no files — the gate would pass vacuously");

    final List<String> violations = <String>[];
    int scanned = 0;
    bool sawTokenFile = false;
    for (final File file in files) {
      final String path = file.path.replaceAll(r"\", "/");
      if (path.endsWith(tokenFile)) {
        sawTokenFile = true;
        continue;
      }
      scanned++;
      violations.addAll(violationsIn(path, file.readAsStringSync()));
    }

    expect(sawTokenFile, isTrue,
        reason: "the exempt token file $tokenFile is gone — if it was moved, move "
            "the exemption with it rather than deleting the exemption");

    expect(scanned, greaterThan(10),
        reason: "only $scanned files scanned; the scan is not reaching the tree");

    expect(
      violations,
      isEmpty,
      reason: "Hardcoded colour(s) found in mobile UI code. Use the Knowledge "
          "Garden tokens instead — `KnowledgeGardenTokens.of(context)` for base "
          "surfaces and `gardenNodeColor` / `gardenTypeToken` / `gardenGroupToken` "
          "for page-type colour. If a genuinely new colour is needed, add it to "
          "$tokenFile (the single source of truth, ported from "
          "apps/web/app/globals.css) rather than inline here.\n\n"
          "${violations.join("\n")}",
    );
  });
}
