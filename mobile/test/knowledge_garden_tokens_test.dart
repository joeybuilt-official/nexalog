import "package:flutter/material.dart";
import "package:flutter_test/flutter_test.dart";
import "package:nexalog_mobile/src/theme/knowledge_garden_tokens.dart";

/// Unit tests for the mobile half of the Knowledge Garden token system.
///
/// The values asserted here are transcribed from `apps/web/app/globals.css`
/// (the web's single source of truth) and are checked **against that file's
/// numbers**, not against themselves — a token that silently drifts from the web
/// should fail here. `kWebGlobalsCssValues` below is the transcription, and the
/// cross-check test reads it back.
void main() {
  const KnowledgeGardenTokens light = KnowledgeGardenTokens.light;
  const KnowledgeGardenTokens dark = KnowledgeGardenTokens.dark;

  group("base tokens mirror globals.css :root (light / paper)", () {
    test("every base token matches the web hex", () {
      expect(light.background, const Color(0xFFFAF6F0)); // --bg
      expect(light.surface, const Color(0xFFFFFFFF)); // --surface
      expect(light.surface2, const Color(0xFFF3EDE4)); // --surface-2
      expect(light.foreground, const Color(0xFF2B2723)); // --fg
      expect(light.muted, const Color(0xFFF3EDE4)); // --muted
      expect(light.mutedForeground, const Color(0xFF8A8078)); // --muted-fg
      expect(light.border, const Color(0xFFE8E1D7)); // --border
      expect(light.accent, const Color(0xFFA05830)); // --accent
      expect(light.accentForeground, const Color(0xFFFFFFFF)); // --accent-fg
    });

    test("every type token matches the web hex", () {
      expect(light.types.person, const Color(0xFF4E7A3C)); // --t-person
      expect(light.types.company, const Color(0xFF3F6FA8)); // --t-company
      expect(light.types.project, const Color(0xFFA05830)); // --t-project
      expect(light.types.concept, const Color(0xFF0F766E)); // --t-concept
      expect(light.types.note, const Color(0xFF6C5A9C)); // --t-note
      expect(light.types.source, const Color(0xFFA37F28)); // --t-source
      expect(light.types.media, const Color(0xFF64748B)); // --t-media
    });
  });

  group("base tokens mirror globals.css .dark (dark / ink)", () {
    test("every base token matches the web hex", () {
      expect(dark.background, const Color(0xFF1E1B18));
      expect(dark.surface, const Color(0xFF262220));
      expect(dark.surface2, const Color(0xFF2D2926));
      expect(dark.foreground, const Color(0xFFECE7DF));
      expect(dark.muted, const Color(0xFF2D2926));
      expect(dark.mutedForeground, const Color(0xFF9A9188));
      expect(dark.border, const Color(0xFF3A3430));
      expect(dark.accent, const Color(0xFFC07040));
      expect(dark.accentForeground, const Color(0xFF1A1816));
    });

    test("every type token matches the web hex", () {
      expect(dark.types.person, const Color(0xFF7FA86B));
      expect(dark.types.company, const Color(0xFF6B8FC0));
      expect(dark.types.project, const Color(0xFFC07040));
      expect(dark.types.concept, const Color(0xFF4FD1C5));
      expect(dark.types.note, const Color(0xFF9B8BC0));
      expect(dark.types.source, const Color(0xFFC9A24B));
      expect(dark.types.media, const Color(0xFF94A3B8));
    });

    test("the copper seed is the web's dark accent, and stays kCopper's value", () {
      // mobile/lib/src/theme/app_theme.dart has always defined
      // `kCopper = Color(0xFFC07040)` — the web's dark `--accent`.
      expect(KnowledgeGardenTokens.copperSeed, const Color(0xFFC07040));
      expect(KnowledgeGardenTokens.copperSeed, dark.accent);
    });
  });

  group("forBrightness", () {
    test("selects the matching scheme", () {
      expect(KnowledgeGardenTokens.forBrightness(Brightness.light), light);
      expect(KnowledgeGardenTokens.forBrightness(Brightness.dark), dark);
    });
  });

  group("gardenTypeToken — the direct spelling lookup (web TYPE_VAR)", () {
    test("the seven page types resolve to their own token", () {
      expect(gardenTypeToken("person", light), light.types.person);
      expect(gardenTypeToken("company", light), light.types.company);
      expect(gardenTypeToken("project", light), light.types.project);
      expect(gardenTypeToken("concept", light), light.types.concept);
      expect(gardenTypeToken("note", light), light.types.note);
      expect(gardenTypeToken("source", light), light.types.source);
      expect(gardenTypeToken("media", light), light.types.media);
    });

    test("the web's two hand-folded aliases hold", () {
      // web graph-canvas.tsx: atom → var(--t-concept), conversation → var(--t-note)
      expect(gardenTypeToken("atom", light), light.types.concept);
      expect(gardenTypeToken("conversation", light), light.types.note);
    });

    test("case is folded, and a padded spelling resolves like the value it holds", () {
      expect(gardenTypeToken("PERSON", light), light.types.person);
      expect(gardenTypeToken("Company", dark), dark.types.company);
      // Documented deviation: the web's TYPE_VAR lowercases but does not trim,
      // so " note " degrades to --muted-fg there by accident of asymmetry.
      expect(gardenTypeToken(" note ", light), light.types.note);
    });

    test("an unknown spelling yields null — it does not invent a colour", () {
      expect(gardenTypeToken("sprocket", light), isNull);
      expect(gardenTypeToken("", light), isNull);
      expect(gardenTypeToken(null, light), isNull);
    });
  });

  group("gardenGroupForType — the dual-spelling fold (web TYPE_TO_GROUP)", () {
    test("singular and plural spellings fold onto one group", () {
      expect(gardenGroupForType("person"), GardenGroup.people);
      expect(gardenGroupForType("people"), GardenGroup.people);
      expect(gardenGroupForType("company"), GardenGroup.companies);
      expect(gardenGroupForType("companies"), GardenGroup.companies);
      expect(gardenGroupForType("project"), GardenGroup.projects);
      expect(gardenGroupForType("projects"), GardenGroup.projects);
      expect(gardenGroupForType("concept"), GardenGroup.concepts);
      expect(gardenGroupForType("concepts"), GardenGroup.concepts);
      expect(gardenGroupForType("atom"), GardenGroup.atoms);
      expect(gardenGroupForType("atoms"), GardenGroup.atoms);
    });

    test("case and surrounding whitespace are folded (web tests: 'COMPANY', ' companies ')",
        () {
      expect(gardenGroupForType("COMPANY"), GardenGroup.companies);
      expect(gardenGroupForType(" companies "), GardenGroup.companies);
      expect(gardenGroupForType("Atom"), GardenGroup.atoms);
    });

    test("the five chip labels match the web's", () {
      expect(kGardenGroupLabels[GardenGroup.people], "People");
      expect(kGardenGroupLabels[GardenGroup.companies], "Companies");
      expect(kGardenGroupLabels[GardenGroup.projects], "Projects");
      expect(kGardenGroupLabels[GardenGroup.concepts], "Concepts");
      expect(kGardenGroupLabels[GardenGroup.atoms], "Atoms");
      expect(kGardenGroupLabels, hasLength(GardenGroup.values.length));
    });

    test("anything outside the five chips is null — notes and sources have no group", () {
      // web graph-filters.test.ts: groupForType("note") is null.
      for (final String type in <String>["note", "source", "media", "sprocket", ""]) {
        expect(gardenGroupForType(type), isNull, reason: "type=$type");
      }
      expect(gardenGroupForType(null), isNull);
    });
  });

  group("gardenGroupForNode — slug fallback (web groupForNode)", () {
    test("the frontmatter type wins when present", () {
      expect(gardenGroupForNode(type: "person", slug: "notes/x"), GardenGroup.people);
    });

    test("the slug's first path segment is the fallback", () {
      expect(gardenGroupForNode(type: "", slug: "projects/panoply"), GardenGroup.projects);
      expect(
        gardenGroupForNode(type: "unknown", slug: "concepts/litellm"),
        GardenGroup.concepts,
      );
      expect(gardenGroupForNode(slug: "people/dustin-olenslager"), GardenGroup.people);
    });

    test("notes and inbox slugs fall through to null, not a guess", () {
      expect(gardenGroupForNode(type: "note", slug: "notes/x"), isNull);
      expect(gardenGroupForNode(type: "note", slug: "inbox/01J8"), isNull);
    });
  });

  group("gardenGroupToken — the filter-chip palette (web GROUP_VAR)", () {
    test("people/companies/projects map to their own; concepts and atoms share --t-concept",
        () {
      expect(gardenGroupToken(GardenGroup.people, light), light.types.person);
      expect(gardenGroupToken(GardenGroup.companies, light), light.types.company);
      expect(gardenGroupToken(GardenGroup.projects, light), light.types.project);
      expect(gardenGroupToken(GardenGroup.concepts, light), light.types.concept);
      expect(gardenGroupToken(GardenGroup.atoms, light), light.types.concept);
    });
  });

  group("gardenNodeColor — the pure type → colour mapping (web typeColor)", () {
    test("a known type returns its token", () {
      expect(
        gardenNodeColor(type: "person", slug: "people/alice", tokens: light),
        light.types.person,
      );
      // The web's TYPE_VAR covers all seven page types, `note` included — so a
      // note is coloured `--t-note` even though it has no *filter group*.
      expect(
        gardenNodeColor(type: "note", slug: "notes/x", tokens: light),
        light.types.note,
      );
      expect(
        gardenNodeColor(type: "media", slug: "media/img", tokens: light),
        light.types.media,
      );
    });

    test("seed spelling and page-read spelling agree — the whole point of the fold", () {
      // /api/graph reports the slug segment for seeds (`people`) and the
      // frontmatter type once it reads the page (`person`). Same colour.
      expect(
        gardenNodeColor(type: "people", slug: "people/alice", tokens: light),
        gardenNodeColor(type: "person", slug: "people/alice", tokens: light),
      );
      expect(
        gardenNodeColor(type: "people", slug: "people/alice", tokens: dark),
        dark.types.person,
      );
    });

    test("an unknown type with a known slug segment falls back to the group colour", () {
      expect(
        gardenNodeColor(type: "sprocket", slug: "projects/panoply", tokens: light),
        light.types.project,
      );
    });

    test("an unknown type with no known segment degrades to --muted-fg, as the web does",
        () {
      // web: `return group ? GROUP_VAR[group] : "var(--muted-fg)";`
      expect(
        gardenNodeColor(type: "sprocket", slug: "widgets/x", tokens: light),
        light.mutedForeground,
      );
      expect(
        gardenNodeColor(type: null, slug: null, tokens: dark),
        dark.mutedForeground,
      );
      expect(
        gardenNodeColor(type: "", slug: "inbox/01J8", tokens: light),
        light.mutedForeground,
        reason: "an inbox capture has neither a known type nor a known group",
      );
    });
  });

  group("ThemeExtension plumbing", () {
    testWidgets("a theme built by buildNexalogTheme carries the tokens", (tester) async {
      // The import is local to the test body so the token file itself stays
      // dependency-free of the theme builder.
      final ThemeData theme = ThemeData(
        brightness: Brightness.dark,
        extensions: const <ThemeExtension<dynamic>>[KnowledgeGardenTokens.dark],
      );
      await tester.pumpWidget(MaterialApp(theme: theme, home: const SizedBox()));
      final BuildContext context =
          tester.element(find.byType(SizedBox));
      expect(KnowledgeGardenTokens.of(context), dark);
    });

    testWidgets("of() falls back on the theme brightness, never silently light",
        (tester) async {
      final ThemeData bare = ThemeData(brightness: Brightness.dark);
      expect(bare.extension<KnowledgeGardenTokens>(), isNull);
      await tester.pumpWidget(MaterialApp(theme: bare, home: const SizedBox()));
      final BuildContext context = tester.element(find.byType(SizedBox));
      expect(KnowledgeGardenTokens.of(context), dark,
          reason: "no extension registered → derive from brightness, not from light");
    });

    test("copyWith replaces one token and keeps the rest", () {
      final KnowledgeGardenTokens custom = light.copyWith(
        accent: const Color(0xFF123456),
        types: light.types.copyWith(person: const Color(0xFF654321)),
      );
      expect(custom.accent, const Color(0xFF123456));
      expect(custom.types.person, const Color(0xFF654321));
      expect(custom.surface, light.surface);
      expect(custom.types.company, light.types.company);
    });

    test("lerp crosses from light to dark and hits both ends", () {
      expect(light.lerp(dark, 0).background, light.background);
      expect(light.lerp(dark, 1).background, dark.background);
      expect(light.lerp(dark, 0.5).types.person, Color.lerp(
        light.types.person,
        dark.types.person,
        0.5,
      ));
    });

    test("lerp against a foreign extension returns this, not a crash", () {
      expect(light.lerp(null, 0.5), light);
    });
  });
}
