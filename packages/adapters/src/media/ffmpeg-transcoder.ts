/**
 * FfmpegTranscoder — normalize audio to opus via the ffmpeg binary.
 *
 * Runs `ffmpeg -i <in> -c:a libopus -b:a 32k <out.opus>` on a temp file.
 * This is the D4 normalization: audio lands in the repo as opus, keeping the
 * brain repo lean (pre-mortem #3).
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { Transcoder } from "@nexalog/core";

const execFileP = promisify(execFile);

export class FfmpegTranscoder implements Transcoder {
  constructor(private readonly ffmpegPath = "ffmpeg") {}

  async toOpus(bytes: Uint8Array): Promise<Uint8Array> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexalog-"));
    const inFile = path.join(dir, "input");
    const outFile = path.join(dir, "output.opus");
    try {
      await fs.writeFile(inFile, Buffer.from(bytes));
      await execFileP(this.ffmpegPath, [
        "-y",
        "-i",
        inFile,
        "-c:a",
        "libopus",
        "-b:a",
        "32k",
        outFile,
      ]);
      return new Uint8Array(await fs.readFile(outFile));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
}
