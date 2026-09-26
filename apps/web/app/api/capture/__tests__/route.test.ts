// SPDX-License-Identifier: MIT
/**
 * Endpoint test for POST /api/capture — attachment kinds end to end through the
 * HTTP surface.
 *
 * The route is the only place the browser's multipart part becomes a
 * `CreateCaptureInput`, and it is where the MIME type is taken from
 * (`value.type`). Two real-world cases are pinned here because the route is the
 * layer that decides:
 *
 *   - a part with NO Content-Type arrives as an empty `File.type` (and as
 *     `application/octet-stream` when the browser fills one in) — the kind must
 *     then come from the filename EXTENSION, not default to a text note;
 *   - an audio part plus a non-audio part in ONE request must transcode only the
 *     audio (the Bug B regression, asserted at the surface the phone actually
 *     talks to).
 *
 * Real files, real `FormData`, real `Request` — only the composition root is
 * faked, and it is faked with the REAL `CreateCapture` use case over an
 * in-memory `BrainStore`, so the assertions are about the production decision
 * path rather than a stub of it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  Capture,
  CreateCapture,
  type BrainStore,
  type CaptureState,
  type Clock,
  type IdGen,
  type Transcoder,
  Ulid,
} from "@nexalog/core";

import { NextRequest } from "next/server";

const { getComposition } = vi.hoisted(() => ({ getComposition: vi.fn() }));
vi.mock("@/composition", () => ({ getComposition }));

import { POST } from "@/app/api/capture/route";

// ── real file bytes ────────────────────────────────────────────────────────

const JPEG_BYTES = Buffer.from(
  "/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYxLjE5LjEwMQD/2wBDAAgKCgsKCw0NDQ0NDRAPEBAQEBAQEBAQEBASEhIVFRUSEhIQEBISFBQVFRcXFxUVFRUXFxkZGR4eHBwjIyQrKzP/xABMAAEBAAAAAAAAAAAAAAAAAAAABgEBAQAAAAAAAAAAAAAAAAAABgcQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAAQABADASIAAhEAAxEA/9oADAMBAAIRAxEAPwCLAFF/f//Z",
  "base64",
);

function makeWav(): Buffer {
  const sampleRate = 8000;
  const samples = 800;
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    pcm.writeInt16LE(Math.round(12000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate)), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const WAV_BYTES = makeWav();

// ── fakes ──────────────────────────────────────────────────────────────────

class FakeBrainStore implements BrainStore {
  readonly captures: CaptureState[] = [];
  readonly saved: Array<{ name: string; kind: string; bytes: Uint8Array }> = [];

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
  async getPage() {
    return null;
  }
  async savePage(): Promise<void> {
    throw new Error("not used");
  }
  async saveAttachment(input: { name: string; kind: string; bytes: Uint8Array }) {
    this.saved.push(input);
    const ext = input.name.includes(".") ? input.name.slice(input.name.lastIndexOf(".")) : ".bin";
    return { path: `attachments/2026/09/${this.saved.length}${ext}` };
  }
}

const ID = "0123456789ABCDEFGHJKMNPQRS";

function wireComposition(transcoder: Transcoder) {
  const store = new FakeBrainStore();
  const ids: IdGen = { newUlid: () => Ulid.of(ID), newCapturedAt: () => new Date("2026-09-25T00:00:00Z") };
  const clock: Clock = { now: () => new Date("2026-09-25T00:00:00Z") };
  const createCapture = new CreateCapture(store, ids, clock, transcoder);
  getComposition.mockReturnValue({ createCapture });
  return store;
}

/** A Buffer-backed fixture as a plain ArrayBuffer-backed Uint8Array — `File`/`Blob` demand the latter. */
function bytes(b: Buffer): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(b);
}

function form(fields: Record<string, string>, files: Array<[string, File]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const [k, f] of files) fd.append(k, f);
  return fd;
}

function post(fd: FormData) {
  return POST(
    new NextRequest("http://localhost/api/capture", { method: "POST", body: fd }),
  );
}

beforeEach(() => {
  getComposition.mockReset();
});

// ── tests ──────────────────────────────────────────────────────────────────

describe("POST /api/capture — attachment kinds", () => {
  it("a photo with no MIME type is `image` via its extension, not a text note", async () => {
    const store = wireComposition({ toOpus: async () => new Uint8Array() });

    // `type: ""` is what a share-sheet handoff or a curl client sends.
    const response = await post(
      form({ source: "web" }, [
        ["file0", new File([bytes(JPEG_BYTES)], "IMG_4821.jpg", { type: "" })],
      ]),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true, captureId: ID });

    const state = store.captures[0];
    expect(state.kind).toBe("image");
    expect(state.attachments[0].kind).toBe("image");
    expect(store.saved[0].name).toBe("IMG_4821.jpg");
    expect(Buffer.from(store.saved[0].bytes)).toEqual(JPEG_BYTES);
  });

  it("a voice memo plus a photo: one transcode, and the photo is untouched", async () => {
    const toOpus = vi.fn<(bytes: Uint8Array) => Promise<Uint8Array>>(async () =>
      new Uint8Array([0x4f, 0x50, 0x55, 0x53]),
    );
    const store = wireComposition({ toOpus });

    const response = await post(
      form({ source: "pwa-share" }, [
        ["file0", new File([bytes(WAV_BYTES)], "memo.m4a", { type: "audio/mp4" })],
        ["file1", new File([bytes(JPEG_BYTES)], "whiteboard.jpg", { type: "image/jpeg" })],
      ]),
    );

    expect(response.status).toBe(201);

    // The JPEG must never reach the encoder — the Bug B regression at the wire.
    expect(toOpus).toHaveBeenCalledTimes(1);
    expect(Buffer.from(toOpus.mock.calls[0][0])).toEqual(WAV_BYTES);

    const state = store.captures[0];
    expect(state.kind).toBe("audio");
    expect(state.attachments.map((a) => a.kind)).toEqual(["audio", "image"]);
    expect(store.saved.map((s) => s.kind)).toEqual(["audio", "image"]);
    expect(Buffer.from(store.saved[1].bytes)).toEqual(JPEG_BYTES);
  });

  it("a PDF is `doc` and a url capture with the same attachment stays `link`", async () => {
    const store = wireComposition({ toOpus: async () => new Uint8Array() });

    const response = await post(
      form({ url: "https://example.com/paper", source: "bookmarklet" }, [
        ["file0", new File([bytes(Buffer.from("%PDF-1.4\n%%EOF\n"))], "paper.pdf", { type: "application/pdf" })],
      ]),
    );

    expect(response.status).toBe(201);
    const state = store.captures[0];
    expect(state.kind).toBe("link");
    expect(state.originUrl).toBe("https://example.com/paper");
    expect(state.attachments[0].kind).toBe("doc");
  });

  it("text-only is still `note` (kind derivation never fires without files)", async () => {
    const store = wireComposition({ toOpus: async () => new Uint8Array() });

    const response = await post(form({ text: "a plain thought", source: "web" }, []));

    expect(response.status).toBe(201);
    expect(store.captures[0].kind).toBe("note");
    expect(store.captures[0].title).toBe("a plain thought");
  });

  it("a failing use case still 400s with the message (no regression in error shape)", async () => {
    wireComposition({ toOpus: async () => new Uint8Array() });

    const response = await post(
      form({ text: "", source: "web" }, [["file0", new File([bytes(WAV_BYTES)], "memo.wav", { type: "" })]]),
    );
    // a file was supplied, so this one SUCCEEDS — the empty capture is rejected
    // only when there is nothing at all:
    expect(response.status).toBe(201);

    const empty = await post(new FormData());
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({
      ok: false,
      error: "Capture requires text, a url, or at least one file",
    });
  });
});
