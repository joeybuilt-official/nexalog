import "dart:async";
import "dart:convert";
import "dart:io";

import "package:path/path.dart" as p;
import "package:path_provider/path_provider.dart";
import "package:sqflite/sqflite.dart";

/// Local SQLite mirror. The mirror is the source of truth for the UI; the
/// server is the source of truth for conflicts. A single generic `mirror`
/// table holds the JSON row for every synced entity keyed by (entity, id),
/// so adding a new synced entity needs no schema migration — only a new
/// repository decoding the JSON. `sync_meta` holds the per-entity delta
/// cursor; `mutation_queue` holds idempotent offline writes (ADR-0001/0003).
class AppDb {
  AppDb._(this._db);

  final Database _db;
  Database get raw => _db;

  static AppDb? _instance;

  static Future<AppDb> open() async {
    if (_instance != null) return _instance!;
    final Directory dir = await getApplicationDocumentsDirectory();
    final String path = p.join(dir.path, "nexalog_offline.db");
    final Database db = await openDatabase(
      path,
      version: 1,
      onConfigure: (Database d) async {
        await d.execute("PRAGMA foreign_keys = ON");
      },
      onCreate: _onCreate,
    );
    _instance = AppDb._(db);
    return _instance!;
  }

  static Future<void> _onCreate(Database db, int version) async {
    await db.execute("""
      CREATE TABLE mirror (
        entity     TEXT NOT NULL,
        id         TEXT NOT NULL,
        json       TEXT NOT NULL,
        updated_at TEXT,
        PRIMARY KEY (entity, id)
      )
    """);
    await db.execute(
      "CREATE INDEX idx_mirror_entity ON mirror(entity, updated_at)",
    );
    await db.execute("""
      CREATE TABLE sync_meta (
        key   TEXT PRIMARY KEY,
        value TEXT
      )
    """);
    await db.execute("""
      CREATE TABLE mutation_queue (
        op_id      TEXT PRIMARY KEY,
        entity     TEXT NOT NULL,
        op         TEXT NOT NULL,
        target_id  TEXT,
        payload    TEXT NOT NULL,
        client_ts  TEXT NOT NULL,
        status     TEXT NOT NULL DEFAULT 'pending',
        attempts   INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      )
    """);
  }

  // ---- mirror ----------------------------------------------------------

  Future<void> upsertAll(
    String entity,
    List<Map<String, Object?>> rows, {
    String idKey = "id",
    String updatedKey = "updatedAt",
  }) async {
    if (rows.isEmpty) return;
    final Batch batch = _db.batch();
    for (final Map<String, Object?> row in rows) {
      final Object? id = row[idKey];
      if (id == null) continue;
      batch.insert(
        "mirror",
        <String, Object?>{
          "entity": entity,
          "id": id.toString(),
          "json": _encode(row),
          "updated_at": row[updatedKey]?.toString(),
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    }
    await batch.commit(noResult: true);
  }

  Future<void> deleteIds(String entity, List<String> ids) async {
    if (ids.isEmpty) return;
    final Batch batch = _db.batch();
    for (final String id in ids) {
      batch.delete(
        "mirror",
        where: "entity = ? AND id = ?",
        whereArgs: <Object?>[entity, id],
      );
    }
    await batch.commit(noResult: true);
  }

  Future<List<Map<String, Object?>>> readAll(String entity) async {
    final List<Map<String, Object?>> rows = await _db.query(
      "mirror",
      columns: <String>["json"],
      where: "entity = ?",
      whereArgs: <Object?>[entity],
    );
    return rows
        .map((Map<String, Object?> r) => _decode(r["json"] as String))
        .toList(growable: false);
  }

  Future<Map<String, Object?>?> readOne(String entity, String id) async {
    final List<Map<String, Object?>> rows = await _db.query(
      "mirror",
      columns: <String>["json"],
      where: "entity = ? AND id = ?",
      whereArgs: <Object?>[entity, id],
      limit: 1,
    );
    if (rows.isEmpty) return null;
    return _decode(rows.first["json"] as String);
  }

  /// Local optimistic write into the mirror so the UI reflects an offline edit
  /// before it drains. Keyed by (entity, id); merges over any existing row.
  Future<void> putLocal(String entity, Map<String, Object?> row) async {
    final Object? id = row["id"];
    if (id == null) return;
    await _db.insert(
      "mirror",
      <String, Object?>{
        "entity": entity,
        "id": id.toString(),
        "json": _encode(row),
        "updated_at": row["updatedAt"]?.toString(),
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<void> removeLocal(String entity, String id) =>
      deleteIds(entity, <String>[id]);

  // ---- sync cursor -----------------------------------------------------

  Future<String?> getCursor(String key) async {
    final List<Map<String, Object?>> rows = await _db.query(
      "sync_meta",
      columns: <String>["value"],
      where: "key = ?",
      whereArgs: <Object?>[key],
      limit: 1,
    );
    if (rows.isEmpty) return null;
    return rows.first["value"] as String?;
  }

  Future<void> setCursor(String key, String value) async {
    await _db.insert(
      "sync_meta",
      <String, Object?>{"key": key, "value": value},
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  String _encode(Map<String, Object?> row) => jsonEncode(row);
  Map<String, Object?> _decode(String json) =>
      Map<String, Object?>.from(jsonDecode(json) as Map);
}
