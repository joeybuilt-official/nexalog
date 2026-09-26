import "package:flutter/material.dart";

import "knowledge_garden_tokens.dart";

/// Nexalog copper accent — globals.css `.dark` `--accent: #c07040`.
///
/// Kept as the name the app already imports everywhere; its value is now the
/// Knowledge Garden token rather than a literal of its own, so there is exactly
/// one place a colour is defined
/// (`lib/src/theme/knowledge_garden_tokens.dart`, the file the enforcement test
/// exempts).
const Color kCopper = KnowledgeGardenTokens.copperSeed;

ThemeData buildNexalogTheme(Brightness brightness) {
  final KnowledgeGardenTokens tokens = KnowledgeGardenTokens.forBrightness(brightness);
  final ColorScheme scheme = ColorScheme.fromSeed(
    seedColor: kCopper,
    brightness: brightness,
  );
  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    // The Knowledge Garden token set, readable as
    // `KnowledgeGardenTokens.of(context)`. Registered here so the tokens ride
    // the same ThemeData the rest of the app already uses — no second theming
    // mechanism.
    extensions: <ThemeExtension<dynamic>>[tokens],
    scaffoldBackgroundColor: scheme.surface,
    appBarTheme: AppBarTheme(
      backgroundColor: scheme.surface,
      foregroundColor: scheme.onSurface,
      elevation: 0,
      scrolledUnderElevation: 0.5,
      centerTitle: false,
    ),
    listTileTheme: const ListTileThemeData(
      contentPadding: EdgeInsets.symmetric(horizontal: 16),
    ),
    chipTheme: ChipThemeData(
      side: BorderSide(color: scheme.outlineVariant),
      backgroundColor: scheme.surfaceContainerHighest.withValues(alpha: 0.4),
    ),
  );
}
