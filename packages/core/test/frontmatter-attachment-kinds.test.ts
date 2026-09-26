// SPDX-License-Identifier: MIT
/**
 * Frontmatter contract — per-attachment kinds round-trip.
 *
 * `attachments:` stays the list of relative paths it has always been (the
 * Hermes worker reads paths; the DB index stores paths). The per-file kind
 * rides alongside it in `attachment_kinds:`, index-aligned with `attachments:`,
 * so a mixed capture can say "attachment 0 is audio, attachment 1 is a photo"
 * without changing the shape every existing reader depends on.
 *
 * Backward compatibility is part of the contract, not an accident: a file
 * written before this field existed (or one hand-edited by the worker) has no
 * `attachment_kinds`, and every attachment then falls back to the capture-level
 * kind — which is exactly what `parseCapture` did before.
 */

import { describe, it, expect } from "vitest";
import { serializeCapture, parseCapture, CAPTURE_SCHEMA_VERSION } from "../src/contracts/frontmatter";
import type { CaptureState } from "../src/domain/capture";
import { Ulid } from "../src/domain/ulid";

const ID = Ulid.of("0123456789ABCDEFGHJKMNPQRS");

function state(overrides: Partial<CaptureState> = {}): CaptureState {
  return {
    id: ID,
    title: "Mixed capture",
    body: "",
    type: "note",
    status: "inbox",
    kind: "audio",
    source: "web",
    capturedAt: new Date("2026-09-23T06:41:00Z"),
    claimedBy: null,
    claimedAt: null,
    attachments: [],
    originUrl: null,
    proposal: null,
    ...overrides,
  };
}

describe("frontmatter — attachment kinds", () => {
  it("serializes one kind per attachment, in path order", () => {
    const text = serializeCapture(
      state({
        attachments: [
          { path: "attachments/2026/09/voice.opus", kind: "audio", sizeBytes: 742 },
          { path: "attachments/2026/09/photo.jpg", kind: "image", sizeBytes: 225 },
          { path: "attachments/2026/09/paper.pdf", kind: "doc", sizeBytes: 193 },
        ],
      }),
    );

    expect(text).toMatch(/attachments:\n(?:\s+- "[^"]+"\n)+/);
    expect(text).toMatch(
      /attachment_kinds:\n\s+- "audio"\n\s+- "image"\n\s+- "doc"\n/,
    );
  });

  it("parses the kinds back, per attachment", () => {
    const parsed = parseCapture(
      ID,
      {
        type: "note",
        title: "Mixed capture",
        nexalog: {
          schema: CAPTURE_SCHEMA_VERSION,
          status: "inbox",
          kind: "audio",
          source: "web",
          captured_at: "2026-09-23T06:41:00.000Z",
          claimed_by: null,
          claimed_at: null,
          attachments: ["attachments/2026/09/voice.opus", "attachments/2026/09/photo.jpg"],
          attachment_kinds: ["audio", "image"],
          origin_url: null,
          proposal: null,
        },
      },
      "",
    );

    expect(parsed.attachments.map((a) => a.path)).toEqual([
      "attachments/2026/09/voice.opus",
      "attachments/2026/09/photo.jpg",
    ]);
    expect(parsed.attachments.map((a) => a.kind)).toEqual(["audio", "image"]);
  });

  it("falls back to the capture kind when a file predates the field (legacy v1)", () => {
    const parsed = parseCapture(
      ID,
      {
        type: "note",
        title: "Legacy",
        nexalog: {
          schema: CAPTURE_SCHEMA_VERSION,
          status: "inbox",
          kind: "audio",
          source: "pwa-share",
          captured_at: "2026-09-23T06:41:00.000Z",
          claimed_by: null,
          claimed_at: null,
          attachments: ["attachments/2026/09/x.opus"],
          origin_url: null,
          proposal: null,
        },
      },
      "",
    );

    expect(parsed.attachments).toEqual([
      { path: "attachments/2026/09/x.opus", kind: "audio", sizeBytes: 0 },
    ]);
  });

  it("falls back per entry when the kind list is short or malformed", () => {
    const parsed = parseCapture(
      ID,
      {
        type: "note",
        title: "Sloppy",
        nexalog: {
          schema: CAPTURE_SCHEMA_VERSION,
          status: "inbox",
          kind: "note",
          source: "mcp",
          captured_at: "2026-09-23T06:41:00.000Z",
          claimed_by: null,
          claimed_at: null,
          attachments: ["attachments/a.opus", "attachments/b.jpg", "attachments/c.pdf"],
          attachment_kinds: ["image", "nonsense"],
          origin_url: null,
          proposal: null,
        },
      },
      "",
    );

    expect(parsed.attachments.map((a) => a.kind)).toEqual(["image", "note", "note"]);
  });

  it("keeps the capture-level kind untouched by the attachment kinds", () => {
    const text = serializeCapture(
      state({
        kind: "link",
        originUrl: "https://example.com",
        attachments: [{ path: "attachments/2026/09/photo.jpg", kind: "image", sizeBytes: 225 }],
      }),
    );
    expect(text).toContain('kind: "link"');
    expect(text).toMatch(/attachment_kinds:\n\s+- "image"\n/);
  });

  it("an attachment-free capture serializes an empty kind list, never a stray entry", () => {
    const text = serializeCapture(state({ kind: "note", body: "hi" }));
    expect(text).toMatch(/attachments: \[\]/);
    expect(text).toMatch(/attachment_kinds: \[\]/);
  });
});
