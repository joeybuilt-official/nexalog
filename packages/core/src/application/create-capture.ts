/**
 * CreateCapture — the core intake use case.
 *
 * Takes an untyped input (text, url, or attached file bytes) and produces a
 * persisted capture in the brain repo. It is the single path every capture
 * channel (PWA share, bookmarklet, MCP, in-app) flows through, so validation
 * and invariants live here once.
 */

import { Capture } from "../domain/capture";
import { Ulid } from "../domain/ulid";
import { PageType } from "../domain/page-type";
import { CaptureKind, CaptureSource } from "../domain/capture-status";
import {
  captureKindFromAttachments,
  deriveAttachmentKind,
  type AttachmentKind,
} from "../domain/attachment-kind";
import { BrainStore, IdGen, Clock, Transcoder } from "../ports";

export interface CreateCaptureInput {
  text?: string;
  url?: string;
  kind?: CaptureKind; // default note
  source: CaptureSource;
  title?: string;
  files?: Array<{ name: string; mimeType?: string; bytes: Uint8Array }>;
}

export interface CreateCaptureOutput {
  captureId: Ulid;
}

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // D4 cap per file
const MAX_TOTAL_ATTACHMENTS = 20;

export class CreateCapture {
  constructor(
    private readonly store: BrainStore,
    private readonly ids: IdGen,
    private readonly clock: Clock,
    private readonly transcoder: Transcoder,
  ) {}

  /**
   * Capture-level `kind` rule (the one the worker's processing path keys off):
   *
   *   1. a `url` capture is `link` — the URL is what the worker fetches, with or
   *      without attachments;
   *   2. otherwise, when there ARE attachments, the kind is the strongest
   *      DERIVED attachment kind under `audio > image > doc > file` (see
   *      `captureKindFromAttachments`). An explicit `input.kind` deliberately
   *      does NOT override this: callers default to `note`, and a default must
   *      not be able to hide a voice memo or a photo from the worker;
   *   3. otherwise a text capture is `input.kind ?? "note"`.
   *
   * Each attachment additionally carries its OWN kind, so a mixed capture keeps
   * the detail the capture-level kind necessarily flattens.
   */
  async execute(input: CreateCaptureInput): Promise<CreateCaptureOutput> {
    // 1. Resolve body + kind.
    let body = "";
    let kind: CaptureKind = input.kind ?? "note";
    let originUrl: string | null = null;

    if (input.url) {
      body = input.url;
      kind = "link";
      originUrl = input.url;
    } else if (input.text !== undefined && input.text !== "") {
      body = input.text;
      kind = input.kind ?? "note";
    }

    if (body === "" && (input.files?.length ?? 0) === 0) {
      throw new Error("Capture requires text, a url, or at least one file");
    }

    // 2. Persist attachments (normalize audio → opus).
    //
    // `fileKind` is scoped to ONE iteration: it is derived from that file's own
    // MIME type/extension and never read by the next one. A previous revision
    // reassigned the capture-level `kind` here instead, which made the audio
    // test (`kind === "audio"`) true for every subsequent file — a JPEG after a
    // voice memo went through ffmpeg and was recorded as audio.
    const attachments: Capture["state"]["attachments"] = [];
    const fileKinds: AttachmentKind[] = [];
    if (input.files) {
      if (input.files.length > MAX_TOTAL_ATTACHMENTS) {
        throw new Error(`Too many attachments (max ${MAX_TOTAL_ATTACHMENTS})`);
      }
      for (const f of input.files) {
        if (f.bytes.length > MAX_ATTACHMENT_BYTES) {
          throw new Error(`Attachment "${f.name}" exceeds 25 MB cap`);
        }
        const fileKind = deriveAttachmentKind({ mimeType: f.mimeType, name: f.name });
        let bytes = f.bytes;
        if (fileKind === "audio") {
          bytes = await this.transcoder.toOpus(bytes);
        }
        const saved = await this.store.saveAttachment({
          name: f.name,
          kind: fileKind,
          bytes,
        });
        fileKinds.push(fileKind);
        attachments.push({
          path: saved.path,
          kind: fileKind,
          sizeBytes: bytes.length,
          mimeType: f.mimeType,
        });
      }
      if (kind !== "link" && fileKinds.length > 0) {
        kind = captureKindFromAttachments(fileKinds);
      }
    }

    // 3. Build + persist the capture.
    const capture = new Capture({
      id: this.ids.newUlid(),
      title: input.title?.trim() || deriveTitle(body, kind),
      body,
      type: "note", // Hermes retypes on processing
      status: "inbox",
      kind,
      source: input.source,
      capturedAt: this.clock.now(),
      claimedBy: null,
      claimedAt: null,
      attachments,
      originUrl,
      proposal: null,
    });

    Capture.validate(capture.state);
    await this.store.saveCapture(capture);

    return { captureId: capture.id };
  }
}

function deriveTitle(body: string, kind: CaptureKind): string {
  if (kind === "audio") return "Voice note";
  if (kind === "link" || kind === "image" || kind === "file" || kind === "doc") {
    return body.slice(0, 80) || "Capture";
  }
  const firstLine = body.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
  return firstLine.slice(0, 120) || "Capture";
}

export type { PageType };
