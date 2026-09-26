// SPDX-License-Identifier: MIT
/**
 * `toCaptureDto` — the ONE place the untrusted worker proposal is turned into
 * the wire shape a non-web client consumes.
 *
 * The endpoint test covers the happy path end-to-end through the route; this
 * file pins the properties the route relies on and that are cheap to get wrong:
 * absent-versus-empty is unambiguous, nothing in the block can throw, and no
 * field of the source summary is dropped or renamed.
 */

import { describe, it, expect } from "vitest";
import type { CaptureSummary } from "@nexalog/core";
import { toCaptureDto } from "@/lib/captures/capture-dto";

function summary(over: Partial<CaptureSummary> = {}): CaptureSummary {
  return {
    id: "01M38ZNA67JAGSYCGSJDYDM3DD",
    title: "a capture",
    status: "review",
    kind: "note",
    source: "web",
    capturedAt: "2026-09-25T18:03:05.000Z",
    hasAttachments: false,
    proposal: null,
    ...over,
  } as CaptureSummary;
}

describe("toCaptureDto", () => {
  it("carries every scalar field through under the same names", () => {
    expect(toCaptureDto(summary({ hasAttachments: true, kind: "audio" }))).toEqual({
      id: "01M38ZNA67JAGSYCGSJDYDM3DD",
      title: "a capture",
      status: "review",
      kind: "audio",
      source: "web",
      capturedAt: "2026-09-25T18:03:05.000Z",
      hasAttachments: true,
      proposal: null,
    });
  });

  it("reports an absent proposal as null and an empty one as null too", () => {
    // Absent and empty are BOTH "nothing to show" — never an empty object that
    // a client would have to special-case.
    expect(toCaptureDto(summary({ proposal: null })).proposal).toBeNull();
    expect(toCaptureDto(summary({ proposal: {} })).proposal).toBeNull();
    expect(
      toCaptureDto(summary({ proposal: { pages: [], links: [], summary: "" } })).proposal,
    ).toBeNull();
  });

  it("normalizes the shapes the worker actually writes", () => {
    const dto = toCaptureDto(
      summary({
        proposal: {
          pages: ["people/jane-doe", { slug: "atoms/2026-09-25/lesson", title: "Lesson" }],
          links: ["people/jane-doe,concepts/pricing"],
          summary: "2 pages, 1 link",
          confidence: 0.31,
        },
      }),
    );

    expect(dto.proposal).not.toBeNull();
    expect(dto.proposal!.summary).toBe("2 pages, 1 link");
    expect(dto.proposal!.confidence).toBe(0.31);
    expect(dto.proposal!.pages.map((p) => p.slug)).toEqual([
      "people/jane-doe",
      "atoms/2026-09-25/lesson",
    ]);
    // Dir drives the client's type dot; the atom keeps its own label.
    expect(dto.proposal!.pages[1]).toMatchObject({ dir: "atoms", typeLabel: "Atom" });
    expect(dto.proposal!.links).toHaveLength(1);
    expect(dto.proposal!.links[0].to.slug).toBe("concepts/pricing");
    // The link target is a real Garden link the web surface can open.
    expect(dto.proposal!.links[0].from.href).toBe("/app/graph?slug=people%2Fjane-doe");
  });

  it("never throws on a hostile proposal, and keeps the row", () => {
    const hostile: unknown[] = [
      { pages: "not-an-array", links: 42 },
      { pages: [null, 7, [], {}, { slug: 5 }], links: [[], ["a"], { from: {}, to: {} }] },
      { confidence: Number.NaN, summary: 12345 },
      "a string",
      42,
      [],
    ];
    for (const proposal of hostile) {
      const dto = toCaptureDto(summary({ proposal: proposal as never }));
      expect(dto.id, JSON.stringify(proposal)).toBe("01M38ZNA67JAGSYCGSJDYDM3DD");
      // Either an empty block or a normalized one — never a throw.
      if (dto.proposal) expect(Array.isArray(dto.proposal.pages)).toBe(true);
    }
  });

  it("drops pages and links that cannot be rendered rather than sending dead entries", () => {
    const dto = toCaptureDto(
      summary({
        proposal: {
          pages: ["has space", "", { slug: "people/ok" }],
          links: [["people/ok"]],
          summary: "kept",
        },
      }),
    );
    expect(dto.proposal!.pages.map((p) => p.slug)).toEqual(["people/ok"]);
    expect(dto.proposal!.links).toEqual([]);
    expect(dto.proposal!.summary).toBe("kept");
  });
});
