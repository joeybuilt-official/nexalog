// SPDX-License-Identifier: MIT
/**
 * Claude.ai data-export parser + brain-page planner — pure functions only.
 *
 * No `fs`, no database, no git, no ZIP handling: the caller
 * (`apps/web/scripts/reimport-claude.ts`) does the I/O — it reads the export and the destination
 * files, and it writes the pages. That split is what makes every decision below unit-testable
 * without a fixture directory, a Postgres connection, or a brain repo.
 *
 * ── The export format this reads ─────────────────────────────────────────────────────────────
 *
 * A Claude.ai data export is a ZIP holding (at least) four JSON files:
 *
 *   conversations.json   array of conversations
 *   memories.json        array of account memory records
 *   projects.json        array of projects
 *   users.json           array of accounts
 *
 * `conversations.json` is a JSON **array**; each conversation carries:
 *
 *   uuid, name, summary, created_at, updated_at, account.uuid, chat_messages[]
 *
 * and each `chat_messages[]` entry:
 *
 *   uuid, sender ("human" | "assistant"), text, content[], created_at, updated_at,
 *   attachments, files
 *
 * `content[]` block kinds observed in the wild (verified against the real export — see the
 * block-kind table below for the two kinds that only appear there):
 *
 *   text                  { text, citations[]? }        — the visible prose
 *   thinking              { thinking, summaries[]? }    — the model's own reasoning
 *   tool_use              { name, input, id }           — name="artifacts" carries an artifact
 *   tool_result           { content }                   — tool output (counted, never inlined)
 *   injected_prompt_block { prompt, injection_source }   — system/context text injected into the
 *                                                         model's turn (date note, memory
 *                                                         snapshot, …): COUNTED AND SKIPPED,
 *                                                         never rendered as message content
 *   document              { file_uuid, title }           — an attached document: rendered as an
 *                                                         attachment reference, never as prose
 *   image                 { source, file_uuid }          — an attached image: same
 *   token_budget          { … }                          — machinery, counted only
 *   summaries             { … }                          — machinery, counted only
 *
 * Five consequences the code is built around:
 *
 *  1. **A message may carry BOTH a `text` field and a `content` array.** The array wins whenever
 *     it is non-empty; `text` is only the fallback (documented contract, not an inference).
 *  2. **`content` sometimes arrives as a JSON *string* rather than an array** (double-encoded by
 *     the exporter). That is DETECTED, decoded, and reported as a warning — never a crash, and
 *     never silently dropped.
 *  3. **Conversations are linear.** There is no branching to reconstruct: `chat_messages[]` is
 *     already in order, so a message's `position` is its array index.
 *  4. **Identity is the provider uuid**, never the array index and never the title. A conversation
 *     with no uuid is refused (SKIP-unsupported) rather than given a synthetic key — the export is
 *     re-importable, so a guessed key would create a duplicate on the next run.
 *  5. **Only the four content-bearing kinds render.** `injected_prompt_block`, `tool_result`,
 *     `token_budget` and `summaries` are counted and left out of the page: they are the
 *     conversation's machinery, not its text (an injected memory snapshot can be tens of KB per
 *     turn). `tool_use` renders as a one-line marker (its `input` is a tool call, not prose);
 *     the `artifacts` tool_use renders in full because the artifact IS the assistant's output.
 *
 * ── Destination: brain markdown pages, not database rows ────────────────────────────────────
 *
 * One conversation → one page `<brain-repo>/notes/<slug>.md` (the house layout,
 * `packages/adapters/src/brain-fs-git/fs-git-brain-store.ts:4-7`), with the loose page
 * frontmatter contract — `type` + `title` + body (nothing else is read; see
 * `packages/adapters/src/gbrain-null/null-index.ts` and `/api/search`). The page `type` is
 * `note`: `PAGE_TYPES` (`packages/core/src/domain/page-type.ts`) has no `conversation` member,
 * so the closest existing type is used rather than a type being invented. gbrain's own schema
 * pack does carry a `conversation` type, but a page Nexalog writes must satisfy Nexalog's
 * `PageType` — and as a `note` the page maps to the `note` kind in `/api/search`.
 *
 * Dedupe identity is the conversation uuid, recorded in the frontmatter as
 * `claude_conversation_uuid`. Every other frontmatter value is DERIVED FROM THE EXPORT ONLY —
 * deliberately no run timestamp — so a second run renders byte-identical text and is skipped
 * rather than churned. (The run itself is recorded in `nexalog.imports` by the CLI.)
 *
 * Deliberate limits: `memories.json`, `projects.json` and `users.json` are not imported; unknown
 * block kinds, unknown attachment shapes and unparseable dates degrade to warnings + counts
 * instead of aborting the whole migration.
 */

import { Slug, type PageType } from "@nexalog/core";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Tuned constants
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** The provenance string written to `import_source`; also the ledger `kind` prefix. */
export const CLAUDE_IMPORT_SOURCE = "claude";

/** The `PageType` a conversation page is written as, and the directory it lands in. */
export const CLAUDE_PAGE_TYPE: PageType = "note";
export const CLAUDE_PAGE_DIR = "notes";

/** `text` join used when one message carries several text blocks. */
const TEXT_BLOCK_JOIN = "\n\n";

/** Sender values Claude actually emits. Anything else is stored as `other`, with a count. */
export const CLAUDE_SENDERS = ["human", "assistant"] as const;
export type ClaudeSender = (typeof CLAUDE_SENDERS)[number] | "other";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Small, total value helpers
// ─────────────────────────────────────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Date value → `Date | null`, total.
 *
 * Claude writes ISO 8601 with microseconds and an offset (`2024-08-15T14:23:11.123456+00:00`),
 * which `new Date` accepts. Values outside 1970–2100 are rejected: a malformed or sentinel date
 * (`0001-01-01T00:00:00Z`) would silently sort a conversation to the bottom of every list.
 * A numeric value is accepted as epoch milliseconds only when it lands inside the same window.
 */
export function toDate(value: unknown): Date | null {
  if (value instanceof Date) return inRange(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return inRange(new Date(value));
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  // Date-ish shape first: `new Date("2024")` is a plausible-looking lie.
  if (!/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(trimmed)) return null;
  return inRange(new Date(trimmed));
}

function inRange(date: Date): Date | null {
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  if (year < 1970 || year > 2100) return null;
  return date;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Senders
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface NormalizedSender {
  sender: ClaudeSender;
  /** The value exactly as the export spelled it (for the plan's reason line), or null. */
  raw: string | null;
}

/**
 * `human` / `assistant` pass through. Anything else — a missing field, a future `tool` row, a
 * system message — becomes `other` and is *counted*, so a third sender can never silently
 * masquerade as a user turn in a transcript.
 */
export function normalizeSender(raw: unknown): NormalizedSender {
  const text = typeof raw === "string" ? raw.trim() : null;
  if (text === null || text === "") return { sender: "other", raw: null };
  const lower = text.toLowerCase();
  if (lower === "human" || lower === "assistant") return { sender: lower, raw: text };
  return { sender: "other", raw: text };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Content blocks — including the double-encoded case
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface DecodedContent {
  /** The block objects, in order. Empty when the export gave nothing usable. */
  blocks: unknown[];
  /** True when `content` arrived as a JSON string that parsed back to an array. */
  doubleEncoded: boolean;
  /** Human-readable note when the value could not be used as a block array. */
  warning: string | null;
}

/**
 * The known real-world gotcha: some exported `content` values arrive as a **JSON string** holding
 * the array, not as an array. Detect, decode, and warn — never crash, never drop the message.
 * Every other unusable shape (an object, a lone number, an empty string) also degrades to a
 * warning so one bad message cannot abort a whole migration.
 */
export function decodeContentBlocks(raw: unknown): DecodedContent {
  if (raw === undefined || raw === null) {
    return { blocks: [], doubleEncoded: false, warning: null };
  }
  if (Array.isArray(raw)) {
    return { blocks: raw, doubleEncoded: false, warning: null };
  }
  if (typeof raw !== "string") {
    return {
      blocks: [],
      doubleEncoded: false,
      warning: `content is a ${typeof raw}, not an array — block text unavailable`,
    };
  }
  const trimmed = raw.trim();
  if (trimmed === "") return { blocks: [], doubleEncoded: false, warning: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      blocks: [],
      doubleEncoded: false,
      warning:
        "content is a string that is not valid JSON — block text unavailable (the plain `text` field is used instead)",
    };
  }
  if (Array.isArray(parsed)) {
    return {
      blocks: parsed,
      doubleEncoded: true,
      warning: `content arrived as a JSON string and was decoded back to an array (${parsed.length} block(s))`,
    };
  }
  const nested = asRecord(parsed);
  if (nested && typeof nested.content === "string") {
    // A doubly-wrapped envelope has not been observed; recurse once and say so rather than guess.
    const inner = decodeContentBlocks(nested.content);
    return {
      blocks: inner.blocks,
      doubleEncoded: inner.blocks.length > 0,
      warning:
        inner.blocks.length > 0
          ? "content arrived as a JSON string of an object holding a content array — unwrapped once"
          : "content is a JSON string of an object with no usable content array",
    };
  }
  return {
    blocks: [],
    doubleEncoded: false,
    warning: "content is a JSON string that decodes to a non-array value — block text unavailable",
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Block extraction
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface ClaudeArtifact {
  /** `input.title` when the artifact tool_use carries one. */
  title: string | null;
  /** `input.type` — Claude's MIME-ish artifact type, e.g. `application/vnd.ant.code`. */
  type: string | null;
  /** `input.language` for code artifacts. */
  language: string | null;
  /** `input.content` — the artifact body. */
  content: string;
  /**
   * `input.command` when the export carried one. Two shapes exist in the real data:
   *  - `create` (with `content`) — a new artifact; `content` is its body.
   *  - `update` (with `new_str` / `old_str`) — an incremental EDIT of an existing artifact;
   *    there is no whole-body copy, so `new_str` is the piece this turn contributed.
   * `null` when the export carried no command (the documented single-object shape).
   */
  command: string | null;
  /** True when `content` holds only the edit (`new_str`), not a whole artifact body. */
  isPartial: boolean;
  /** `input.id` — the artifact's own identifier, when present. */
  artifactId: string | null;
  /** The `tool_use.id` of the block that carried it. */
  toolUseId: string | null;
}

export interface ClaudeCitation {
  url: string | null;
  title: string | null;
  citedText: string | null;
}

/**
 * A file referenced by a `document` or `image` content block. The bytes are never in
 * `conversations.json`, so this is a *reference*: the page renders it as an attachment line and
 * the media itself is reported as not imported.
 */
export interface ClaudeFileRef {
  kind: "document" | "image";
  /** `document.title` (the export gives the filename here). `image` blocks carry none. */
  title: string | null;
  fileUuid: string | null;
  /** `image.source`, when present. */
  source: string | null;
}

/** One `tool_use` call that is not an artifact — rendered as a one-line marker, never inlined. */
export interface ClaudeToolCall {
  name: string | null;
  toolUseId: string | null;
}

export interface ExtractedBlockText {
  /** Visible prose, in block order. Excludes thinking, tool calls and tool results. */
  text: string;
  /** Concatenated `thinking` blocks — the model's own reasoning, kept as thought text. */
  thoughtText: string;
  /** Generated artifacts (the `artifacts` tool_use), in block order. */
  artifacts: ClaudeArtifact[];
  /** Non-artifact tool calls, in block order — the transcript marks each one. */
  toolCalls: ClaudeToolCall[];
  /** `document` / `image` content blocks, in block order — attachment references, never prose. */
  fileRefs: ClaudeFileRef[];
  /** Web-search citation records attached to `text` blocks. */
  citations: ClaudeCitation[];
  /** Block kind → count, including unknown kinds (recorded as `unknown:<type>`). */
  blockKindCounts: Record<string, number>;
  /** Per-message parse notes (unknown block kinds, undecodable artifacts). */
  warnings: string[];
}

/** The `tool_use.name` whose `input` is a generated artifact rather than a tool call. */
const ARTIFACT_TOOL_NAME = "artifacts";

function readCitations(value: unknown, warnings: string[]): ClaudeCitation[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    warnings.push("text block has a non-array `citations` value — ignored");
    return [];
  }
  const out: ClaudeCitation[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) continue;
    const details = asRecord(record.details);
    out.push({
      url: asNonEmptyString(record.url) ?? asNonEmptyString(details?.url),
      title: asNonEmptyString(record.title) ?? asNonEmptyString(details?.title),
      citedText: asNonEmptyString(record.cited_text) ?? asNonEmptyString(details?.cited_text),
    });
  }
  return out;
}

/**
 * `tool_use.input` is normally an object; the double-encoding bug that hits `content` has been seen
 * to hit `input` too, so a string input is decoded once before it is rejected.
 */
function readArtifactInput(input: unknown, warnings: string[]): Record<string, unknown> | null {
  const direct = asRecord(input);
  if (direct) return direct;
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      const record = asRecord(parsed);
      if (record) return record;
    } catch {
      /* fall through to the warning below */
    }
    warnings.push("artifacts tool_use has a string `input` that is not a JSON object — skipped");
    return null;
  }
  if (input !== undefined && input !== null) {
    warnings.push("artifacts tool_use has no object `input` — skipped");
  }
  return null;
}

/**
 * Walk a decoded block array and pull out everything a message can contribute:
 * visible prose, thought text, artifacts, tool-call markers, attachment references, citations,
 * and a per-kind census.
 *
 * Totality is the point: an unknown block kind is *counted and warned about*, not thrown on,
 * because a future Claude block type must not make a 4,000-conversation export unimportable.
 *
 * The three kinds the real export adds over the documented set are handled explicitly, not as
 * `unknown`:
 *
 *   injected_prompt_block   counted (`injected_prompt_block`) and skipped — it is system/context
 *                           text injected into the turn, not something the user or the model said
 *   document / image        lifted into `fileRefs` (rendered as attachment references), never
 *                           appended to the visible prose
 */
export function extractBlockText(blocks: readonly unknown[]): ExtractedBlockText {
  const texts: string[] = [];
  const thoughts: string[] = [];
  const artifacts: ClaudeArtifact[] = [];
  const toolCalls: ClaudeToolCall[] = [];
  const fileRefs: ClaudeFileRef[] = [];
  const citations: ClaudeCitation[] = [];
  const blockKindCounts: Record<string, number> = {};
  const warnings: string[] = [];
  const unknownKinds = new Set<string>();

  const bump = (kind: string) => {
    blockKindCounts[kind] = (blockKindCounts[kind] ?? 0) + 1;
  };

  for (const rawBlock of blocks) {
    const block = asRecord(rawBlock);
    if (!block) {
      bump("unknown:<not-an-object>");
      unknownKinds.add("<not-an-object>");
      continue;
    }
    const type = typeof block.type === "string" ? block.type.trim() : "";
    if (type === "") {
      bump("unknown:<no type>");
      unknownKinds.add("<no type>");
      continue;
    }

    switch (type) {
      case "text": {
        bump("text");
        const raw = block.text;
        if (typeof raw === "string") {
          // An empty text block is normal (e.g. a message that was all tool calls).
          if (raw.trim() !== "") texts.push(raw);
        } else if (raw !== undefined && raw !== null) {
          warnings.push(`text block has a non-string \`text\` value (${typeof raw}) — ignored`);
        }
        citations.push(...readCitations(block.citations, warnings));
        break;
      }
      case "thinking": {
        bump("thinking");
        const value = typeof block.thinking === "string" ? block.thinking : "";
        if (value.trim() !== "") thoughts.push(value);
        else if (value !== "") warnings.push("thinking block has a non-string `thinking` value — ignored");
        if (block.cut_off === true) bump("thinking:cut_off");
        break;
      }
      case "tool_use": {
        const name = asNonEmptyString(block.name) ?? "";
        const toolUseId = asNonEmptyString(block.id);
        if (name === ARTIFACT_TOOL_NAME) {
          bump("tool_use:artifacts");
          const input = readArtifactInput(block.input, warnings);
          if (!input) break;
          const command = asNonEmptyString(input.command);
          const fullContent = typeof input.content === "string" ? input.content : "";
          // The real export carries artifact EDITS as well as creations: an `update` command
          // holds `new_str` / `old_str` and NO whole-body `content`. Treating only `content`
          // as the body would drop every edit silently; treating `new_str` as a body without
          // saying so would present a fragment as the artifact.
          const editStr = command === "update" && typeof input.new_str === "string" ? input.new_str : "";
          const content = fullContent.trim() !== "" ? fullContent : editStr;
          const isPartial = fullContent.trim() === "" && editStr.trim() !== "";
          if (content.trim() === "") {
            // A recognized artifact operation with no body: either a bare version reference
            // (`{version_uuid}` — a real observed shape, a revert/reference turn) or a command
            // that carries no text. Counted, not warned about. Anything else is a malformed
            // artifact block and is reported.
            const versionRef = asNonEmptyString(input.version_uuid);
            if (command !== null || versionRef !== null) {
              bump("tool_use:artifacts:bodyless");
            } else {
              warnings.push(
                "artifacts block carries no usable body (`content` absent and no `new_str`) — artifact dropped",
              );
            }
            break;
          }
          artifacts.push({
            title: asNonEmptyString(input.title),
            type: asNonEmptyString(input.type),
            language: asNonEmptyString(input.language),
            content,
            command,
            isPartial,
            artifactId: asNonEmptyString(input.id),
            toolUseId,
          });
          break;
        }
        bump("tool_use:other");
        // A tool call is not prose and not an artifact: it becomes a one-line marker.
        toolCalls.push({ name: name === "" ? null : name, toolUseId });
        break;
      }
      case "tool_result": {
        bump("tool_result");
        // Tool output is not the assistant's text. Counted only.
        break;
      }
      case "injected_prompt_block": {
        bump("injected_prompt_block");
        // Injected system / context text (a date note, a memory snapshot, a reminder). It is
        // machinery, never message content: counted, and deliberately NOT rendered — a single
        // memory snapshot can be tens of KB and would swamp the page.
        break;
      }
      case "document": {
        bump("document");
        fileRefs.push({
          kind: "document",
          title: asNonEmptyString(block.title),
          fileUuid: asNonEmptyString(block.file_uuid),
          source: null,
        });
        break;
      }
      case "image": {
        bump("image");
        fileRefs.push({
          kind: "image",
          title: null,
          fileUuid: asNonEmptyString(block.file_uuid),
          source: asNonEmptyString(block.source),
        });
        break;
      }
      case "token_budget": {
        bump("token_budget");
        break;
      }
      case "summaries": {
        bump("summaries");
        break;
      }
      default: {
        bump(`unknown:${type}`);
        unknownKinds.add(type);
        break;
      }
    }
  }

  if (unknownKinds.size > 0) {
    warnings.push(
      `unknown content block kind(s) ignored: ${[...unknownKinds].sort().join(", ")}`,
    );
  }

  return {
    text: texts.join(TEXT_BLOCK_JOIN),
    thoughtText: thoughts.join(TEXT_BLOCK_JOIN),
    artifacts,
    toolCalls,
    fileRefs,
    citations,
    blockKindCounts,
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Attachments
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface ClaudeAttachment {
  name: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  /** `file_uuid` when the export carries one — the join key to a `document` / `image` block. */
  fileUuid: string | null;
  /** Which structural shape it was found in — `array`, `map`, or `file` (the `files` field). */
  shape: "array" | "map" | "file";
}

export interface NormalizedAttachments {
  attachments: ClaudeAttachment[];
  /** Shapes this parser could not read at all (counted, then reported). */
  skippedShapes: number;
  warnings: string[];
}

function readOneAttachment(value: unknown, shape: ClaudeAttachment["shape"]): ClaudeAttachment | null {
  const record = asRecord(value);
  if (!record) return null;
  return {
    name:
      asNonEmptyString(record.file_name) ??
      asNonEmptyString(record.filename) ??
      asNonEmptyString(record.name),
    mimeType:
      asNonEmptyString(record.file_type) ??
      asNonEmptyString(record.mime_type) ??
      asNonEmptyString(record.media_type),
    sizeBytes:
      typeof record.file_size === "number" && Number.isFinite(record.file_size)
        ? record.file_size
        : null,
    fileUuid: asNonEmptyString(record.file_uuid),
    shape,
  };
}

/**
 * Attachments and files appear in several shapes across exports. All of them are read into one
 * array; anything unrecognised is counted (`skippedShapes`) and warned about, never guessed at.
 *
 *   1. an **array** of objects — the documented shape                    → `shape: "array"`
 *   2. an **object keyed by an id** (`{"first-upload": {…}}`)            → `shape: "map"`
 *   3. a single object, or the `files` field's parallel array            → `shape: "file"`
 *   4. a bare string (a filename), a number, `null` — unusable           → counted as skipped
 *
 * Binary bytes are never part of `conversations.json`, so nothing is copied: the attachment record
 * is preserved (name / mime / size / file_uuid) and the media itself is reported as not imported.
 */
export function normalizeAttachments(attachments: unknown, files: unknown): NormalizedAttachments {
  const out: ClaudeAttachment[] = [];
  const warnings: string[] = [];
  let skippedShapes = 0;

  const consume = (value: unknown, shape: "array" | "map" | "file", label: string) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      for (const entry of value) {
        const one = readOneAttachment(entry, shape);
        if (one) out.push(one);
        else skippedShapes += 1;
      }
      return;
    }
    const record = asRecord(value);
    if (record) {
      // An object map: each value is an attachment (the keys are upload ids, not fields).
      const values = Object.values(record);
      const reads = values.map((v) => readOneAttachment(v, shape === "file" ? "file" : "map"));
      if (reads.some((r) => r !== null)) {
        for (const one of reads) {
          if (one) out.push(one);
          else skippedShapes += 1;
        }
        return;
      }
      // A single attachment object rather than a map of them.
      const single = readOneAttachment(record, shape);
      if (single) out.push(single);
      else skippedShapes += 1;
      return;
    }
    // A string / number / boolean. `files: "…"` is a real observed shape.
    skippedShapes += 1;
    warnings.push(`${label} carries a ${typeof value} where an attachment list was expected — skipped`);
  };

  consume(attachments, "array", "`attachments`");
  consume(files, "file", "`files`");

  return { attachments: out, skippedShapes, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Messages
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Where a message's visible prose came from. */
export type MessageTextSource = "content" | "text field" | "none";

export interface ClaudeMessage {
  /** `null` ⇒ the message cannot be deduped on a re-run and is not rendered as a content turn. */
  uuid: string | null;
  sender: ClaudeSender;
  senderRaw: string | null;
  /** Visible prose. Empty when the message carried none (thought/artifact-only messages). */
  text: string;
  /** Which field `text` was read from — printed in the plan so the choice is auditable. */
  textSource: MessageTextSource;

  thoughtText: string;
  artifacts: ClaudeArtifact[];
  toolCalls: ClaudeToolCall[];
  fileRefs: ClaudeFileRef[];
  citations: ClaudeCitation[];
  attachments: ClaudeAttachment[];
  attachmentShapesSkipped: number;
  createdAt: Date | null;
  updatedAt: Date | null;
  /** True when this message's `content` arrived double-encoded. */
  doubleEncodedContent: boolean;
  blockKindCounts: Record<string, number>;
  warnings: string[];
  /** Position in `chat_messages[]` — conversations are linear, so this is the whole ordering. */
  index: number;
}

/** Total: an unreadable message yields a message object with warnings, never a throw. */
export function parseClaudeMessage(raw: unknown, index: number): ClaudeMessage {
  const warnings: string[] = [];
  const record = asRecord(raw);
  if (!record) {
    return {
      uuid: null,
      sender: "other",
      senderRaw: null,
      text: "",
      textSource: "none",
      thoughtText: "",
      artifacts: [],
      toolCalls: [],
      fileRefs: [],
      citations: [],
      attachments: [],
      attachmentShapesSkipped: 1,
      createdAt: null,
      updatedAt: null,
      doubleEncodedContent: false,
      blockKindCounts: { "unknown:<not-an-object>": 1 },
      warnings: ["message is not a JSON object — ignored"],
      index,
    };
  }

  const uuid = asNonEmptyString(record.uuid);
  if (!uuid) warnings.push("message has no uuid");

  const { sender, raw: senderRaw } = normalizeSender(record.sender);
  if (sender === "other" && senderRaw !== null) {
    warnings.push(`unrecognised sender "${senderRaw}" — stored as "other"`);
  }

  const decoded = decodeContentBlocks(record.content);
  if (decoded.warning !== null) warnings.push(decoded.warning);

  const extracted = extractBlockText(decoded.blocks);
  warnings.push(...extracted.warnings);

  // Documented precedence: the content array wins whenever it is non-empty; the plain `text`
  // field is the fallback (it is also the only source when there is no content array at all).
  const plainText = typeof record.text === "string" ? record.text : "";
  const usedContent = decoded.blocks.length > 0;
  const text = usedContent ? extracted.text : plainText.trim();
  const textSource: MessageTextSource =
    text.trim() === "" ? "none" : usedContent ? "content" : "text field";

  const attachments = normalizeAttachments(record.attachments, record.files);
  warnings.push(...attachments.warnings);

  const createdAt = toDate(record.created_at);
  if (record.created_at !== undefined && record.created_at !== null && createdAt === null) {
    warnings.push(`unparseable created_at ${JSON.stringify(record.created_at)} — stored as NULL`);
  }
  const updatedAt = toDate(record.updated_at);

  return {
    uuid,
    sender,
    senderRaw,
    text,
    textSource,
    thoughtText: extracted.thoughtText,
    artifacts: extracted.artifacts,
    toolCalls: extracted.toolCalls,
    fileRefs: extracted.fileRefs,
    citations: extracted.citations,
    attachments: attachments.attachments,
    attachmentShapesSkipped: attachments.skippedShapes,
    createdAt,
    updatedAt,
    doubleEncodedContent: decoded.doubleEncoded,
    blockKindCounts: extracted.blockKindCounts,
    warnings,
    index,
  };
}

/**
 * True when a message contributes content to the page: prose, thought, an artifact, or an
 * attachment reference. A tool-only / injected-only turn contributes none — it is still counted,
 * and the transcript renders a one-line marker so the turn is not silently lost.
 */
export function messageHasImportableContent(message: ClaudeMessage): boolean {
  return (
    message.text.trim() !== "" ||
    message.thoughtText.trim() !== "" ||
    message.artifacts.length > 0 ||
    message.fileRefs.length > 0 ||
    message.attachments.length > 0
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Conversations
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface ClaudeConversation {
  /** `null` ⇒ identity is unrecoverable ⇒ refused by the planner. */
  uuid: string | null;
  title: string;
  summary: string | null;
  accountUuid: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  messages: ClaudeMessage[];
  /** Raw `chat_messages` length (before per-message accounting), for the parser report. */
  rawMessageCount: number;
  warnings: string[];
  /** Position in the export array — the deterministic `--limit` order. */
  index: number;
}

/** Total: an unreadable conversation yields a conversation object with warnings, never a throw. */
export function parseClaudeConversation(raw: unknown, index: number): ClaudeConversation {
  const warnings: string[] = [];
  const record = asRecord(raw);
  if (!record) {
    return {
      uuid: null,
      title: "",
      summary: null,
      accountUuid: null,
      createdAt: null,
      updatedAt: null,
      messages: [],
      rawMessageCount: 0,
      warnings: ["conversation is not a JSON object — ignored"],
      index,
    };
  }

  const uuid = asNonEmptyString(record.uuid);
  if (!uuid) warnings.push("conversation has no uuid");

  const title = asNonEmptyString(record.name) ?? "";
  const summary = asNonEmptyString(record.summary);
  const account = asRecord(record.account);
  const accountUuid = asNonEmptyString(account?.uuid);

  const createdAt = toDate(record.created_at);
  if (record.created_at !== undefined && record.created_at !== null && createdAt === null) {
    warnings.push(`unparseable created_at ${JSON.stringify(record.created_at)} — stored as NULL`);
  }
  const updatedAt = toDate(record.updated_at);

  let rawMessages: unknown[] = [];
  if (record.chat_messages === undefined || record.chat_messages === null) {
    warnings.push("conversation has no chat_messages array");
  } else if (!Array.isArray(record.chat_messages)) {
    warnings.push(
      `chat_messages is a ${typeof record.chat_messages}, not an array — treated as empty`,
    );
  } else {
    rawMessages = record.chat_messages;
  }

  const messages = rawMessages.map((message, i) => parseClaudeMessage(message, i));

  return {
    uuid,
    title,
    summary,
    accountUuid,
    createdAt,
    updatedAt,
    messages,
    rawMessageCount: rawMessages.length,
    warnings,
    index,
  };
}

export interface ClaudeParseResult {
  conversations: ClaudeConversation[];
  /** Parse notes that belong to the file rather than to one conversation. */
  warnings: string[];
}

/**
 * Parse the whole `conversations.json`. Throws ONLY when the file is not a JSON array of
 * conversations — that is a wrong-file mistake, not a per-item defect, and it must be loud.
 * Everything inside is total: one bad conversation cannot abort the parse.
 */
export function parseClaudeConversationsJson(text: string): ClaudeParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `conversations.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    const shape = parsed === null ? "null" : Array.isArray(parsed) ? "array" : typeof parsed;
    throw new Error(
      `conversations.json must be a JSON array of conversations (got ${shape}) — is this really a Claude export?`,
    );
  }
  return {
    conversations: parsed.map((conversation, i) => parseClaudeConversation(conversation, i)),
    warnings: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Slugs — validated against the app's own Slug.of, never sanitized silently
// (mirrors `apps/web/lib/import/anytype.ts`; kept local so the two importers stay independent)
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Mirrors the AnyType importer's namer. */
export const SLUG_MAX_LENGTH = 48;

/**
 * ASCII-fold, lowercase, and collapse every run of non-`[a-z0-9]` into a single `-`.
 * The result is always a legal slug segment or the empty string — it never contains a `/`,
 * a leading `.`/`-`, or a non-ASCII byte, so it cannot escape its `notes/` directory.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, "");
}

/**
 * A slug is valid iff the app's own `Slug.of` accepts it — the same rule the inbox walk
 * enforces (`packages/core/src/domain/slug.ts`), so a planned path can never be the invalid
 * filename that turns a brain-repo read into an outage.
 */
export function isValidSlugPath(path: string): boolean {
  try {
    Slug.of(path);
    return true;
  } catch {
    return false;
  }
}

/** Title → slug, falling back to the conversation uuid (a uuid slugifies to hex + dashes). */
export function deriveSlug(title: string, uuid: string): string | null {
  const fromTitle = slugify(title);
  if (fromTitle !== "") return fromTitle;
  const fromUuid = slugify(uuid).replace(/-/g, "");
  return fromUuid === "" ? null : `claude-${fromUuid.slice(0, 8)}`;
}

/** The page title: the conversation name, else a date-stamped one, else a uuid-stamped one. */
export function conversationTitle(conversation: ClaudeConversation): string {
  if (conversation.title.trim() !== "") return conversation.title.trim();
  const created = conversation.createdAt;
  if (created) return `Claude conversation ${created.toISOString().slice(0, 10)}`;
  const uuid = conversation.uuid ?? "";
  const fromUuid = slugify(uuid).replace(/-/g, "");
  return fromUuid === "" ? "Claude conversation" : `Claude conversation ${fromUuid.slice(0, 8)}`;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Transcript rendering — one conversation → one readable Markdown body
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** A fence long enough to hold `content` verbatim (artifacts routinely contain ``` fences). */
function fenced(content: string, language: string | null): string {
  let longestRun = 0;
  let run = 0;
  for (const ch of content) {
    if (ch === "`") {
      run += 1;
      if (run > longestRun) longestRun = run;
    } else {
      run = 0;
    }
  }
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}${language ?? ""}\n${content}\n${fence}`;
}

function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.trim() === "" ? ">" : `> ${line}`))
    .join("\n");
}

function speakerLabel(message: ClaudeMessage): string {
  if (message.sender === "assistant") return "Assistant";
  if (message.sender === "human") return "Human";
  return `Other${message.senderRaw ? ` (${message.senderRaw})` : ""}`;
}

/**
 * One attachment line per referenced file, merging the `document`/`image` content block (which
 * carries the kind, and a title for documents) with the `attachments`/`files` record (which
 * carries name / mime / size) on their shared `file_uuid`.
 */
function attachmentItems(message: ClaudeMessage): string[] {
  interface Item {
    kind: string | null;
    name: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
    fileUuid: string | null;
  }
  const byKey = new Map<string, Item>();
  for (const ref of message.fileRefs) {
    const key = ref.fileUuid ?? `ref:${ref.kind}:${ref.title ?? ""}`;
    byKey.set(key, {
      kind: ref.kind,
      name: ref.title,
      mimeType: null,
      sizeBytes: null,
      fileUuid: ref.fileUuid,
    });
  }
  for (const attachment of message.attachments) {
    const key = attachment.fileUuid ?? `att:${attachment.name ?? "unnamed"}:${attachment.shape}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.name = existing.name ?? attachment.name;
      existing.mimeType = attachment.mimeType;
      existing.sizeBytes = attachment.sizeBytes;
      continue;
    }
    byKey.set(key, {
      kind: null,
      name: attachment.name,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      fileUuid: attachment.fileUuid,
    });
  }

  return [...byKey.values()].map((item) => {
    const details: string[] = [];
    if (item.mimeType) details.push(item.mimeType);
    if (item.sizeBytes !== null) details.push(`${item.sizeBytes} bytes`);
    if (item.fileUuid) details.push(`file ${item.fileUuid}`);
    const label = item.kind
      ? `${item.kind}: ${item.name ?? "(unnamed)"}`
      : (item.name ?? "(unnamed)");
    return `- ${label}${details.length > 0 ? ` — ${details.join(", ")}` : ""}`;
  });
}

/**
 * The Markdown one message contributes. Everything is clearly marked:
 *
 *   `## <speaker> — <ISO timestamp>`   the turn heading
 *   prose                              verbatim
 *   `**Thinking**` + blockquote        the model's reasoning (a marked sub-section)
 *   `**Artifacts**` + fenced code      the assistant's generated output
 *   `*[tool call: name]*`              a marker; the tool's input/output are NOT inlined
 *   `**Attachments**` + list           attachment references (never the bytes)
 *   `*Sources:*` + list                web-search citations
 */
export function renderMessageMarkdown(message: ClaudeMessage): string {
  const parts: string[] = [];
  const heading =
    message.createdAt === null
      ? `## ${speakerLabel(message)}`
      : `## ${speakerLabel(message)} — ${message.createdAt.toISOString()}`;
  parts.push(heading);

  if (message.text.trim() !== "") parts.push(message.text.trimEnd());

  for (const call of message.toolCalls) {
    parts.push(`*[tool call: \`${call.name ?? "unnamed"}\`]*`);
  }

  if (message.thoughtText.trim() !== "") {
    parts.push(`**Thinking**\n\n${quote(message.thoughtText.trimEnd())}`);
  }

  for (const artifact of message.artifacts) {
    const label = artifact.title ?? "(untitled)";
    const meta = [artifact.type, artifact.language].filter((v): v is string => v !== null);
    // An `update` artifact is an incremental edit (`new_str`, no whole-body `content`): say so,
    // so a fragment is never mistaken for the artifact's full contents.
    const suffix = artifact.isPartial ? " — updated excerpt" : "";
    parts.push(
      `**Artifact: ${label}${meta.length > 0 ? ` (${meta.join(", ")})` : ""}${suffix}**\n\n${fenced(
        artifact.content.trimEnd(),
        artifact.language,
      )}`,
    );
  }

  const attachments = attachmentItems(message);
  if (attachments.length > 0) {
    parts.push(`**Attachments**\n\n${attachments.join("\n")}`);
  }

  const sources = message.citations
    .map((citation) => {
      const label = citation.title ?? citation.url ?? "(unnamed source)";
      return citation.url ? `- [${label}](${citation.url})` : `- ${label}`;
    })
    .filter((line, i, all) => all.indexOf(line) === i);
  if (sources.length > 0) parts.push(`*Sources:*\n\n${sources.join("\n")}`);

  // A turn that carries nothing renderable is still shown, so the transcript never silently
  // drops a turn: the marker names the block kinds that were the whole of it.
  if (parts.length === 1) {
    const kinds = Object.keys(message.blockKindCounts).sort().join(", ") || "none";
    parts.push(`*(no importable text — content blocks: ${kinds})*`);
  }

  return parts.join("\n\n");
}

/** The page body: a provenance header, the summary, then every turn in order. */
export function renderConversationBody(conversation: ClaudeConversation, title: string): string {
  const header: string[] = [`# ${title}`];

  const span =
    conversation.createdAt && conversation.updatedAt
      ? `${conversation.createdAt.toISOString()} → ${conversation.updatedAt.toISOString()}`
      : conversation.createdAt
        ? `created ${conversation.createdAt.toISOString()}`
        : conversation.updatedAt
          ? `updated ${conversation.updatedAt.toISOString()}`
          : "no timestamp in the export";
  header.push(
    `*Imported from a Claude.ai data export — conversation ${
      conversation.uuid ?? "(no uuid)"
    } — ${span} — ${conversation.messages.length} message(s)*`,
  );

  if (conversation.summary !== null) {
    header.push(`> **Summary.** ${conversation.summary}`);
  }

  const turns =
    conversation.messages.length === 0
      ? ["*(this conversation carries no chat_messages)*"]
      : conversation.messages.map(renderMessageMarkdown);

  return [...header, ...turns].join("\n\n");
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Page serialization — must survive the brain store's `splitFrontmatter` + js-yaml `load`
// (the same emitter as `apps/web/lib/import/anytype.ts`)
// ─────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Serialize a page file exactly the way `FsGitBrainStore.savePage` does
 * (`["---", dump(frontmatter).trim(), "---", body.trimEnd()].join("\n") + "\n"`), with a
 * hand-rolled emitter because `js-yaml` is not a declared dependency of `apps/web`.
 *
 * Values are JSON-quoted: a JSON string is a valid YAML double-quoted scalar, and quoting
 * removes every way a title containing `:`, `#`, or a leading `-` could corrupt the block.
 * A body whose first line is `---` would terminate the frontmatter block early — this renderer
 * always starts the body with the `# <title>` heading, so that can never happen.
 */
export function serializePageFile(frontmatter: Record<string, string>, body: string): string {
  const lines = Object.entries(frontmatter).map(
    ([key, value]) => `${key}: ${JSON.stringify(value)}`,
  );
  return ["---", lines.join("\n"), "---", body.trimEnd()].join("\n") + "\n";
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Plan
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * What this importer will do to one destination page:
 *
 *   WRITE            the destination file does not exist → create it
 *   UPDATE           it exists with this conversation's uuid but different content (e.g. the
 *                    export was re-downloaded after more messages were added) → overwrite it
 *   SKIP-identical   it exists and is byte-identical to what would be written → leave it alone
 *   SKIP-conflict    it exists and is NOT this conversation's page (uuid absent, or a different
 *                    conversation's) → refuse to overwrite
 *   SKIP-unsupported the conversation has no uuid → identity is unrecoverable, so it is refused
 */
export type PageAction = "WRITE" | "UPDATE" | "SKIP-identical" | "SKIP-conflict" | "SKIP-unsupported";

export interface PlannedMessage {
  position: number;
  messageUuid: string | null;
  sender: ClaudeSender;
  senderRaw: string | null;
  /** True when the turn contributes prose / thought / artifact / attachment reference. */
  rendered: boolean;
  /** Why the turn is rendered (or not). */
  reason: string;
  text: string;
  thoughtText: string;
  artifacts: ClaudeArtifact[];
  citations: ClaudeCitation[];
  attachments: ClaudeAttachment[];
  fileRefs: ClaudeFileRef[];
  toolCalls: ClaudeToolCall[];
  blockKindCounts: Record<string, number>;
  createdAt: Date | null;
  updatedAt: Date | null;
  /** The exact Markdown this turn contributes to the page body. */
  markdown: string;
}

export interface PlannedConversation {
  target: "brain page";
  action: PageAction;
  reason: string;
  conversationUuid: string | null;
  title: string;
  summary: string | null;
  accountUuid: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  /** Every message of this conversation, in order, each with its own accounting. */
  messages: PlannedMessage[];
  messageCounts: { rendered: number; placeholder: number };
  slug: string;
  /** Repo-relative path, e.g. `notes/my-conversation.md`. */
  relPath: string;
  pageType: PageType;
  /** The page's frontmatter — DERIVED FROM THE EXPORT ONLY, so a re-run is byte-identical. */
  frontmatter: Record<string, string>;
  /** The rendered page body (speaker headings + marked sub-sections). */
  body: string;
  /** `serializePageFile(frontmatter, body)` — what the write (or the comparison) uses. */
  fileText: string;
  /** True when ANY message of this conversation arrived double-encoded. */
  doubleEncodedContent: boolean;
  warnings: string[];
  index: number;
}

export interface ClaudeCountRow {
  label: string;
  count: number;
}

export interface ClaudePlanStats {
  conversations: number;
  conversationsWithMessages: number;
  conversationsEmpty: number;
  messages: number;
  messagesBySender: ClaudeCountRow[];
  messagesByContentBlockKind: ClaudeCountRow[];
  doubleEncodedMessages: number;
  attachments: number;
  attachmentShapesSkipped: number;
  /** Distinct files referenced by `document` / `image` blocks (bytes never imported). */
  referencedFiles: number;
}

export interface ClaudePlan {
  conversations: PlannedConversation[];
  stats: ClaudePlanStats;
  /** Every parser warning, prefixed with the conversation it came from. */
  warnings: string[];
}

export interface PlanContext {
  /** Repo-relative path → the raw text already at that path (`undefined` ⇒ nothing there). */
  existingPages: ReadonlyMap<string, string>;
  /** Provenance string written to the page frontmatter. */
  importSource: string;
}

/** The stable frontmatter of a conversation page. Nothing here is a run timestamp. */
function pageFrontmatter(
  conversation: ClaudeConversation,
  title: string,
  ctx: PlanContext,
): Record<string, string> {
  const frontmatter: Record<string, string> = {
    type: CLAUDE_PAGE_TYPE,
    title,
    claude_conversation_uuid: conversation.uuid ?? "",
    claude_message_count: String(conversation.messages.length),
    import_source: ctx.importSource,
  };
  // `date` is the key the brain's date extractor actually reads on a `notes/` slug (`event_date`
  // | `date` | `published`, plus a lead filename date for daily/ + meetings/ slugs only). Every
  // other key is invisible to it: a page whose real date lives only under `claude_created_at` is
  // indexed with its IMPORT time and cannot be found by a date-scoped recall, however precise
  // that provenance key is. The conversation's own creation date is repeated here — the same
  // instant as `claude_created_at`, so the two can never disagree.
  if (conversation.createdAt) frontmatter.date = conversation.createdAt.toISOString();
  if (conversation.createdAt) frontmatter.claude_created_at = conversation.createdAt.toISOString();
  if (conversation.updatedAt) frontmatter.claude_updated_at = conversation.updatedAt.toISOString();
  if (conversation.accountUuid) frontmatter.claude_account_uuid = conversation.accountUuid;
  return frontmatter;
}

function toPlannedMessage(message: ClaudeMessage): PlannedMessage {
  const rendered = messageHasImportableContent(message);
  const reason = rendered
    ? message.textSource === "content"
      ? "rendered — text taken from the content array"
      : message.textSource === "text field"
        ? "rendered — text taken from the plain text field (no content array)"
        : "rendered — no prose, but a thought / artifact / attachment is present"
    : `not rendered — the content blocks carry no prose, no thought, no artifact and no attachment (block kinds: ${
        Object.keys(message.blockKindCounts).sort().join(", ") || "none"
      })`;
  return {
    position: message.index,
    messageUuid: message.uuid,
    sender: message.sender,
    senderRaw: message.senderRaw,
    rendered,
    reason,
    text: message.text,
    thoughtText: message.thoughtText,
    artifacts: message.artifacts,
    citations: message.citations,
    attachments: message.attachments,
    fileRefs: message.fileRefs,
    toolCalls: message.toolCalls,
    blockKindCounts: message.blockKindCounts,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    markdown: renderMessageMarkdown(message),
  };
}

/**
 * Turn parsed conversations into an explicit, per-page action plan. Pure — no I/O, no writes.
 *
 * Every parsed conversation and every parsed message appears exactly once in the result, so the
 * accounting can never silently lose an item. The page decision is:
 *
 *   nothing at the destination      → WRITE
 *   our uuid, different text        → UPDATE
 *   our uuid, identical text        → SKIP-identical
 *   foreign / uuid-less file there  → SKIP-conflict (never overwritten)
 *   conversation has no uuid        → SKIP-unsupported (a re-run could not dedupe it)
 */
export function buildPlan(
  conversations: readonly ClaudeConversation[],
  ctx: PlanContext,
): ClaudePlan {
  const planned: PlannedConversation[] = [];
  const warnings: string[] = [];

  const senderCounts = new Map<string, number>();
  const blockKindTotals = new Map<string, number>();
  let doubleEncodedMessages = 0;
  let attachmentCount = 0;
  let attachmentShapesSkipped = 0;
  let referencedFiles = 0;
  let messageTotal = 0;
  let conversationsWithMessages = 0;
  let conversationsEmpty = 0;

  // Slug collisions within the export: first conversation wins the bare slug, later ones get a
  // uuid-derived suffix. Deterministic and independent of what is already on disk.
  const slugOwner = new Map<string, string>();

  for (const conversation of conversations) {
    for (const warning of conversation.warnings) {
      warnings.push(`${conversation.uuid ?? `conversation #${conversation.index}`}: ${warning}`);
    }

    const messages: PlannedMessage[] = [];
    const messageCounts = { rendered: 0, placeholder: 0 };
    let conversationDoubleEncoded = false;

    for (const message of conversation.messages) {
      messageTotal += 1;
      senderCounts.set(message.sender, (senderCounts.get(message.sender) ?? 0) + 1);
      for (const [kind, count] of Object.entries(message.blockKindCounts)) {
        blockKindTotals.set(kind, (blockKindTotals.get(kind) ?? 0) + count);
      }
      if (message.doubleEncodedContent) {
        doubleEncodedMessages += 1;
        conversationDoubleEncoded = true;
      }
      attachmentCount += message.attachments.length;
      attachmentShapesSkipped += message.attachmentShapesSkipped;
      referencedFiles += message.fileRefs.length;
      for (const warning of message.warnings) {
        warnings.push(
          `${conversation.uuid ?? `conversation #${conversation.index}`} · message #${message.index}: ${warning}`,
        );
      }

      const plannedMessage = toPlannedMessage(message);
      if (plannedMessage.rendered) messageCounts.rendered += 1;
      else messageCounts.placeholder += 1;
      messages.push(plannedMessage);
    }

    if (messages.length > 0) conversationsWithMessages += 1;
    else conversationsEmpty += 1;

    // ── destination ──────────────────────────────────────────────────────────────────────────
    if (conversation.uuid === null) {
      planned.push({
        target: "brain page",
        action: "SKIP-unsupported",
        reason:
          "conversation has no uuid — identity is unrecoverable, and without it a re-run cannot tell an already-imported conversation from a new one",
        conversationUuid: null,
        title: conversationTitle(conversation),
        summary: conversation.summary,
        accountUuid: conversation.accountUuid,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messages,
        messageCounts,
        slug: "",
        relPath: "",
        pageType: CLAUDE_PAGE_TYPE,
        frontmatter: {},
        body: "",
        fileText: "",
        doubleEncodedContent: conversationDoubleEncoded,
        warnings: conversation.warnings,
        index: conversation.index,
      });
      continue;
    }

    const title = conversationTitle(conversation);
    let slug = deriveSlug(title, conversation.uuid);
    if (slug === null) {
      planned.push({
        target: "brain page",
        action: "SKIP-unsupported",
        reason: "title and conversation uuid both produced an empty slug — no valid filename",
        conversationUuid: conversation.uuid,
        title,
        summary: conversation.summary,
        accountUuid: conversation.accountUuid,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messages,
        messageCounts,
        slug: "",
        relPath: "",
        pageType: CLAUDE_PAGE_TYPE,
        frontmatter: {},
        body: "",
        fileText: "",
        doubleEncodedContent: conversationDoubleEncoded,
        warnings: conversation.warnings,
        index: conversation.index,
      });
      continue;
    }

    let relPath = `${CLAUDE_PAGE_DIR}/${slug}.md`;
    let collisionNote = "";
    const owner = slugOwner.get(relPath);
    if (owner !== undefined && owner !== conversation.uuid) {
      const suffix = slugify(conversation.uuid).replace(/-/g, "").slice(0, 8) || "dup";
      slug = `${slug}-${suffix}`;
      relPath = `${CLAUDE_PAGE_DIR}/${slug}.md`;
      collisionNote = ` (slug collision with ${owner.slice(0, 8)}… within this export — suffixed to avoid clobbering)`;
      let n = 2;
      while (slugOwner.has(relPath)) {
        slug = `${slugify(title) || "conversation"}-${suffix}-${n}`;
        relPath = `${CLAUDE_PAGE_DIR}/${slug}.md`;
        n += 1;
      }
    }

    // The app's own validator is the gate — a path it rejects must never be planned.
    if (!isValidSlugPath(relPath)) {
      planned.push({
        target: "brain page",
        action: "SKIP-unsupported",
        reason: `derived path "${relPath}" is rejected by Slug.of — refusing to write it`,
        conversationUuid: conversation.uuid,
        title,
        summary: conversation.summary,
        accountUuid: conversation.accountUuid,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messages,
        messageCounts,
        slug,
        relPath,
        pageType: CLAUDE_PAGE_TYPE,
        frontmatter: {},
        body: "",
        fileText: "",
        doubleEncodedContent: conversationDoubleEncoded,
        warnings: conversation.warnings,
        index: conversation.index,
      });
      continue;
    }
    slugOwner.set(relPath, conversation.uuid);

    const frontmatter = pageFrontmatter(conversation, title, ctx);
    const body = renderConversationBody(conversation, title);
    const fileText = serializePageFile(frontmatter, body);

    const base = {
      target: "brain page" as const,
      conversationUuid: conversation.uuid,
      title,
      summary: conversation.summary,
      accountUuid: conversation.accountUuid,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messages,
      messageCounts,
      slug,
      relPath,
      pageType: CLAUDE_PAGE_TYPE,
      frontmatter,
      body,
      fileText,
      doubleEncodedContent: conversationDoubleEncoded,
      warnings: conversation.warnings,
      index: conversation.index,
    };

    const existing = ctx.existingPages.get(relPath);
    if (existing === undefined) {
      planned.push({
        ...base,
        action: "WRITE",
        reason: `new brain page (type=${CLAUDE_PAGE_TYPE})${collisionNote}`,
      });
      continue;
    }
    if (existing === fileText) {
      planned.push({
        ...base,
        action: "SKIP-identical",
        reason: "the destination already holds this exact page (conversation uuid + identical content)",
      });
      continue;
    }
    if (existing.includes(`claude_conversation_uuid: ${JSON.stringify(conversation.uuid)}`)) {
      planned.push({
        ...base,
        action: "UPDATE",
        reason: "the destination holds this conversation with different content — rewriting the page",
      });
      continue;
    }
    planned.push({
      ...base,
      action: "SKIP-conflict",
      reason: `the destination exists and is not this conversation's page (no \`claude_conversation_uuid\` matching ${
        conversation.uuid
      }) — refusing to overwrite${collisionNote}`,
    });
  }

  const sorted = (m: Map<string, number>): ClaudeCountRow[] =>
    [...m.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));

  return {
    conversations: planned,
    stats: {
      conversations: planned.length,
      conversationsWithMessages,
      conversationsEmpty,
      messages: messageTotal,
      messagesBySender: sorted(senderCounts),
      messagesByContentBlockKind: sorted(blockKindTotals),
      doubleEncodedMessages,
      attachments: attachmentCount,
      attachmentShapesSkipped,
      referencedFiles,
    },
    warnings,
  };
}
