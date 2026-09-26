import "package:flutter/material.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";

import "src/app.dart";
import "src/core/offline/app_db.dart";
import "src/core/providers.dart";

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final AppDb db = await AppDb.open();
  runApp(
    ProviderScope(
      overrides: <Override>[appDbProvider.overrideWithValue(db)],
      child: const NexalogApp(),
    ),
  );
}
