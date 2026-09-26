import "package:connectivity_plus/connectivity_plus.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";

import "api/api_client.dart";
import "auth/auth_store.dart";
import "offline/app_db.dart";
import "offline/mutation_queue.dart";
import "offline/sync_engine.dart";

/// Overridden in main() with the opened database.
final appDbProvider = Provider<AppDb>(
  (Ref ref) => throw StateError("appDbProvider must be overridden in main()"),
);

final authStoreProvider = Provider<AuthStore>((Ref ref) => AuthStore());

final apiClientProvider = Provider<ApiClient>(
  (Ref ref) => ApiClient(ref.watch(authStoreProvider)),
);

final mutationQueueProvider = Provider<MutationQueue>(
  (Ref ref) => MutationQueue(ref.watch(appDbProvider)),
);

final syncEngineProvider = Provider<SyncEngine>((Ref ref) {
  final SyncEngine engine = SyncEngine(
    ref.watch(apiClientProvider),
    ref.watch(appDbProvider),
    ref.watch(mutationQueueProvider),
  );
  ref.onDispose(engine.dispose);
  return engine;
});

/// Live online/offline signal. Seeds true, then reflects connectivity changes.
final connectivityProvider = StreamProvider<bool>((Ref ref) async* {
  final Connectivity connectivity = Connectivity();
  bool online(List<ConnectivityResult> r) =>
      r.any((ConnectivityResult c) => c != ConnectivityResult.none);
  yield online(await connectivity.checkConnectivity());
  yield* connectivity.onConnectivityChanged.map(online);
});

final pendingMutationCountProvider = FutureProvider<int>(
  (Ref ref) => ref.watch(mutationQueueProvider).pendingCount(),
);

/// Bumps to force mirror-backed providers to re-read after a sync or local
/// write. Watch it in any FutureProvider that reads the local mirror.
final mirrorRevisionProvider = StateProvider<int>((Ref ref) => 0);
