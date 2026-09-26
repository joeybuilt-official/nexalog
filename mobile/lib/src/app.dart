import "package:flutter/material.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";

import "router.dart";
import "theme/app_theme.dart";

/// Light/dark toggle (web parity: sidebar theme toggle). Defaults to system.
final themeModeProvider = StateProvider<ThemeMode>((Ref ref) => ThemeMode.system);

class NexalogApp extends ConsumerWidget {
  const NexalogApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: "Nexalog",
      debugShowCheckedModeBanner: false,
      theme: buildNexalogTheme(Brightness.light),
      darkTheme: buildNexalogTheme(Brightness.dark),
      themeMode: ref.watch(themeModeProvider),
      routerConfig: ref.watch(routerProvider),
    );
  }
}
