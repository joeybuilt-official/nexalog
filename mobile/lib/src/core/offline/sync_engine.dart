import "dart:async";

import "package:dio/dio.dart";

import "../api/api_client.dart";
import "app_db.dart";
import "mutation_queue.dart";

/// Connectivity-driven reconcile loop (ADR-0001): drain the mutation queue
/// (push intents) then pull the server delta (changed rows + tombstones)
/// since the stored cursor, upserting/deleting into the local mirror.
///
/// Delta contract (LWW for PKM, ADR-0003):
///   GET  /api/sync?since=<ISO|0>
///     → { serverTime, changes:{entity:[row]}, deletes:{entity:[id]}, nextSince, hasMore }
///   POST /api/sync/mutations  { ops:[...] }
///     → { results:[{opId, status:applied|rejected, row?}] }
class SyncEngine {
  SyncEngine(this._api, this._db, this._queue);

  final ApiClient _api;
  final AppDb _db;
  final MutationQueue _queue;

  static const String _cursorKey = "nexalog_since";
  static const String _pullPath = "/api/sync";
  static const String _pushPath = "/api/sync/mutations";

  bool _running = false;

  final StreamController<SyncStatus> _status =
      StreamController<SyncStatus>.broadcast();
  Stream<SyncStatus> get status => _status.stream;

  Future<void> sync() async {
    if (_running) return;
    _running = true;
    _status.add(SyncStatus.syncing);
    try {
      await _drainQueue();
      await _pullDelta();
      _status.add(SyncStatus.idle);
    } on DioException {
      // Offline / server unreachable: keep last-synced mirror, retry later.
      _status.add(SyncStatus.offline);
    } catch (_) {
      _status.add(SyncStatus.error);
    } finally {
      _running = false;
    }
  }

  Future<void> _drainQueue() async {
    final List<QueuedMutation> pending = await _queue.pending();
    if (pending.isEmpty) return;
    final Response<dynamic> res = await _api.post<dynamic>(
      _pushPath,
      data: <String, Object?>{
        "ops": pending.map((QueuedMutation m) => m.toWire()).toList(),
      },
    );
    final Map<String, Object?> body = _asMap(res.data);
    final List<Object?> results = (body["results"] as List<Object?>?) ?? const [];
    final Map<String, QueuedMutation> byOpId = <String, QueuedMutation>{
      for (final QueuedMutation m in pending) m.opId: m,
    };
    for (final Object? r in results) {
      final Map<String, Object?> result = _asMap(r);
      final String opId = result["opId"]?.toString() ?? "";
      final String status = result["status"]?.toString() ?? "rejected";
      if (opId.isEmpty) continue;
      final String? entity = byOpId[opId]?.entity;
      final Object? row = result["row"];
      if (row is Map && entity != null) {
        await _db.upsertAll(entity, <Map<String, Object?>>[
          Map<String, Object?>.from(row),
        ]);
      }
      if (status == "applied") {
        await _queue.markDone(opId);
      } else {
        // "rejected" is terminal (validation / out-of-scope / not-found) —
        // park it rather than retrying forever.
        await _queue.markConflict(
          opId,
          result["reason"]?.toString() ?? "rejected",
        );
      }
    }
  }

  Future<void> _pullDelta() async {
    bool hasMore = true;
    while (hasMore) {
      final String since = await _db.getCursor(_cursorKey) ?? "0";
      final Response<dynamic> res = await _api.get<dynamic>(
        _pullPath,
        query: <String, Object?>{"since": since},
      );
      final Map<String, Object?> body = _asMap(res.data);

      final Map<String, Object?> changes = _asMap(body["changes"]);
      for (final MapEntry<String, Object?> e in changes.entries) {
        final List<Object?> rows = (e.value as List<Object?>?) ?? const [];
        await _db.upsertAll(
          e.key,
          rows
              .map((Object? r) => Map<String, Object?>.from(r as Map))
              .toList(growable: false),
        );
      }

      final Map<String, Object?> deletes = _asMap(body["deletes"]);
      for (final MapEntry<String, Object?> e in deletes.entries) {
        final List<Object?> ids = (e.value as List<Object?>?) ?? const [];
        await _db.deleteIds(
          e.key,
          ids.map((Object? id) => id.toString()).toList(growable: false),
        );
      }

      final String? next = body["nextSince"]?.toString();
      if (next != null && next.isNotEmpty) {
        await _db.setCursor(_cursorKey, next);
      }
      hasMore = body["hasMore"] == true;
    }
  }

  Map<String, Object?> _asMap(Object? v) =>
      v is Map ? Map<String, Object?>.from(v) : <String, Object?>{};

  void dispose() => _status.close();
}

enum SyncStatus { idle, syncing, offline, error }
