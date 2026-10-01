// SPDX-License-Identifier: MIT
//
// Capture review models — the wire shape of `GET /api/captures` and
// `POST /api/captures/[id]/review`, parsed once, defensively.
//
// The server normalizes the worker-written `nexalog.proposal` block before it
// goes on the wire (`apps/web/lib/captures/capture-dto.ts`), so this client
// never has to interpret the raw frontmatter: `proposal` arrives either null or
// as a complete, typed block. Parsing here is still null-tolerant — a field the
// server stops sending must degrade, not crash the operator's screen.

/// One brain page inside a worker proposal.
class ProposalPage {
  const ProposalPage({
    required this.slug,
    this.dir = "",
    required this.label,
    this.type,
    this.typeLabel,
    this.href,
  });

  final String slug;
  final String dir;
  final String label;
  final String? type;
  final String? typeLabel;

  /// Web-surface path for the page; null when the slug was unlinkable and the
  /// page should render as a plain chip rather than a dead link.
  final String? href;

  factory ProposalPage.fromJson(Map<String, Object?> json) => ProposalPage(
        slug: json["slug"]?.toString() ?? "",
        dir: json["dir"]?.toString() ?? "",
        label: json["label"]?.toString() ?? "",
        type: json["type"]?.toString(),
        typeLabel: json["typeLabel"]?.toString(),
        href: json["href"]?.toString(),
      );
}

/// A link the worker proposed, as its two normalized endpoints.
class ProposalLink {
  const ProposalLink({required this.from, required this.to});

  final ProposalPage from;
  final ProposalPage to;
}

/// The worker's proposal for a capture, as the server normalized it.
class CaptureProposal {
  const CaptureProposal({
    this.summary,
    this.confidence,
    this.pages = const <ProposalPage>[],
    this.links = const <ProposalLink>[],
  });

  final String? summary;

  /// Worker confidence in 0..1 (the server clamps it), or null when absent.
  final double? confidence;
  final List<ProposalPage> pages;
  final List<ProposalLink> links;

  static CaptureProposal? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final Map<String, Object?> json = Map<String, Object?>.from(raw);
    final List<ProposalPage> pages = <ProposalPage>[];
    final Object? rawPages = json["pages"];
    if (rawPages is List) {
      for (final Object? entry in rawPages) {
        if (entry is! Map) continue;
        final ProposalPage page =
            ProposalPage.fromJson(Map<String, Object?>.from(entry));
        // A page with no slug cannot be identified or rendered — dropping it
        // beats painting an empty chip the operator cannot act on.
        if (page.slug.trim().isEmpty) continue;
        pages.add(page);
      }
    }
    final List<ProposalLink> links = <ProposalLink>[];
    final Object? rawLinks = json["links"];
    if (rawLinks is List) {
      for (final Object? entry in rawLinks) {
        if (entry is! Map) continue;
        final Map<String, Object?> pair = Map<String, Object?>.from(entry);
        final Object? from = pair["from"];
        final Object? to = pair["to"];
        if (from is! Map || to is! Map) continue;
        final ProposalLink link = ProposalLink(
          from: ProposalPage.fromJson(Map<String, Object?>.from(from)),
          to: ProposalPage.fromJson(Map<String, Object?>.from(to)),
        );
        if (link.from.slug.trim().isEmpty || link.to.slug.trim().isEmpty) continue;
        links.add(link);
      }
    }
    final Object? confidence = json["confidence"];
    return CaptureProposal(
      summary: (json["summary"]?.toString().trim().isEmpty ?? true)
          ? null
          : json["summary"]!.toString().trim(),
      confidence: confidence is num ? confidence.toDouble() : null,
      pages: pages,
      links: links,
    );
  }

  bool get hasContent =>
      (summary != null) || pages.isNotEmpty || links.isNotEmpty;
}

/// One capture as the API returns it.
class CaptureItem {
  const CaptureItem({
    required this.id,
    required this.title,
    required this.status,
    required this.kind,
    required this.source,
    required this.capturedAt,
    this.hasAttachments = false,
    this.proposal,
  });

  final String id;
  final String title;
  final String status;
  final String kind;
  final String source;
  final String capturedAt;
  final bool hasAttachments;
  final CaptureProposal? proposal;

  /// True when this capture is waiting on an operator decision.
  bool get needsReview => status == "review";

  factory CaptureItem.fromJson(Map<String, Object?> json) => CaptureItem(
        id: json["id"]?.toString() ?? "",
        title: json["title"]?.toString() ?? "",
        status: json["status"]?.toString() ?? "unknown",
        kind: json["kind"]?.toString() ?? "note",
        source: json["source"]?.toString() ?? "",
        capturedAt: json["capturedAt"]?.toString() ?? "",
        hasAttachments: json["hasAttachments"] == true,
        proposal: CaptureProposal.fromJson(json["proposal"]),
      );
}

/// The `GET /api/captures` payload: the page of captures plus per-status counts
/// over the whole inbox (not just the returned page).
class CaptureInboxPage {
  const CaptureInboxPage({required this.captures, required this.counts});

  final List<CaptureItem> captures;
  final Map<String, int> counts;

  int get reviewCount => counts["review"] ?? 0;

  factory CaptureInboxPage.fromJson(Map<String, Object?> json) {
    final List<CaptureItem> captures = <CaptureItem>[];
    final Object? rawCaptures = json["captures"];
    if (rawCaptures is List) {
      for (final Object? entry in rawCaptures) {
        if (entry is Map) {
          captures.add(CaptureItem.fromJson(Map<String, Object?>.from(entry)));
        }
      }
    }
    final Map<String, int> counts = <String, int>{};
    final Object? rawCounts = json["counts"];
    if (rawCounts is Map) {
      for (final MapEntry<Object?, Object?> e in rawCounts.entries) {
        final Object? value = e.value;
        if (value is int) counts[e.key.toString()] = value;
      }
    }
    return CaptureInboxPage(captures: captures, counts: counts);
  }
}

/// A failed decision, typed by the server's STABLE `code` — never by message
/// text (`.agents/rules/api-design.md`: clients branch on the code).
class CaptureDecisionError implements Exception {
  const CaptureDecisionError({
    required this.code,
    this.status,
    this.from,
    this.to,
  });

  /// Server code (`unauthorized`, `invalid_id`, `invalid_body`, `not_found`,
  /// `invalid_transition`, `review_failed`) or a local transport code
  /// (`network` when the request never reached the server, `unexpected`).
  final String code;

  /// HTTP status, or null when the request never got a response.
  final int? status;

  /// For `invalid_transition`: the status the capture is ACTUALLY in, and the
  /// one that was asked for. The row moved under the operator (another client,
  /// or the worker resolved it).
  final String? from;
  final String? to;

  bool get isConflict => code == "invalid_transition";
  bool get isNotFound => code == "not_found";

  /// Operator-facing sentence. Kept separate from [code] so the wording can
  /// change without breaking branching.
  String get message {
    switch (code) {
      case "unauthorized":
        return "Your session expired. Sign in again.";
      case "invalid_transition":
        return from == null
            ? "This capture is no longer awaiting review."
            : "This capture moved to \"$from\" — someone else already decided.";
      case "not_found":
        return "This capture no longer exists.";
      case "network":
        return "Could not reach the server.";
      default:
        return "The decision could not be saved. Try again.";
    }
  }
}

/// The successful outcome of a decision: the status the capture now carries.
class CaptureDecision {
  const CaptureDecision({required this.captureId, required this.status});

  final String captureId;
  final String status;
}
