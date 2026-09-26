import "package:dio/dio.dart";

import "../auth/auth_store.dart";

/// Thin Dio wrapper that attaches the durable bearer token and centralizes the
/// Nexalog API base URL. better-auth endpoints live under /api/auth; app data
/// under /api/**. The mobile bearer token + /api/sync delta endpoints are
/// additive server-side (better-auth bearer plugin, ADR-0002).
class ApiClient {
  ApiClient(this._auth, {Dio? dio, String? baseUrl})
      : _dio = dio ??
            Dio(BaseOptions(
              baseUrl: baseUrl ?? defaultBaseUrl,
              connectTimeout: const Duration(seconds: 15),
              receiveTimeout: const Duration(seconds: 30),
              headers: const <String, Object?>{"accept": "application/json"},
            )) {
    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (RequestOptions options, RequestInterceptorHandler handler) async {
        final String? token = await _auth.readToken();
        if (token != null && token.isNotEmpty) {
          options.headers["authorization"] = "Bearer $token";
        }
        handler.next(options);
      },
    ));
  }

  static const String defaultBaseUrl = "https://nexalog.com";

  final Dio _dio;
  final AuthStore _auth;

  Dio get dio => _dio;

  Future<Response<T>> get<T>(String path, {Map<String, Object?>? query}) =>
      _dio.get<T>(path, queryParameters: query);

  Future<Response<T>> post<T>(String path, {Object? data}) =>
      _dio.post<T>(path, data: data);

  Future<Response<T>> patch<T>(String path, {Object? data}) =>
      _dio.patch<T>(path, data: data);

  Future<Response<T>> delete<T>(String path, {Object? data}) =>
      _dio.delete<T>(path, data: data);
}
