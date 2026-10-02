// SPDX-License-Identifier: MIT
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

/// Build a Material [ColorScheme] FROM the Knowledge Garden tokens.
///
/// WHY THIS REPLACES `ColorScheme.fromSeed`
/// ----------------------------------------
/// `fromSeed` runs Material's own tonal algorithm: it picks every value from one
/// seed hue and returns colours that exist nowhere in the web design system. The
/// garden tokens were registered alongside it as a `ThemeExtension`, so any widget
/// using `Theme.of(context).colorScheme` — which is most Material widgets, by
/// default — drew Material's palette, not Nexalog's. That is why the app read as
/// stock Material with a copper tint rather than as the web app.
///
/// This makes the garden tokens the ACTUAL colour scheme, so Material widgets
/// inherit Nexalog's paper/ink identity without every call site opting in.
ColorScheme nexalogColorScheme(KnowledgeGardenTokens t, Brightness brightness) {
  final ColorScheme base = brightness == Brightness.dark
      ? const ColorScheme.dark()
      : const ColorScheme.light();

  return base.copyWith(
    brightness: brightness,
    // Surfaces
    surface: t.surface,
    surfaceContainerLowest: t.background,
    surfaceContainerLow: t.surface,
    surfaceContainer: t.surface2,
    surfaceContainerHigh: t.surface2,
    surfaceContainerHighest: t.surface2,
    onSurface: t.foreground,
    onSurfaceVariant: t.mutedForeground,
    // The brand accent is the single interactive colour, in both slots. Material
    // expects primary != secondary; inventing a second hue to fill the slot would
    // be a colour the design system never chose.
    primary: t.accent,
    onPrimary: t.accentForeground,
    secondary: t.accent,
    onSecondary: t.accentForeground,
    // Accent-tinted containers so selected chips/segments carry the brand.
    primaryContainer: t.accent,
    onPrimaryContainer: t.accentForeground,
    secondaryContainer: t.surface2,
    onSecondaryContainer: t.foreground,
    // Lines and dividers
    outline: t.border,
    outlineVariant: t.border,
    // NOT in the garden set. Keep Material's own error so a failure state can
    // never be mistaken for a brand action.
    error: base.error,
    onError: base.onError,
    errorContainer: base.errorContainer,
    onErrorContainer: base.onErrorContainer,
    // `muted` is the web's dimmed interactor background (hover/pressed).
    surfaceTint: t.muted,
  );
}

ThemeData buildNexalogTheme(Brightness brightness) {
  final KnowledgeGardenTokens tokens = KnowledgeGardenTokens.forBrightness(brightness);
  final ColorScheme scheme = nexalogColorScheme(tokens, brightness);

  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    // The Knowledge Garden token set, readable as
    // `KnowledgeGardenTokens.of(context)`. Registered here so the tokens ride
    // the same ThemeData the rest of the app already uses — no second theming
    // mechanism. Now that `scheme` is built FROM the tokens, the two agree:
    // one source of colour truth instead of two.
    extensions: <ThemeExtension<dynamic>>[tokens],
    scaffoldBackgroundColor: tokens.background,
    appBarTheme: AppBarTheme(
      backgroundColor: tokens.background,
      foregroundColor: tokens.foreground,
      elevation: 0,
      scrolledUnderElevation: 0.5,
      centerTitle: false,
    ),
    listTileTheme: const ListTileThemeData(
      contentPadding: EdgeInsets.symmetric(horizontal: 16),
    ),
    dividerTheme: DividerThemeData(color: tokens.border, space: 1, thickness: 1),
    cardTheme: CardThemeData(
      color: tokens.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        side: BorderSide(color: tokens.border),
        borderRadius: BorderRadius.circular(12),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: tokens.background,
      indicatorColor: tokens.surface2,
      elevation: 0,
      labelTextStyle: WidgetStatePropertyAll<TextStyle>(
        TextStyle(color: tokens.mutedForeground, fontSize: 12),
      ),
    ),
    drawerTheme: DrawerThemeData(backgroundColor: tokens.background),
    iconTheme: IconThemeData(color: tokens.mutedForeground),
    bottomSheetTheme: BottomSheetThemeData(backgroundColor: tokens.surface),
    chipTheme: ChipThemeData(
      side: BorderSide(color: tokens.border),
      backgroundColor: tokens.surface2,
      labelStyle: TextStyle(color: tokens.foreground),
    ),
  );
}
