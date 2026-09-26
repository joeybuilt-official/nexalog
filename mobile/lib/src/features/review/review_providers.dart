import "package:dio/dio.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";

import "../../core/api/api_client.dart";
import "../../core/providers.dart";

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

class ReviewRepo {
  ReviewRepo(this._api);
  final ApiClient _api;

  Future<List<ReviewItem>> load() async {
    final Response<dynamic> res = await _api.get<dynamic>("/api/review");
    final Map<String, Object?> body =
        res.data is Map ? Map<String, Object?>.from(res.data as Map) : <String, Object?>{};
    final List<Object?> items = (body["items"] as List<Object?>?) ?? const [];
    return items
        .map((Object? e) => ReviewItem(Map<String, Object?>.from(e as Map)))
        .toList(growable: false);
  }

  Future<void> grade(String captureId, int grade) async {
    try {
      await _api.post<dynamic>(
        "/api/review",
        data: <String, Object?>{"captureId": captureId, "grade": grade},
      );
    } on DioException {
      // best-effort: offline grade is silently dropped
    }
  }
}

final reviewRepoProvider =
    Provider<ReviewRepo>((Ref ref) => ReviewRepo(ref.watch(apiClientProvider)));

final reviewProvider = FutureProvider<List<ReviewItem>>((Ref ref) async {
  ref.watch(mirrorRevisionProvider);
  return ref.watch(reviewRepoProvider).load();
});
