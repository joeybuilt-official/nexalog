// SPDX-License-Identifier: MIT
/**
 * CreateCapture — attachment-kind derivation (Bug A) and per-file isolation (Bug B).
 *
 * `execute()` used to derive no kind from the file itself: `kind` began as
 * `input.kind ?? "note"`, became `"link"` for a URL, and only ever became
 * `"audio"` — inside the attachment loop, by REASSIGNING the capture-level
 * variable. Two consequences, both pinned by these tests:
 *
 *   A. a JPEG/PNG attachment landed with attachment AND capture kind `note`,
 *      never `image`, so `CaptureKind`'s `image`/`doc` members were dead and the
 *      worker could not tell a photo from a text note;
 *   B. because the loop reassigned the shared `kind`, the next iteration's
 *      condition (`mimeType?.startsWith("audio/") || kind === "audio"`) was true
 *      for EVERY subsequent file — a JPEG after a voice memo was handed to
 *      ffmpeg as audio and mislabelled `audio`.
 *
 * Pure in-process tests: `BrainStore` / `IdGen` / `Clock` / `Transcoder` are all
 * faked, so nothing here touches fs, git, or ffmpeg (see testing.md — "testable
 * with no database, no HTTP, no framework boot"). The real-byte end-to-end proof
 * lives in `packages/adapters/test/capture-kinds-e2e.test.ts`.
 *
 * Documented capture-level rule (asserted below):
 *   1. a `url` capture is `link`, attachments or not;
 *   2. otherwise, with attachments, the capture kind is the strongest DERIVED
 *      attachment kind under the precedence `audio > image > doc > file`
 *      (an explicit `input.kind` does NOT override the file's own evidence —
 *      the worker's processing path keys off `kind`, so a caller defaulting to
 *      `note` must not be able to hide a voice memo or a photo);
 *   3. otherwise a text capture is `input.kind ?? "note"`.
 */

import { describe, it, expect, vi } from "vitest";

import { CreateCapture, type CreateCaptureInput } from "../src/application/create-capture";
import { Capture, type CaptureState } from "../src/domain/capture";
import type { BrainStore, Clock, IdGen, Transcoder } from "../src/ports";
import { Ulid } from "../src/domain/ulid";
import { Slug } from "../src/domain/slug";

// ── real file bytes ────────────────────────────────────────────────────────

/** A real 8×8 RGB PNG (IHDR/IDAT/IEND, valid CRCs) — the shape a phone photo lands as. */
const PNG_BYTES = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAJUlEQVR42mNgYGBQUFBwcHBISEhoaGhYsGDBgQMHHjx4wDC0JABYmVQBndcjhQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

/** A real baseline JPEG (16×16, re-encoded) — same bytes the browser sends for `image/jpeg`. */
const JPEG_BYTES = new Uint8Array(
  Buffer.from(
    "/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYxLjE5LjEwMQD/2wBDAAgKCgsKCw0NDQ0NDRAPEBAQEBAQEBAQEBASEhIVFRUSEhIQEBISFBQVFRcXFxUVFRUXFxkZGR4eHBwjIyQrKzP/xABMAAEBAAAAAAAAAAAAAAAAAAAABgEBAQAAAAAAAAAAAAAAAAAABgcQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAAQABADASIAAhEAAxEA/9oADAMBAAIRAxEAPwCLAFF/f//Z",
    "base64",
  ),
);

/** A real RIFF/WAVE PCM file: 44-byte canonical header + 0.1 s of 440 Hz @ 8 kHz mono. */
function makeWav(): Uint8Array {
  const sampleRate = 8000;
  const samples = 800; // 0.1 s
  const data = new Uint8Array(samples * 2);
  for (let i = 0; i < samples; i++) {
    const sample = Math.round(12000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate));
    new DataView(data.buffer).setInt16(i * 2, sample, true);
  }
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) header[offset + i] = s.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + data.length, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, data.length, true);
  return new Uint8Array(Buffer.concat([Buffer.from(header), Buffer.from(data)]));
}

const WAV_BYTES = makeWav();
const PDF_BYTES = new Uint8Array(Buffer.from("%PDF-1.4\n%%EOF\n", "utf8"));

// ── fakes ──────────────────────────────────────────────────────────────────

class FakeBrainStore implements BrainStore {
  readonly captures: CaptureState[] = [];
  readonly attachmentCalls: Array<{ name: string; kind: string; bytes: Uint8Array }> = [];

  async saveCapture(capture: Capture): Promise<void> {
    this.captures.push(capture.state);
  }
  async getCapture(): Promise<CaptureState | null> {
    return null;
  }
  async listCaptures(): Promise<CaptureState[]> {
    return [];
  }
  async updateCapture(): Promise<void> {
    throw new Error("not used");
  }
  async getPage(): Promise<{ slug: Slug; frontmatter: Record<string, unknown>; body: string } | null> {
    return null;
  }
  async savePage(): Promise<void> {
    throw new Error("not used");
  }
  async saveAttachment(input: { name: string; kind: string; bytes: Uint8Array }) {
    const ext = input.name.includes(".") ? input.name.slice(input.name.lastIndexOf(".")) : ".bin";
    const path = `attachments/2026/09/a${this.attachmentCalls.length}${ext}`;
    this.attachmentCalls.push({ name: input.name, kind: input.kind, bytes: input.bytes });
    return { path };
  }
}

const ID = "0123456789ABCDEFGHJKMNPQRS";

function makeUseCase() {
  const store = new FakeBrainStore();
  const ids: IdGen = {
    newUlid: () => Ulid.of(ID),
    newCapturedAt: () => new Date("2026-09-23T06:41:00Z"),
  };
  const clock: Clock = { now: () => new Date("2026-09-23T06:41:00Z") };
  const toOpus = vi.fn(async (bytes: Uint8Array) => new Uint8Array([...bytes, 0xff]));
  const transcoder: Transcoder = { toOpus };
  const useCase = new CreateCapture(store, ids, clock, transcoder);
  return { store, useCase, toOpus };
}

function file(name: string, mimeType: string | undefined, bytes: Uint8Array) {
  return { name, mimeType, bytes };
}

async function capture(input: Partial<CreateCaptureInput> = {}) {
  const harness = makeUseCase();
  await harness.useCase.execute({ source: "web", ...input } as CreateCaptureInput);
  const state = harness.store.captures[0];
  return { ...harness, state };
}

// ── Bug A: the kind comes from the file, per file ─────────────────────────

describe("CreateCapture — attachment kind is derived from the file", () => {
  it("image-only capture: attachment and capture kind are `image`, no transcode", async () => {
    const { store, toOpus, state } = await capture({
      files: [file("photo.jpg", "image/jpeg", JPEG_BYTES)],
    });

    expect(state.kind).toBe("image");
    expect(state.attachments).toHaveLength(1);
    expect(state.attachments[0].kind).toBe("image");
    expect(store.attachmentCalls[0].kind).toBe("image");
    expect(toOpus).not.toHaveBeenCalled();
  });

  it("png with image/png is `image` too (the browser sends the full type)", async () => {
    const { state } = await capture({ files: [file("shot.png", "image/png", PNG_BYTES)] });
    expect(state.kind).toBe("image");
    expect(state.attachments[0].kind).toBe("image");
  });

  it("audio-only capture: `audio`, and the transcoder ran exactly once", async () => {
    const { toOpus, state } = await capture({
      files: [file("voice.m4a", "audio/mp4", WAV_BYTES)],
    });

    expect(state.kind).toBe("audio");
    expect(state.attachments[0].kind).toBe("audio");
    expect(toOpus).toHaveBeenCalledTimes(1);
    // the SAVED bytes are the transcoded ones, not the input
    expect(state.attachments[0].sizeBytes).toBe(WAV_BYTES.length + 1);
  });

  it("document types are `doc`: pdf, txt, md, csv", async () => {
    for (const [name, mime] of [
      ["paper.pdf", "application/pdf"],
      ["notes.txt", "text/plain"],
      ["readme.md", "text/markdown"],
      ["rows.csv", "text/csv"],
    ] as const) {
      const { state } = await capture({ files: [file(name, mime, PDF_BYTES)] });
      expect(state.kind, name).toBe("doc");
      expect(state.attachments[0].kind, name).toBe("doc");
    }
  });

  it("falls back to the extension when the MIME type is missing or generic", async () => {
    const cases: Array<[string, string | undefined, string]> = [
      ["clip.m4a", undefined, "audio"],
      ["clip.aac", "application/octet-stream", "audio"],
      ["photo.jpg", undefined, "image"],
      ["photo.HEIC", "application/octet-stream", "image"],
      ["paper.pdf", undefined, "doc"],
      ["sheet.xlsx", "", "doc"],
    ];
    for (const [name, mime, expected] of cases) {
      const { state } = await capture({ files: [file(name, mime, PDF_BYTES)] });
      expect(state.attachments[0].kind, `${name} (${String(mime)})`).toBe(expected);
      expect(state.kind, `${name} (${String(mime)})`).toBe(expected);
    }
  });

  it("an unknown binary is `file`", async () => {
    const { state } = await capture({
      files: [file("firmware.bin", undefined, new Uint8Array([0x00, 0x01, 0x02, 0xff]))],
    });
    expect(state.kind).toBe("file");
    expect(state.attachments[0].kind).toBe("file");
  });

  it("the MIME type wins over a misleading extension", async () => {
    const { state } = await capture({
      files: [file("mislabelled.jpg", "audio/mpeg", WAV_BYTES)],
    });
    expect(state.attachments[0].kind).toBe("audio");
  });

  it("a MIME parameter list does not defeat the match", async () => {
    const { state } = await capture({
      files: [file("clip.wav", "audio/wav; codecs=1", WAV_BYTES)],
    });
    expect(state.attachments[0].kind).toBe("audio");
  });
});

// ── Bug B: one file's kind must never leak into the next ──────────────────

describe("CreateCapture — per-file kind isolation (Bug B regression)", () => {
  it("mixed [audio, image]: the transcoder runs ONCE, and the image stays `image`", async () => {
    const { toOpus, store, state } = await capture({
      files: [
        file("voice.m4a", "audio/mp4", WAV_BYTES),
        file("photo.jpg", "image/jpeg", JPEG_BYTES),
      ],
    });

    // The JPEG must NOT be run through ffmpeg — the exact bug this pins.
    expect(toOpus).toHaveBeenCalledTimes(1);
    expect(toOpus.mock.calls[0][0]).toEqual(WAV_BYTES);

    expect(store.attachmentCalls.map((c) => c.kind)).toEqual(["audio", "image"]);
    // the image was written byte-for-byte
    expect(store.attachmentCalls[1].bytes).toEqual(JPEG_BYTES);

    expect(state.attachments.map((a) => a.kind)).toEqual(["audio", "image"]);
    expect(state.attachments[1].sizeBytes).toBe(JPEG_BYTES.length);
    expect(state.kind).toBe("audio");
  });

  it("mixed [audio, pdf, unknown]: still ONE transcode, each kind its own", async () => {
    const { toOpus, state } = await capture({
      files: [
        file("voice.wav", "audio/wav", WAV_BYTES),
        file("paper.pdf", "application/pdf", PDF_BYTES),
        file("blob.bin", undefined, new Uint8Array([1, 2, 3])),
      ],
    });

    expect(toOpus).toHaveBeenCalledTimes(1);
    expect(state.attachments.map((a) => a.kind)).toEqual(["audio", "doc", "file"]);
  });

  it("audio last: the earlier non-audio files are untouched", async () => {
    const { toOpus, store, state } = await capture({
      files: [
        file("photo.png", "image/png", PNG_BYTES),
        file("voice.wav", "audio/wav", WAV_BYTES),
      ],
    });

    expect(toOpus).toHaveBeenCalledTimes(1);
    expect(store.attachmentCalls[0].bytes).toEqual(PNG_BYTES);
    expect(state.attachments.map((a) => a.kind)).toEqual(["image", "audio"]);
    expect(state.kind).toBe("audio");
  });

  it("no audio at all: the transcoder is never invoked, whatever the file types", async () => {
    const { toOpus } = await capture({
      files: [
        file("photo.jpg", "image/jpeg", JPEG_BYTES),
        file("paper.pdf", "application/pdf", PDF_BYTES),
        file("blob.bin", undefined, new Uint8Array([9])),
      ],
    });
    expect(toOpus).not.toHaveBeenCalled();
  });
});

// ── capture-level kind rule ────────────────────────────────────────────────

describe("CreateCapture — capture-level kind rule", () => {
  it("precedence audio > image > doc > file for mixed attachments", async () => {
    const cases: Array<{ files: ReturnType<typeof file>[]; expected: string }> = [
      {
        files: [file("a.pdf", "application/pdf", PDF_BYTES), file("b.bin", undefined, new Uint8Array([1]))],
        expected: "doc",
      },
      {
        files: [file("a.pdf", "application/pdf", PDF_BYTES), file("b.jpg", "image/jpeg", JPEG_BYTES)],
        expected: "image",
      },
      {
        files: [
          file("a.bin", undefined, new Uint8Array([1])),
          file("b.jpg", "image/jpeg", JPEG_BYTES),
          file("c.pdf", "application/pdf", PDF_BYTES),
        ],
        expected: "image",
      },
      {
        files: [file("a.bin", undefined, new Uint8Array([1])), file("b.txt", "text/plain", PDF_BYTES)],
        expected: "doc",
      },
    ];
    for (const { files, expected } of cases) {
      const { state } = await capture({ files });
      expect(state.kind, files.map((f) => f.name).join(",")).toBe(expected);
    }
  });

  it("an explicit input.kind does not hide the attachment's own kind", async () => {
    // A caller defaulting to "note" must not turn a voice memo into a text note:
    // the worker's processing path keys off `kind`.
    const { state } = await capture({
      kind: "note",
      files: [file("photo.jpg", "image/jpeg", JPEG_BYTES)],
    });
    expect(state.kind).toBe("image");
    expect(state.attachments[0].kind).toBe("image");
  });

  it("a url capture stays `link` even with a file attached", async () => {
    const { state } = await capture({
      url: "https://example.com/post",
      files: [file("photo.jpg", "image/jpeg", JPEG_BYTES)],
    });
    expect(state.kind).toBe("link");
    expect(state.originUrl).toBe("https://example.com/post");
    expect(state.attachments[0].kind).toBe("image");
  });

  it("text + image: the capture is `image` (a file beats a body hint)", async () => {
    const { state } = await capture({
      text: "look at this",
      files: [file("photo.jpg", "image/jpeg", JPEG_BYTES)],
    });
    expect(state.kind).toBe("image");
  });

  it("pure text is still `note`, and honors an explicit kind", async () => {
    expect((await capture({ text: "hello world" })).state.kind).toBe("note");
    expect((await capture({ text: "hello", kind: "file" })).state.kind).toBe("file");
  });

  it("an empty file list is not an attachment decision (text stays `note`)", async () => {
    const { state } = await capture({ text: "just text", files: [] });
    expect(state.kind).toBe("note");
    expect(state.attachments).toEqual([]);
  });
});

// ── deriveTitle + the D4 caps still hold ───────────────────────────────────

describe("CreateCapture — titles and unchanged limits", () => {
  it("audio derives the `Voice note` title", async () => {
    const { state } = await capture({ files: [file("voice.wav", "audio/wav", WAV_BYTES)] });
    expect(state.title).toBe("Voice note");
  });

  it("image/doc/file captures derive a title from the body, or `Capture`", async () => {
    expect(
      (await capture({ text: "a photo of the whiteboard", files: [file("p.jpg", "image/jpeg", JPEG_BYTES)] })).state
        .title,
    ).toBe("a photo of the whiteboard");
    expect((await capture({ files: [file("p.jpg", "image/jpeg", JPEG_BYTES)] })).state.title).toBe("Capture");
  });

  it("still rejects a file over the 25 MB cap", async () => {
    const big = new Uint8Array(25 * 1024 * 1024 + 1);
    await expect(capture({ files: [file("big.bin", undefined, big)] })).rejects.toThrow(/25 MB cap/);
  });

  it("still rejects more than 20 attachments", async () => {
    const files = Array.from({ length: 21 }, (_, i) =>
      file(`f${i}.bin`, undefined, new Uint8Array([i])),
    );
    await expect(capture({ files })).rejects.toThrow(/Too many attachments/);
  });

  it("still rejects an empty capture", async () => {
    await expect(capture({ text: "" })).rejects.toThrow(/requires text, a url, or at least one file/);
  });
});
