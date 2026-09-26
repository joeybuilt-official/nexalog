import "dart:convert";

import "package:sqflite/sqflite.dart";

import "app_db.dart";

/// An offline write recorded as an intent (ADR-0001). PKM mutations apply
/// last-write-wins server-side by updatedAt; the queue is idempotent by opId.
class QueuedMutation {
  const QueuedMutation({
    required this.opId,
    required this.entity,
    required this.op,
    required this.targetId,
    required this.payload,
    required this.clientTs,
    this.status = "pending",
    this.attempts = 0,
  });

  final String opId;
  final String entity;
  final String op; // create | update | delete
  final String? targetId;
  final Map<String, Object?> payload;
  final String clientTs;
  final String status;
  final int attempts;

  Map<String, Object?> toWire() => <String, Object?>{
        "opId": opId,
        "entity": entity,
        "op": op,
        "id": targetId,
        "payload": payload,
        "clientTs": clientTs,
      };
}

class MutationQueue {
  MutationQueue(this._db);

  final AppDb _db;

  Future<void> enqueue(QueuedMutation m) async {
    await _db.raw.insert(
      "mutation_queue",
      <String, Object?>{
        "op_id": m.opId,
        "entity": m.entity,
        "op": m.op,
        "target_id": m.targetId,
        "payload": jsonEncode(m.payload),
        "client_ts": m.clientTs,
        "status": "pending",
        "attempts": 0,
      },
      conflictAlgorithm: ConflictAlgorithm.ignore, // idempotent by opId
    );
  }

  Future<List<QueuedMutation>> pending() async {
    final List<Map<String, Object?>> rows = await _db.raw.query(
      "mutation_queue",
      where: "status = ?",
      whereArgs: <Object?>["pending"],
      orderBy: "client_ts ASC",
    );
    return rows.map(_fromRow).toList(growable: false);
  }

  Future<int> pendingCount() async {
    final Object? c = (await _db.raw.rawQuery(
      "SELECT COUNT(*) AS c FROM mutation_queue WHERE status = 'pending'",
    ))
        .first["c"];
    return (c as int?) ?? 0;
  }

  Future<void> markDone(String opId) async {
    await _db.raw.delete(
      "mutation_queue",
      where: "op_id = ?",
      whereArgs: <Object?>[opId],
    );
  }

  Future<void> markFailed(String opId, String error) async {
    await _db.raw.rawUpdate(
      "UPDATE mutation_queue SET attempts = attempts + 1, last_error = ? WHERE op_id = ?",
      <Object?>[error, opId],
    );
  }

  Future<void> markConflict(String opId, String error) async {
    await _db.raw.update(
      "mutation_queue",
      <String, Object?>{"status": "conflict", "last_error": error},
      where: "op_id = ?",
      whereArgs: <Object?>[opId],
    );
  }

  QueuedMutation _fromRow(Map<String, Object?> r) => QueuedMutation(
        opId: r["op_id"] as String,
        entity: r["entity"] as String,
        op: r["op"] as String,
        targetId: r["target_id"] as String?,
        payload: Map<String, Object?>.from(
          jsonDecode(r["payload"] as String) as Map,
        ),
        clientTs: r["client_ts"] as String,
        status: r["status"] as String,
        attempts: r["attempts"] as int,
      );
}
