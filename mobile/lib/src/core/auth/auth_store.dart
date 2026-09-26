import "package:flutter_secure_storage/flutter_secure_storage.dart";

/// Durable, revocable bearer token in the Android Keystore-backed secure
/// store (ADR-0002). Survives restarts; used for headless background sync.
class AuthStore {
  AuthStore([FlutterSecureStorage? storage])
      : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  static const String _tokenKey = "nexalog_bearer_token";
  static const String _emailKey = "nexalog_user_email";
  static const String _workspaceKey = "nexalog_active_workspace";

  Future<String?> readToken() => _storage.read(key: _tokenKey);

  Future<void> writeToken(String token) =>
      _storage.write(key: _tokenKey, value: token);

  Future<String?> readEmail() => _storage.read(key: _emailKey);

  Future<void> writeEmail(String email) =>
      _storage.write(key: _emailKey, value: email);

  Future<String?> readWorkspace() => _storage.read(key: _workspaceKey);

  Future<void> writeWorkspace(String id) =>
      _storage.write(key: _workspaceKey, value: id);

  Future<void> clear() async {
    await _storage.delete(key: _tokenKey);
    await _storage.delete(key: _emailKey);
    await _storage.delete(key: _workspaceKey);
  }
}
