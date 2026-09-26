import "package:dio/dio.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";

import "../api/api_client.dart";
import "../providers.dart";
import "auth_store.dart";

enum AuthPhase { unknown, signedOut, signedIn }

class AuthState {
  const AuthState({required this.phase, this.email, this.error, this.busy = false});

  final AuthPhase phase;
  final String? email;
  final String? error;
  final bool busy;

  AuthState copyWith({
    AuthPhase? phase,
    String? email,
    String? error,
    bool? busy,
  }) =>
      AuthState(
        phase: phase ?? this.phase,
        email: email ?? this.email,
        error: error,
        busy: busy ?? this.busy,
      );
}

/// Email/password sign-in/up against better-auth, then captures the durable
/// mobile bearer token from the `set-auth-token` response header (ADR-0002).
/// The token persists in secure storage so the app is offline-capable on next
/// launch.
class AuthController extends StateNotifier<AuthState> {
  AuthController(this._api, this._auth)
      : super(const AuthState(phase: AuthPhase.unknown)) {
    _restore();
  }

  final ApiClient _api;
  final AuthStore _auth;

  Future<void> _restore() async {
    final String? token = await _auth.readToken();
    final String? email = await _auth.readEmail();
    state = AuthState(
      phase: (token != null && token.isNotEmpty)
          ? AuthPhase.signedIn
          : AuthPhase.signedOut,
      email: email,
    );
  }

  Future<void> signIn(String email, String password) =>
      _authenticate(email, password, "/api/auth/sign-in/email", null);

  Future<void> signUp(String email, String password, {String? name}) =>
      _authenticate(email, password, "/api/auth/sign-up/email", name);

  Future<void> _authenticate(
    String email,
    String password,
    String path,
    String? name,
  ) async {
    state = state.copyWith(busy: true, error: null);
    try {
      final Response<dynamic> res = await _api.post<dynamic>(
        path,
        data: <String, Object?>{
          "email": email,
          "password": password,
          if (name != null) "name": name.isEmpty ? email : name,
        },
      );
      final String token = _extractBearer(res);
      await _auth.writeToken(token);
      await _auth.writeEmail(email);
      state = AuthState(phase: AuthPhase.signedIn, email: email);
    } on DioException catch (e) {
      state = state.copyWith(busy: false, error: _message(e));
    } catch (e) {
      state = state.copyWith(busy: false, error: e.toString());
    }
  }

  /// better-auth's bearer plugin returns the durable session token in the
  /// `set-auth-token` response header on sign-in (ADR-0002).
  String _extractBearer(Response<dynamic> res) {
    final String? token = res.headers.value("set-auth-token");
    if (token != null && token.isNotEmpty) return token;
    throw StateError("sign-in did not return a bearer token");
  }

  Future<void> signOut() async {
    await _auth.clear();
    try {
      await _api.post<dynamic>("/api/auth/sign-out");
    } on DioException {
      // best-effort server revoke; local token already cleared.
    }
    state = const AuthState(phase: AuthPhase.signedOut);
  }

  String _message(DioException e) {
    final Object? data = e.response?.data;
    if (data is Map && data["message"] is String) {
      return data["message"] as String;
    }
    if (e.response?.statusCode == 401) return "Incorrect email or password.";
    return "Couldn't sign in. Check your connection and try again.";
  }
}

final authControllerProvider =
    StateNotifierProvider<AuthController, AuthState>((Ref ref) {
  return AuthController(
    ref.watch(apiClientProvider),
    ref.watch(authStoreProvider),
  );
});
