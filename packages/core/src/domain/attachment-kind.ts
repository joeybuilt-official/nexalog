/**
 * Attachment kinds — derive what an attached file actually IS.
 *
 * A capture's attachments arrive as raw bytes plus (sometimes) a browser-supplied
 * MIME type and a filename. Neither is sufficient alone: `File.type` is empty or
 * `application/octet-stream` on plenty of real uploads (share-sheet handoffs,
 * older browsers, `.heic` from iOS), and a filename can lie. So the kind is
 * derived from the MIME type FIRST, with the extension as the fallback when the
 * MIME type is absent or carries no signal.
 *
 * `CaptureKind`'s file-shaped members are exactly the outputs here — `audio`,
 * `image`, `doc`, `file` (the last is the honest answer for anything unrecognised).
 * `note` and `link` are capture-level kinds, not file kinds, and are never
 * returned by `deriveAttachmentKind`.
 *
 * Pure: no fs, no node builtins, no deps (see the `core-is-pure` depcruise rule).
 */

import type { CaptureKind } from "./capture-status";

/** The subset of `CaptureKind` a single file can be. */
export type AttachmentKind = Extract<CaptureKind, "audio" | "image" | "doc" | "file">;

export const ATTACHMENT_KINDS: readonly AttachmentKind[] = ["audio", "image", "doc", "file"];

export function isAttachmentKind(v: unknown): v is AttachmentKind {
  return typeof v === "string" && (ATTACHMENT_KINDS as readonly string[]).includes(v);
}

/**
 * MIME types that carry NO signal about the content — a browser reporting
 * `application/octet-stream` means "I don't know", not "this is an unknown
 * binary". Treating them as a vote for `file` would throw away a perfectly good
 * `.m4a` extension, so they fall through to the extension instead.
 */
const UNINFORMATIVE_MIMES = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
  "application/x-unknown",
  "application/unknown",
  "application/x-download",
  "application/force-download",
  "content/unknown",
]);

/** Document MIME types that are not `text/*` or `audio|image/*`. */
const DOC_MIMES = new Set([
  "application/pdf",
  "application/rtf",
  "text/rtf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/epub+zip",
  "application/json",
  "application/x-yaml",
  "application/yaml",
]);

/** Extensions per family. Lowercase, no dot. */
const AUDIO_EXTENSIONS = new Set([
  "aac",
  "aif",
  "aiff",
  "amr",
  "caf",
  "flac",
  "m4a",
  "m4b",
  "mp3",
  "oga",
  "ogg",
  "opus",
  "wav",
  "wma",
]);

const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "heic",
  "heif",
  "ico",
  "jfif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "tif",
  "tiff",
  "webp",
]);

const DOC_EXTENSIONS = new Set([
  "csv",
  "doc",
  "docx",
  "epub",
  "htm",
  "html",
  "json",
  "log",
  "markdown",
  "md",
  "odt",
  "pdf",
  "ppt",
  "pptx",
  "rtf",
  "tex",
  "tsv",
  "txt",
  "xls",
  "xlsx",
  "yaml",
  "yml",
]);

/**
 * Deliberately absent: `mp4`, `webm`, `mov` — those are video far more often
 * than audio, and this domain has no `video` kind, so they fall through to
 * `file`. When the MIME type IS `audio/mp4` the content type decides and the
 * file still lands as audio (that is the `.m4a` voice-memo case).
 */

/** The extension of a filename, lowercase and dotless; `""` when there is none. */
function extensionOf(name: string): string {
  const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  const base = slash === -1 ? name : name.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  // A leading dot is a hidden file, not an extension (mirrors `path.extname`).
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

/** The bare MIME type: lowercased, parameters (`; codecs=1`, `; charset=utf-8`) stripped. */
function baseMime(mimeType: string | undefined): string {
  if (!mimeType) return "";
  return mimeType.split(";")[0].trim().toLowerCase();
}

function kindFromMime(mime: string): AttachmentKind | null {
  if (UNINFORMATIVE_MIMES.has(mime)) return null;
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("text/")) return "doc";
  if (DOC_MIMES.has(mime)) return "doc";
  return null;
}

function kindFromExtension(ext: string): AttachmentKind | null {
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (DOC_EXTENSIONS.has(ext)) return "doc";
  return null;
}

/**
 * The kind of ONE attachment. MIME type first (authoritative when it says
 * something), the filename extension as the fallback, `file` when neither
 * recognises the content.
 */
export function deriveAttachmentKind(input: { mimeType?: string; name: string }): AttachmentKind {
  const fromMime = kindFromMime(baseMime(input.mimeType));
  if (fromMime) return fromMime;
  return kindFromExtension(extensionOf(input.name)) ?? "file";
}

/**
 * Precedence for the capture-level kind when several attachments disagree:
 * `audio > image > doc > file`.
 *
 * Ordered by what the Hermes worker must DO with it, not by richness: an audio
 * attachment is the one that needs transcription before anything else can be
 * read, an image needs description/OCR, a doc needs text extraction, and a
 * plain file needs nothing. A capture holding a voice memo and a photo is
 * therefore `audio` — the transcode/transcribe path is the one that must not be
 * missed, and the photo still carries its own `image` kind on the attachment.
 */
export function captureKindFromAttachments(kinds: readonly AttachmentKind[]): AttachmentKind {
  if (kinds.includes("audio")) return "audio";
  if (kinds.includes("image")) return "image";
  if (kinds.includes("doc")) return "doc";
  return "file";
}
