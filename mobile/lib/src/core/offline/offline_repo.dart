import "dart:math";

import "package:flutter_riverpod/flutter_riverpod.dart";

import "../providers.dart";
import "app_db.dart";
import "mutation_queue.dart";
import "sync_engine.dart";

/// One-stop offline write: optimistically updates the local mirror, enqueues an
/// idempotent intent, bumps the mirror revision so the UI re-reads, then fires a
/// best-effort sync. Works fully offline — the intent drains on reconnect.
class OfflineRepo {
  OfflineRepo(this._db, this._queue, this._engine, this._ref);

  final AppDb _db;
  final MutationQueue _queue;
  final SyncEngine _engine;
  final Ref _ref;

  static final Random _rng = Random.secure();

  /// RFC4122-ish v4 UUID so client-minted ids reconcile with server rows.
  static String newId() {
    final List<int> b = List<int>.generate(16, (_) => _rng.nextInt(256));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    String h(int i) => b[i].toRadixString(16).padLeft(2, "0");
    return "${h(0)}${h(1)}${h(2)}${h(3)}-${h(4)}${h(5)}-${h(6)}${h(7)}-"
        "${h(8)}${h(9)}-${h(10)}${h(11)}${h(12)}${h(13)}${h(14)}${h(15)}";
  }

  Future<void> create(
    String entity, {
    required String id,
    required Map<String, Object?> payload,
    Map<String, Object?>? optimisticRow,
  }) =>
      _write(entity, "create", id, payload, optimisticRow ?? payload);

  Future<void> update(
    String entity, {
    required String id,
    required Map<String, Object?> payload,
    Map<String, Object?>? optimisticRow,
  }) =>
      _write(entity, "update", id, payload, optimisticRow);

  Future<void> delete(String entity, {required String id}) =>
      _write(entity, "delete", id, const <String, Object?>{}, null,
          removeLocal: true);

  Future<void> _write(
    String entity,
    String op,
    String id,
    Map<String, Object?> payload,
    Map<String, Object?>? optimisticRow, {
    bool removeLocal = false,
  }) async {
    final String nowIso = DateTime.now().toUtc().toIso8601String();
    if (removeLocal) {
      await _db.removeLocal(entity, id);
    } else if (optimisticRow != null) {
      final Map<String, Object?> row = <String, Object?>{
        "id": id,
        ...optimisticRow,
        "updatedAt": nowIso,
      };
      await _db.putLocal(entity, row);
    }
    await _queue.enqueue(QueuedMutation(
      opId: newId(),
      entity: entity,
      op: op,
      targetId: id,
      payload: payload,
      clientTs: nowIso,
    ));
    _ref.read(mirrorRevisionProvider.notifier).state++;
    // Best-effort immediate drain; ignored failures retry on reconnect.
    await _engine.sync();
    _ref.read(mirrorRevisionProvider.notifier).state++;
  }
}

final offlineRepoProvider = Provider<OfflineRepo>((Ref ref) => OfflineRepo(
      ref.watch(appDbProvider),
      ref.watch(mutationQueueProvider),
      ref.watch(syncEngineProvider),
      ref,
    ));
