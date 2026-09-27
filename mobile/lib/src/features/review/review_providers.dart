import "package:dio/dio.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";

import "../../core/api/api_client.dart";
import "../../core/api/surface_state.dart";
import "../../core/providers.dart";

/// One due card in the SM-2 spaced-review session.
class ReviewItem {
  ReviewItem(this.raw);
  final Map<String, Object?> raw;

  String get id => raw["id"]?.toString() ?? "";
  String get captureId => raw["captureId"]?.toString() ?? "";
  String get title {
    final String? t = raw["title"]?.toString();
    if (t != null && t.trim().isNotEmpty) return t.trim();
    return raw["host"]?.toString() ?? captureId;
  }
  String? get host => raw["host"]?.toString();
  String? get summary => raw["summary"]?.toString();
  String? get kind => raw["kind"]?.toString();
  String? get themeLabel => raw["themeLabel"]?.toString();
  bool get isNew => raw["isNew"] == true;
}

/// The P7 spaced-review surface (`/api/review` → `review_schedule`).
///
/// Failures are classified as [SurfaceError] rather than stringified or
/// swallowed, so the screen can tell an unloadable queue apart from an empty
/// one without assuming anything about what the backend currently serves:
///   - `load()` throws so the screen renders the honest panel instead of
///     "All caught up!" — a queue that could not be read and a queue with
///     nothing due are different facts and must not look the same.
///   - `grade()` throws too. It used to drop the failure silently and let the
///     session advance, which loses the operator's answer without telling them;
///     the screen now keeps the card and says why.
/// A deployment that serves the surface normally never produces either state.
class ReviewRepo {
  ReviewRepo(this._api);
  final ApiClient _api;

  Future<List<ReviewItem>> load() async {
    try {
      final Response<dynamic> res = await _api.get<dynamic>("/api/review");
      final Map<String, Object?> body = res.data is Map
          ? Map<String, Object?>.from(res.data as Map)
          : <String, Object?>{};
      final List<Object?> items = (body["items"] as List<Object?>?) ?? const [];
      return items
          .map((Object? e) => ReviewItem(Map<String, Object?>.from(e as Map)))
          .toList(growable: false);
    } on DioException catch (e) {
      throw SurfaceError.fromDio(e, surface: "Spaced review");
    }
  }

  Future<void> grade(String captureId, int grade) async {
    try {
      await _api.post<dynamic>(
        "/api/review",
        data: <String, Object?>{"captureId": captureId, "grade": grade},
      );
    } on DioException catch (e) {
      throw SurfaceError.fromDio(e, surface: "Spaced review");
    }
  }
}

final reviewRepoProvider =
    Provider<ReviewRepo>((Ref ref) => ReviewRepo(ref.watch(apiClientProvider)));

final reviewProvider = FutureProvider<List<ReviewItem>>((Ref ref) async {
  ref.watch(mirrorRevisionProvider);
  return ref.watch(reviewRepoProvider).load();
});
