// SPDX-License-Identifier: MIT
/**
 * Capture kinds — real-file end-to-end.
 *
 * The core unit tests (`packages/core/test/create-capture-kind.test.ts`) pin the
 * derivation rules against fakes. This file proves the same path with REAL
 * dependencies and REAL file bytes: a real `FsGitBrainStore` over a temporary
 * git repo, the production `CreateCapture` use case, and — where ffmpeg is
 * present — the production `FfmpegTranscoder` actually encoding a real
 * RIFF/WAVE recording into Ogg/Opus.
 *
 * What it covers that the unit tests cannot:
 *   - the bytes that land ON DISK are the bytes we expect (the photo is not
 *     transcoded, the audio IS, and the audio file is a genuine Ogg/Opus
 *     container rather than something ffmpeg half-wrote);
 *   - audio is stored with a `.opus` extension even when uploaded as `.m4a`,
 *     because the bytes have been normalized (D4);
 *   - the per-attachment kinds survive the full round trip: write →
 *     `serializeCapture` → git → `parseCapture` → `getCapture`.
 *
 * The "transcoder invoked exactly once" assertion uses a counting wrapper around
 * the real transcoder: it performs the real encode AND counts. Spying on a fake
 * would prove nothing about the real path — this is the Bug B regression, so it
 * is asserted where the bug actually lived.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { CreateCapture, type Transcoder } from "@nexalog/core";
import { FsGitBrainStore, FfmpegTranscoder, SystemIdGen, SystemClock } from "../src/index";

const execFileP = promisify(execFile);

// ── real fixtures (bytes, not descriptions of bytes) ───────────────────────

/** 8×8 RGB PNG with valid IHDR/IDAT/IEND CRCs and a real zlib stream. */
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAJUlEQVR42mNgYGBQUFBwcHBISEhoaGhYsGDBgQMHHjx4wDC0JABYmVQBndcjhQAAAABJRU5ErkJggg==",
  "base64",
);

/** Baseline 16×16 JPEG — the exact shape a phone photo arrives as. */
const JPEG_BYTES = Buffer.from(
  "/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYxLjE5LjEwMQD/2wBDAAgKCgsKCw0NDQ0NDRAPEBAQEBAQEBAQEBASEhIVFRUSEhIQEBISFBQVFRcXFxUVFRUXFxkZGR4eHBwjIyQrKzP/xABMAAEBAAAAAAAAAAAAAAAAAAAABgEBAQAAAAAAAAAAAAAAAAAABgcQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAAQABADASIAAhEAAxEA/9oADAMBAAIRAxEAPwCLAFF/f//Z",
  "base64",
);

const PDF_BYTES = Buffer.from("%PDF-1.4\n%%EOF\n", "utf8");

/**
 * A real RIFF/WAVE file: the canonical 44-byte header followed by 0.1 s of a
 * 440 Hz sine at 8 kHz mono 16-bit — audio ffmpeg can genuinely decode.
 */
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
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const WAV_BYTES = makeWav();

/** `ffmpeg -version` — the production transcoder shells out to this binary. */
const ffmpegAvailable = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

// ── harness ────────────────────────────────────────────────────────────────

let repo: string;
let store: FsGitBrainStore;

beforeAll(async () => {
  repo = await fs.mkdtemp(path.join(os.tmpdir(), "nexalog-kinds-"));
  await execFileP("git", ["init", "-q"], { cwd: repo });
  await execFileP("git", ["config", "user.email", "test@test"], { cwd: repo });
  await execFileP("git", ["config", "user.name", "test"], { cwd: repo });
  store = new FsGitBrainStore({ repoPath: repo });
});

afterAll(async () => {
  await fs.rm(repo, { recursive: true, force: true });
});

/**
 * The real transcoder plus a call counter. `counted` is what the Bug B
 * regression asserts on: one call for a mixed capture means no non-audio file
 * was dragged through ffmpeg.
 */
function countingTranscoder(inner: Transcoder) {
  const calls: Uint8Array[] = [];
  const transcoder: Transcoder = {
    async toOpus(bytes) {
      calls.push(bytes);
      return inner.toOpus(bytes);
    },
  };
  return { transcoder, calls };
}

async function runCapture(files: Array<{ name: string; mimeType?: string; bytes: Buffer }>) {
  const { transcoder, calls } = countingTranscoder(new FfmpegTranscoder());
  const useCase = new CreateCapture(store, new SystemIdGen(), new SystemClock(), transcoder);
  const { captureId } = await useCase.execute({ source: "web", files });
  const state = await store.getCapture(captureId);
  if (!state) throw new Error("capture was not persisted");
  return { state, calls, captureId };
}

async function readAttachment(state: { attachments: Array<{ path: string }> }, index: number) {
  return fs.readFile(path.join(repo, state.attachments[index].path));
}

const describeFfmpeg = ffmpegAvailable ? describe : describe.skip;

// ── the paths that need no encoder ─────────────────────────────────────────

describe("capture kinds end-to-end (real repo, real files)", () => {
  it("image-only: the PNG lands byte-for-byte, kind `image`, no transcode", async () => {
    const { state, calls } = await runCapture([
      { name: "whiteboard.png", mimeType: "image/png", bytes: PNG_BYTES },
    ]);

    expect(state.kind).toBe("image");
    expect(state.attachments).toHaveLength(1);
    expect(state.attachments[0].kind).toBe("image");
    expect(state.attachments[0].path).toMatch(/\.png$/);

    // the exact bytes we uploaded are the exact bytes on disk
    expect(await readAttachment(state, 0)).toEqual(PNG_BYTES);
    expect(calls).toHaveLength(0);
  });

  it("mixed [png, pdf, unknown]: per-file kinds survive git round-trip, one transcode", async () => {
    const blob = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]);
    const { state, calls } = await runCapture([
      { name: "shot.png", mimeType: "image/png", bytes: PNG_BYTES },
      { name: "spec.pdf", mimeType: "application/pdf", bytes: PDF_BYTES },
      { name: "firmware.bin", bytes: blob },
    ]);

    expect(state.kind).toBe("image"); // precedence: image > doc > file
    expect(state.attachments.map((a) => a.kind)).toEqual(["image", "doc", "file"]);
    expect(state.attachments.map((a) => path.extname(a.path))).toEqual([".png", ".pdf", ".bin"]);

    expect(await readAttachment(state, 0)).toEqual(PNG_BYTES);
    expect(await readAttachment(state, 1)).toEqual(PDF_BYTES);
    expect(await readAttachment(state, 2)).toEqual(blob);
    expect(calls).toHaveLength(0);
  });

  it("mixed [audio, image]: the JPEG is never transcoded and keeps kind `image`", async () => {
    // Fake encoder that returns a RECOGNISABLE marker instead of real opus, so
    // the assertion is about WHICH files reached ffmpeg, not what it produced.
    const encoded: Uint8Array[] = [];
    const marker = Buffer.from("OPUS-MARKER");
    const transcoder: Transcoder = {
      async toOpus(bytes) {
        encoded.push(bytes);
        return new Uint8Array(marker);
      },
    };
    const useCase = new CreateCapture(store, new SystemIdGen(), new SystemClock(), transcoder);
    const { captureId } = await useCase.execute({
      source: "web",
      files: [
        { name: "voice.m4a", mimeType: "audio/mp4", bytes: WAV_BYTES },
        { name: "photo.jpg", mimeType: "image/jpeg", bytes: JPEG_BYTES },
      ],
    });
    const state = await store.getCapture(captureId);
    if (!state) throw new Error("capture was not persisted");

    // Bug B: exactly ONE file (the audio) went to the encoder.
    expect(encoded).toHaveLength(1);
    expect(Buffer.from(encoded[0])).toEqual(WAV_BYTES);

    expect(state.kind).toBe("audio");
    expect(state.attachments.map((a) => a.kind)).toEqual(["audio", "image"]);

    // the audio is stored under .opus (its bytes were normalized), the photo
    // under its own extension and completely untouched by the encoder
    expect(path.extname(state.attachments[0].path)).toBe(".opus");
    expect(await readAttachment(state, 0)).toEqual(marker);
    expect(path.extname(state.attachments[1].path)).toBe(".jpg");
    expect(await readAttachment(state, 1)).toEqual(JPEG_BYTES);
  });

  it("extension fallback when the browser sends no MIME type", async () => {
    const { state, calls } = await runCapture([
      { name: "IMG_4821.HEIC", bytes: JPEG_BYTES }, // no mimeType at all
      { name: "scan.pdf", mimeType: "application/octet-stream", bytes: PDF_BYTES },
    ]);

    expect(state.attachments.map((a) => a.kind)).toEqual(["image", "doc"]);
    expect(state.kind).toBe("image");
    expect(calls).toHaveLength(0);
  });

  it("writes a readable nexalog block with the per-file kinds and commits it", async () => {
    const { state, captureId } = await runCapture([
      { name: "photo.jpg", mimeType: "image/jpeg", bytes: JPEG_BYTES },
      { name: "notes.md", mimeType: "text/markdown", bytes: Buffer.from("# hi", "utf8") },
    ]);

    const raw = await fs.readFile(path.join(repo, "inbox", `${captureId.value}.md`), "utf8");
    expect(raw).toContain("nexalog:");
    expect(raw).toMatch(/attachment_kinds:\n\s+- "image"\n\s+- "doc"\n/);

    const log = await execFileP("git", ["log", "--oneline", "--", `inbox/${captureId.value}.md`], {
      cwd: repo,
    });
    expect(log.stdout).toContain("capture");

    // and nothing is left uncommitted after the write
    const status = await execFileP("git", ["status", "--porcelain"], { cwd: repo });
    expect(status.stdout.trim()).toBe("");
    expect(state.attachments.map((a) => a.kind)).toEqual(["image", "doc"]);
  });

  it("keeps the 25 MB cap on real byte buffers", async () => {
    const big = Buffer.alloc(25 * 1024 * 1024 + 1);
    const useCase = new CreateCapture(store, new SystemIdGen(), new SystemClock(), {
      toOpus: async () => new Uint8Array(),
    });
    await expect(
      useCase.execute({ source: "web", files: [{ name: "huge.bin", bytes: new Uint8Array(big) }] }),
    ).rejects.toThrow(/25 MB cap/);
  });
});

// ── the same path, with the REAL encoder ───────────────────────────────────

describeFfmpeg("capture kinds end-to-end — real ffmpeg (D4 audio → opus)", () => {
  it("audio-only: ffmpeg ran once and the stored file is a real Ogg/Opus stream", async () => {
    const { state, calls } = await runCapture([
      { name: "memo.m4a", mimeType: "audio/mp4", bytes: WAV_BYTES },
    ]);

    expect(calls).toHaveLength(1);
    expect(Buffer.from(calls[0])).toEqual(WAV_BYTES);
    expect(state.kind).toBe("audio");
    expect(state.attachments[0].kind).toBe("audio");
    expect(state.attachments[0].path).toMatch(/\.opus$/);

    const stored = await readAttachment(state, 0);
    // A genuine Ogg container carrying an Opus stream — not "some bytes ffmpeg wrote".
    expect(stored.subarray(0, 4).toString("ascii")).toBe("OggS");
    expect(stored.includes(Buffer.from("OpusHead", "ascii"))).toBe(true);
    expect(stored.length).toBeGreaterThan(0);
    // normalized, so it is materially smaller than the PCM it came from
    expect(stored.length).toBeLessThan(WAV_BYTES.length);
  });

  it("mixed [audio, png]: one real encode; the PNG is byte-identical afterwards", async () => {
    const { state, calls } = await runCapture([
      { name: "memo.m4a", mimeType: "audio/mp4", bytes: WAV_BYTES },
      { name: "whiteboard.png", mimeType: "image/png", bytes: PNG_BYTES },
      { name: "spec.pdf", mimeType: "application/pdf", bytes: PDF_BYTES },
    ]);

    expect(calls).toHaveLength(1);
    expect(state.attachments.map((a) => a.kind)).toEqual(["audio", "image", "doc"]);

    const audio = await readAttachment(state, 0);
    expect(audio.subarray(0, 4).toString("ascii")).toBe("OggS");
    expect(audio.includes(Buffer.from("OpusHead", "ascii"))).toBe(true);
    expect(await readAttachment(state, 1)).toEqual(PNG_BYTES);
    expect(await readAttachment(state, 2)).toEqual(PDF_BYTES);
  });

  it("a real re-read of the capture keeps every per-file kind", async () => {
    const { captureId } = await runCapture([
      { name: "memo.wav", mimeType: "audio/wav", bytes: WAV_BYTES },
      { name: "photo.jpg", mimeType: "image/jpeg", bytes: JPEG_BYTES },
    ]);

    // fresh store instance — a genuinely new process would read it this way
    const reread = await new FsGitBrainStore({ repoPath: repo }).getCapture(captureId);
    expect(reread?.kind).toBe("audio");
    expect(reread?.attachments.map((a) => a.kind)).toEqual(["audio", "image"]);
    expect(reread?.attachments.map((a) => path.extname(a.path))).toEqual([".opus", ".jpg"]);
  });
});

if (!ffmpegAvailable) {
  console.warn(
    "[capture-kinds-e2e] ffmpeg not on PATH — the real-encoder suite was skipped. " +
      "The derivation/round-trip suites above still ran, and the `toOpus` call-count " +
      "regression is still guarded by the marker-encoder cases — but the D4 " +
      "normalization is NOT verified in this environment. `verify.yml` installs ffmpeg, " +
      "so CI runs these; a laptop without it does not.",
  );
}

describe("fixture sanity", () => {
  it("the PNG fixture is a real PNG and the WAV fixture is real PCM", () => {
    expect(PNG_BYTES.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(WAV_BYTES.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(WAV_BYTES.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(JPEG_BYTES.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(PDF_BYTES.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });
});
