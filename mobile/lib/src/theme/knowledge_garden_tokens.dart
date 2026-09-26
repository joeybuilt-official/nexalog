/// The Knowledge Garden token system, ported from the web's single source of
/// truth: `apps/web/app/globals.css`.
///
/// The web disables the default Tailwind palette (`--color-*: initial`) so that
/// `bg-zinc-900` and friends **fail to compile**; colour can only enter a
/// screen through a semantic token. This file is the mobile half of that wall:
/// it is the ONE place in `mobile/lib` allowed to hold a raw colour literal
/// (`Color(0x…)`), enforced by `mobile/test/no_hardcoded_colors_test.dart`.
///
/// Structure mirrors globals.css deliberately — it keeps the two blocks the web
/// keeps apart:
///
///   * base semantic tokens (`--bg`, `--surface`, `--surface-2`, `--fg`,
///     `--muted`, `--muted-fg`, `--border`, `--accent`, `--accent-fg`), and
///   * the per-type palette (`--t-person`, `--t-company`, `--t-project`,
///     `--t-concept`, `--t-note`, `--t-source`, `--t-media`).
///
/// Light ("paper") and dark ("ink") are both defined, as they are on the web.
/// Every hex below is copied from globals.css — none is invented. The mapping
/// from a page/node type string to a token is in [gardenNodeColor] et al below.
///
/// **Honest limits of this port** (see the PR and
/// `docs/claude/platform/mobile/parity.md` §4.2): the *garden surface* itself
/// (`/app/graph`) is still unported, and [buildNexalogTheme] still derives its
/// Material [ColorScheme] from the copper accent seed rather than replacing it
/// token-by-token. The tokens are now the app's single source of colour truth;
/// they are not yet the only colour the app renders.
library;

import "package:flutter/material.dart";

/// The per-type palette — globals.css `--t-*`.
///
/// Page *type* is the accent system: person=green, company=blue, project=copper,
/// concept=teal, note=violet, source=amber, media=slate.
@immutable
class GardenTypePalette {
  const GardenTypePalette({
    required this.person,
    required this.company,
    required this.project,
    required this.concept,
    required this.note,
    required this.source,
    required this.media,
  });

  /// globals.css `:root` (light / "paper").
  static const GardenTypePalette light = GardenTypePalette(
    person: Color(0xFF4E7A3C), // --t-person: #4e7a3c
    company: Color(0xFF3F6FA8), // --t-company: #3f6fa8
    project: Color(0xFFA05830), // --t-project: #a05830
    concept: Color(0xFF0F766E), // --t-concept: #0f766e
    note: Color(0xFF6C5A9C), // --t-note: #6c5a9c
    source: Color(0xFFA37F28), // --t-source: #a37f28
    media: Color(0xFF64748B), // --t-media: #64748b
  );

  /// globals.css `.dark` (dark / "ink").
  static const GardenTypePalette dark = GardenTypePalette(
    person: Color(0xFF7FA86B), // --t-person: #7fa86b
    company: Color(0xFF6B8FC0), // --t-company: #6b8fc0
    project: Color(0xFFC07040), // --t-project: #c07040
    concept: Color(0xFF4FD1C5), // --t-concept: #4fd1c5
    note: Color(0xFF9B8BC0), // --t-note: #9b8bc0
    source: Color(0xFFC9A24B), // --t-source: #c9a24b
    media: Color(0xFF94A3B8), // --t-media: #94a3b8
  );

  final Color person;
  final Color company;
  final Color project;
  final Color concept;
  final Color note;
  final Color source;
  final Color media;

  GardenTypePalette copyWith({
    Color? person,
    Color? company,
    Color? project,
    Color? concept,
    Color? note,
    Color? source,
    Color? media,
  }) {
    return GardenTypePalette(
      person: person ?? this.person,
      company: company ?? this.company,
      project: project ?? this.project,
      concept: concept ?? this.concept,
      note: note ?? this.note,
      source: source ?? this.source,
      media: media ?? this.media,
    );
  }

  /// Linear interpolation between two palettes, for [KnowledgeGardenTokens.lerp].
  static GardenTypePalette lerp(GardenTypePalette a, GardenTypePalette b, double t) {
    return GardenTypePalette(
      person: Color.lerp(a.person, b.person, t)!,
      company: Color.lerp(a.company, b.company, t)!,
      project: Color.lerp(a.project, b.project, t)!,
      concept: Color.lerp(a.concept, b.concept, t)!,
      note: Color.lerp(a.note, b.note, t)!,
      source: Color.lerp(a.source, b.source, t)!,
      media: Color.lerp(a.media, b.media, t)!,
    );
  }
}

/// One brightness's worth of Knowledge Garden tokens: the base semantic tokens
/// plus the [GardenTypePalette].
///
/// Registered on [ThemeData] as a [ThemeExtension] by `buildNexalogTheme`, so a
/// widget reads it the same way it already reads
/// `Theme.of(context).colorScheme` — one access path, no second theming pattern:
///
/// ```dart
/// final KnowledgeGardenTokens tokens = KnowledgeGardenTokens.of(context);
/// final Color c = gardenNodeColor(type: node.type, slug: node.slug, tokens: tokens);
/// ```
@immutable
class KnowledgeGardenTokens extends ThemeExtension<KnowledgeGardenTokens> {
  const KnowledgeGardenTokens({
    required this.background,
    required this.surface,
    required this.surface2,
    required this.foreground,
    required this.muted,
    required this.mutedForeground,
    required this.border,
    required this.accent,
    required this.accentForeground,
    required this.types,
  });

  /// globals.css `:root` (light / "paper").
  static const KnowledgeGardenTokens light = KnowledgeGardenTokens(
    background: Color(0xFFFAF6F0), // --bg: #faf6f0
    surface: Color(0xFFFFFFFF), // --surface: #ffffff
    surface2: Color(0xFFF3EDE4), // --surface-2: #f3ede4
    foreground: Color(0xFF2B2723), // --fg: #2b2723
    muted: Color(0xFFF3EDE4), // --muted: #f3ede4
    mutedForeground: Color(0xFF8A8078), // --muted-fg: #8a8078
    border: Color(0xFFE8E1D7), // --border: #e8e1d7
    accent: Color(0xFFA05830), // --accent: #a05830
    accentForeground: Color(0xFFFFFFFF), // --accent-fg: #ffffff
    types: GardenTypePalette.light,
  );

  /// globals.css `.dark` (dark / "ink").
  static const KnowledgeGardenTokens dark = KnowledgeGardenTokens(
    background: Color(0xFF1E1B18), // --bg: #1e1b18
    surface: Color(0xFF262220), // --surface: #262220
    surface2: Color(0xFF2D2926), // --surface-2: #2d2926
    foreground: Color(0xFFECE7DF), // --fg: #ece7df
    muted: Color(0xFF2D2926), // --muted: #2d2926
    mutedForeground: Color(0xFF9A9188), // --muted-fg: #9a9188
    border: Color(0xFF3A3430), // --border: #3a3430
    accent: Color(0xFFC07040), // --accent: #c07040
    accentForeground: Color(0xFF1A1816), // --accent-fg: #1a1816
    types: GardenTypePalette.dark,
  );

  /// The copper accent the Material scheme is seeded from — globals.css's dark
  /// `--accent: #c07040`, which is what `kCopper` always was.
  static const Color copperSeed = Color(0xFFC07040);

  final Color background;
  final Color surface;
  final Color surface2;
  final Color foreground;
  final Color muted;
  final Color mutedForeground;
  final Color border;
  final Color accent;
  final Color accentForeground;
  final GardenTypePalette types;

  /// The token set for a brightness.
  static KnowledgeGardenTokens forBrightness(Brightness brightness) {
    return brightness == Brightness.dark ? dark : light;
  }

  /// The tokens of the ambient theme.
  ///
  /// Falls back to [forBrightness] of the theme's brightness when nothing is
  /// registered, so a widget that renders outside `buildNexalogTheme` still
  /// gets the right *scheme* rather than a silently light one.
  static KnowledgeGardenTokens of(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return theme.extension<KnowledgeGardenTokens>() ??
        forBrightness(theme.brightness);
  }

  @override
  KnowledgeGardenTokens copyWith({
    Color? background,
    Color? surface,
    Color? surface2,
    Color? foreground,
    Color? muted,
    Color? mutedForeground,
    Color? border,
    Color? accent,
    Color? accentForeground,
    GardenTypePalette? types,
  }) {
    return KnowledgeGardenTokens(
      background: background ?? this.background,
      surface: surface ?? this.surface,
      surface2: surface2 ?? this.surface2,
      foreground: foreground ?? this.foreground,
      muted: muted ?? this.muted,
      mutedForeground: mutedForeground ?? this.mutedForeground,
      border: border ?? this.border,
      accent: accent ?? this.accent,
      accentForeground: accentForeground ?? this.accentForeground,
      types: types ?? this.types,
    );
  }

  @override
  KnowledgeGardenTokens lerp(
    ThemeExtension<KnowledgeGardenTokens>? other,
    double t,
  ) {
    if (other is! KnowledgeGardenTokens) return this;
    return KnowledgeGardenTokens(
      background: Color.lerp(background, other.background, t)!,
      surface: Color.lerp(surface, other.surface, t)!,
      surface2: Color.lerp(surface2, other.surface2, t)!,
      foreground: Color.lerp(foreground, other.foreground, t)!,
      muted: Color.lerp(muted, other.muted, t)!,
      mutedForeground: Color.lerp(mutedForeground, other.mutedForeground, t)!,
      border: Color.lerp(border, other.border, t)!,
      accent: Color.lerp(accent, other.accent, t)!,
      accentForeground: Color.lerp(accentForeground, other.accentForeground, t)!,
      types: GardenTypePalette.lerp(types, other.types, t),
    );
  }
}

/// The five garden filter groups — web `apps/web/lib/graph/filters.ts`
/// `FILTER_GROUPS`.
enum GardenGroup { people, companies, projects, concepts, atoms }

/// Chip labels, in the order the web UI renders them — web
/// `FILTER_GROUP_LABELS`.
const Map<GardenGroup, String> kGardenGroupLabels = <GardenGroup, String>{
  GardenGroup.people: "People",
  GardenGroup.companies: "Companies",
  GardenGroup.projects: "Projects",
  GardenGroup.concepts: "Concepts",
  GardenGroup.atoms: "Atoms",
};

/// Web `TYPE_TO_GROUP`: the singular *and* plural spelling of each group folds
/// onto one group, because `/api/graph` reports the slug's first path segment
/// for seeds (`people`) and the page's frontmatter type once it has read the
/// page (`person`). The UI must not care which shape arrived.
GardenGroup? gardenGroupForType(String? type) {
  if (type is! String) return null;
  switch (_normalize(type)) {
    case "person":
    case "people":
      return GardenGroup.people;
    case "company":
    case "companies":
      return GardenGroup.companies;
    case "project":
    case "projects":
      return GardenGroup.projects;
    case "concept":
    case "concepts":
      return GardenGroup.concepts;
    case "atom":
    case "atoms":
      return GardenGroup.atoms;
    default:
      return null;
  }
}

/// Web `groupForNode`: the frontmatter type when we have one, else the slug's
/// first path segment (`people/example-person` → people). Null for anything
/// the five chips do not cover.
GardenGroup? gardenGroupForNode({String? type, String? slug}) {
  final GardenGroup? fromType = gardenGroupForType(type);
  if (fromType != null) return fromType;
  final String firstSegment = (slug ?? "").split("/").first;
  return gardenGroupForType(firstSegment);
}

/// Web `TYPE_VAR`: the direct type-spelling lookup, including the two aliases
/// the web folds by hand — `conversation` → `--t-note` and `atom` → `--t-concept`.
///
/// Returns null when the spelling is not one the garden knows; the caller
/// decides the honest fallback (see [gardenNodeColor]).
Color? gardenTypeToken(String? type, KnowledgeGardenTokens tokens) {
  final GardenTypePalette types = tokens.types;
  switch (_normalize(type ?? "")) {
    case "person":
      return types.person;
    case "company":
      return types.company;
    case "project":
      return types.project;
    case "concept":
    case "atom": // web: atom → var(--t-concept)
      return types.concept;
    case "note":
    case "conversation": // web: conversation → var(--t-note)
      return types.note;
    case "source":
      return types.source;
    case "media":
      return types.media;
    default:
      return null;
  }
}

/// Web `GROUP_VAR`: a filter group's colour.
Color gardenGroupToken(GardenGroup group, KnowledgeGardenTokens tokens) {
  final GardenTypePalette types = tokens.types;
  switch (group) {
    case GardenGroup.people:
      return types.person;
    case GardenGroup.companies:
      return types.company;
    case GardenGroup.projects:
      return types.project;
    case GardenGroup.concepts:
    case GardenGroup.atoms: // web: atoms → var(--t-concept)
      return types.concept;
  }
}

/// Web `typeColor(node)` — the pure type → colour mapping, the mobile twin of:
///
/// ```ts
/// const direct = TYPE_VAR[(node.type ?? "").toLowerCase()];
/// if (direct) return direct;
/// const group = groupForNode(node);
/// return group ? GROUP_VAR[group] : "var(--muted-fg)";
/// ```
///
/// **Unknown types degrade honestly.** The web answers `var(--muted-fg)` — it
/// does not invent a colour for something it does not know, and neither does
/// this. That is the whole reason the mapping is a pure function over the token
/// set rather than a per-call-site switch: the fallback is part of the contract.
///
/// **One deliberate deviation, documented rather than hidden:** the web's direct
/// `TYPE_VAR` lookup lowercases but does *not* trim, while its group lookup
/// trims — so a whitespace-padded `" note "` degrades to `--muted-fg` on the web
/// purely by accident of that asymmetry. Both lookups trim here, so a padded
/// type resolves like the type it is. The plural/singular fold itself is
/// identical.
Color gardenNodeColor({
  String? type,
  String? slug,
  required KnowledgeGardenTokens tokens,
}) {
  final Color? direct = gardenTypeToken(type, tokens);
  if (direct != null) return direct;
  final GardenGroup? group = gardenGroupForNode(type: type, slug: slug);
  return group == null ? tokens.mutedForeground : gardenGroupToken(group, tokens);
}

String _normalize(String value) => value.trim().toLowerCase();
