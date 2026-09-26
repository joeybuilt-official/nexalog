// SPDX-License-Identifier: MIT
//
// Wire-model tests for the capture review surface.
//
// What these guard: the shapes `GET /api/captures` actually returns, the
// degradations that must not crash the operator's screen (a missing proposal, a
// half-written proposal, an unknown field), and the stable-code error mapping —
// the UI branches on `code`, so a regression here would make the screen fall
// through to a generic message instead of naming what happened.

import "package:flutter_test/flutter_test.dart";
import "package:nexalog_mobile/src/features/captures/capture_review_models.dart";

void main() {
  test("CaptureInboxPage parses captures and per-status counts", () {
    final CaptureInboxPage page = CaptureInboxPage.fromJson(<String, Object?>{
      "captures": <Object?>[
        <String, Object?>{
          "id": "01M38ZNA67JAGSYCGSJDYDM3DD",
          "title": "voice note",
          "status": "review",
          "kind": "audio",
          "source": "pwa-share",
          "capturedAt": "2026-09-25T18:03:05.000Z",
          "hasAttachments": true,
          "proposal": <String, Object?>{
            "summary": "Extracted 1 person, 1 concept",
            "confidence": 0.42,
            "pages": <Object?>[
              <String, Object?>{
                "slug": "people/jane-doe",
                "dir": "people",
                "label": "Jane Doe",
                "type": "person",
                "typeLabel": "Person",
                "href": "/app/graph?slug=people%2Fjane-doe",
              },
            ],
            "links": <Object?>[
              <String, Object?>{
                "from": <String, Object?>{'slug': "people/jane-doe", 'label': "Jane Doe"},
                "to": <String, Object?>{'slug': "concepts/foo", 'label': "Foo"},
              },
            ],
          },
        },
      ],
      "counts": <String, Object?>{
        "inbox": 0,
        "processing": 0,
        "review": 3,
        "processed": 1,
        "rejected": 0,
      },
    });

    expect(page.captures, hasLength(1));
    expect(page.reviewCount, 3);
    final CaptureItem item = page.captures.first;
    expect(item.needsReview, isTrue);
    expect(item.hasAttachments, isTrue);
    final CaptureProposal? proposal = item.proposal;
    expect(proposal, isNotNull);
    expect(proposal!.summary, "Extracted 1 person, 1 concept");
    expect(proposal.confidence, closeTo(0.42, 0.0001));
    expect(proposal.hasContent, isTrue);
    expect(proposal.pages.single.label, "Jane Doe");
    expect(proposal.pages.single.typeLabel, "Person");
    expect(proposal.links.single.from.slug, "people/jane-doe");
    expect(proposal.links.single.to.slug, "concepts/foo");
  });

  test("a capture with no proposal parses with a null proposal, not an empty one", () {
    final CaptureItem item = CaptureItem.fromJson(<String, Object?>{
      "id": "01M38ZNA67JAGSYCGSJDYDM3DE",
      "title": "plain note",
      "status": "review",
      "kind": "note",
      "source": "web",
      "capturedAt": "2026-09-25T18:03:05.000Z",
      "proposal": null,
    });
    expect(item.proposal, isNull);
    expect(item.status, "review");
  });

  test("a malformed proposal degrades instead of throwing, dropping unusable entries", () {
    final CaptureProposal? proposal = CaptureProposal.fromJson(<String, Object?>{
      "summary": "still shown",
      "confidence": "not-a-number",
      "pages": <Object?>[
        "has space",
        7,
        <String, Object?>{},
        <String, Object?>{'slug': "people/jane-doe"},
      ],
      "links": <Object?>[
        "nope",
        <String, Object?>{'from': "x"},
        <String, Object?>{'from': <String, Object?>{}, 'to': <String, Object?>{}},
        <String, Object?>{
          'from': <String, Object?>{'slug': "people/jane-doe", 'label': "Jane Doe"},
          'to': <String, Object?>{'slug': "concepts/pricing", 'label': "Pricing"},
        },
      ],
    });
    expect(proposal, isNotNull);
    expect(proposal!.summary, "still shown");
    // A non-numeric confidence is reported as absent, never as 0.0 (which would
    // read as "the worker was certain").
    expect(proposal.confidence, isNull);
    // Only the entry that actually carries a slug survives; a string, a number
    // and a slug-less map are dropped rather than rendered as empty chips.
    expect(proposal.pages, hasLength(1));
    expect(proposal.pages.single.slug, "people/jane-doe");
    expect(proposal.links, hasLength(1));
    expect(proposal.links.single.to.slug, "concepts/pricing");
    expect(proposal.hasContent, isTrue);
  });

  test("a non-map proposal is reported as absent", () {
    expect(CaptureProposal.fromJson("nope"), isNull);
    expect(CaptureProposal.fromJson(null), isNull);
    expect(CaptureProposal.fromJson(42), isNull);
  });

  test("missing counts default to zero rather than crashing the header", () {
    final CaptureInboxPage page = CaptureInboxPage.fromJson(<String, Object?>{
      "captures": <Object?>[],
    });
    expect(page.reviewCount, 0);
    expect(page.captures, isEmpty);
  });

  test("CaptureDecisionError branches on code, carries the conflict statuses", () {
    const CaptureDecisionError conflict = CaptureDecisionError(
      code: "invalid_transition",
      status: 409,
      from: "processed",
      to: "processed",
    );
    expect(conflict.isConflict, isTrue);
    expect(conflict.isNotFound, isFalse);
    expect(conflict.message, contains("processed"));

    const CaptureDecisionError missing =
        CaptureDecisionError(code: "not_found", status: 404);
    expect(missing.isNotFound, isTrue);

    const CaptureDecisionError offline = CaptureDecisionError(code: "network");
    expect(offline.status, isNull);
    expect(offline.message, "Could not reach the server.");
  });

  test("an unknown failure code still yields an operator-readable message", () {
    const CaptureDecisionError unknown = CaptureDecisionError(code: "whatever");
    expect(unknown.message, "The decision could not be saved. Try again.");
  });
}
