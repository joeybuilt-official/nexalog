/**
 * Capture frontmatter contract — the single source of truth for how a capture
 * is encoded in `inbox/<ulid>.md`.
 *
 * Versioned via `nexalog.schema`. Serialization is pure (no deps) so this
 * lives in `core` and is shared by the fs adapter (write) and Hermes (read).
 *
 * The plan (§1.4) calls for zod here, but `core` must have ZERO runtime deps —
 * a zod schema would import a library at runtime. Hand-rolled parse/serialize
 * gives the same single-source guarantee without breaking the dependency wall.
 */

import { CaptureState } from "../domain/capture";
import { Ulid } from "../domain/ulid";
import {
  isCaptureStatus,
  isCaptureKind,
  isCaptureSource,
} from "../domain/capture-status";
import { isAttachmentKind } from "../domain/attachment-kind";
import { isPageType, PageType } from "../domain/page-type";

export const CAPTURE_SCHEMA_VERSION = 1;

interface NexalogFm {
  schema: number;
  status: string;
  kind: string;
  source: string;
  captured_at: string;
  claimed_by: string | null;
  claimed_at: string | null;
  attachments: string[];
  /**
   * Per-attachment kinds, index-aligned with `attachments`. Additive within
   * schema 1: files written before it existed simply omit the key, and every
   * reader falls back to the capture-level `kind` for those (see `parseCapture`).
   * It exists because the capture-level kind can only name ONE of a mixed
   * capture's files — a `[voice.opus, photo.jpg]` capture is `audio`, and
   * without this list the photo is indistinguishable from the voice memo.
   */
  attachment_kinds: string[];
  origin_url: string | null;
  proposal: CaptureState["proposal"];
}

export function serializeCapture(state: CaptureState): string {
  const fm: NexalogFm = {
    schema: CAPTURE_SCHEMA_VERSION,
    status: state.status,
    kind: state.kind,
    source: state.source,
    captured_at: state.capturedAt.toISOString(),
    claimed_by: state.claimedBy,
    claimed_at: state.claimedAt ? state.claimedAt.toISOString() : null,
    attachments: state.attachments.map((a) => a.path),
    attachment_kinds: state.attachments.map((a) => a.kind),
    origin_url: state.originUrl,
    proposal: state.proposal,
  };

  const typeLine = `type: ${state.type}`;
  const titleLine = `title: ${quoteYaml(state.title)}`;
  const nexalogBlock = yamlBlock(fm);

  return [
    "---",
    typeLine,
    "nexalog:",
    indent(nexalogBlock, 2),
    titleLine,
    "---",
    state.body,
  ].join("\n");
}

export function parseCapture(id: Ulid, frontmatter: Record<string, unknown>, body: string): CaptureState {
  const nex = (frontmatter["nexalog"] ?? {}) as Record<string, unknown>;
  const schema = nex["schema"];
  if (schema !== CAPTURE_SCHEMA_VERSION) {
    throw new Error(`Unsupported capture schema: ${String(schema)}`);
  }

  const status = nex["status"];
  const kind = nex["kind"];
  const source = nex["source"];
  const capturedAt = nex["captured_at"];
  if (!isCaptureStatus(status)) throw new Error(`Bad status: ${String(status)}`);
  if (!isCaptureKind(kind)) throw new Error(`Bad kind: ${String(kind)}`);
  if (!isCaptureSource(source)) throw new Error(`Bad source: ${String(source)}`);
  if (typeof capturedAt !== "string") throw new Error("captured_at missing");

  const type = frontmatter["type"];
  if (!isPageType(type)) throw new Error(`Bad type: ${String(type)}`);
  const title = typeof frontmatter["title"] === "string" ? frontmatter["title"] : "";

  const claimedBy = nex["claimed_by"] ?? null;
  const claimedAtRaw = nex["claimed_at"] ?? null;
  const attachments = Array.isArray(nex["attachments"]) ? nex["attachments"] : [];
  const attachmentKinds = Array.isArray(nex["attachment_kinds"]) ? nex["attachment_kinds"] : [];

  return {
    id,
    title,
    body,
    type,
    status,
    kind,
    source,
    capturedAt: new Date(capturedAt),
    claimedBy: typeof claimedBy === "string" ? claimedBy : null,
    claimedAt: typeof claimedAtRaw === "string" ? new Date(claimedAtRaw) : null,
    // Per-attachment kind where the file carries one, the capture-level kind
    // otherwise: a file written before `attachment_kinds` existed (or one with a
    // short/malformed list) degrades to exactly the pre-existing behavior.
    attachments: attachments.map((p, i) => ({
      path: String(p),
      kind: isAttachmentKind(attachmentKinds[i]) ? attachmentKinds[i] : kind,
      sizeBytes: 0,
    })),
    originUrl: typeof nex["origin_url"] === "string" ? nex["origin_url"] : null,
    proposal: (nex["proposal"] as CaptureState["proposal"]) ?? null,
  };
}

// ── helpers ──────────────────────────────────────────────────────────────

function quoteYaml(s: string): string {
  return JSON.stringify(s); // JSON strings are valid YAML scalars
}

function yamlBlock(obj: object): string {
  const entries = Object.entries(obj) as Array<[string, unknown]>;
  const lines: string[] = [];
  for (const [k, v] of entries) {
    if (v === null || v === undefined) {
      lines.push(`${k}: null`);
    } else if (typeof v === "string") {
      lines.push(`${k}: ${quoteYaml(v)}`);
    } else if (typeof v === "number" || typeof v === "boolean") {
      lines.push(`${k}: ${String(v)}`);
    } else if (Array.isArray(v)) {
      if (v.length === 0) {
        lines.push(`${k}: []`);
      } else {
        lines.push(`${k}:`);
        for (const item of v) lines.push(`  - ${quoteYaml(String(item))}`);
      }
    } else if (typeof v === "object") {
      lines.push(`${k}:`);
      for (const [ik, iv] of Object.entries(v as Record<string, unknown>)) {
        if (typeof iv === "string") lines.push(`  ${ik}: ${quoteYaml(iv)}`);
        else if (typeof iv === "number" || typeof iv === "boolean") lines.push(`  ${ik}: ${String(iv)}`);
        else if (Array.isArray(iv)) {
          lines.push(`  ${ik}:`);
          for (const item of iv) lines.push(`    - ${quoteYaml(String(item))}`);
        } else {
          lines.push(`  ${ik}: ${quoteYaml(JSON.stringify(iv))}`);
        }
      }
    } else {
      lines.push(`${k}: ${quoteYaml(String(v))}`);
    }
  }
  return lines.join("\n");
}

function indent(s: string, n: number): string {
  const pad = " ".repeat(n);
  return s
    .split("\n")
    .map((l) => pad + l)
    .join("\n");
}

export type { PageType };
