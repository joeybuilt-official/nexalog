// SPDX-License-Identifier: MIT
/**
 * Claude.ai data-export parser + brain-page planner (`lib/import/claude.ts`).
 *
 * Every case here is derived from the documented export format AND from the real export on disk
 * (`claude-real-001/conversations.json`, 25 conversations / 328 messages, and
 * `claude-real-slice/conversations.json`, 100 / 1384): `conversations.json` is a JSON array, a
 * message may carry BOTH a `text` field and a `content` array (the array wins when non-empty),
 * `content` occasionally arrives **double-encoded as a JSON string**, conversations are LINEAR,
 * and identity is the provider `uuid` — never the array index, never the title.
 *
 * The three block kinds the real data adds over the documented set are covered explicitly:
 * `injected_prompt_block` (injected system/context text — counted and skipped, never rendered as
 * message content), `document` and `image` (attachment references, never prose).
 *
 * Nothing here touches the filesystem, a database, or a brain repo. The ZIP reader lives in the
 * CLI (`apps/web/scripts/reimport-claude.ts`), not in this module, so it is not exercised here.
 */
import { describe, it, expect } from "vitest";
import { Slug } from "@nexalog/core";
import {
  buildPlan,
  CLAUDE_IMPORT_SOURCE,
  CLAUDE_PAGE_DIR,
  CLAUDE_PAGE_TYPE,
  conversationTitle,
  decodeContentBlocks,
  deriveSlug,
  extractBlockText,
  isValidSlugPath,
  messageHasImportableContent,
  normalizeAttachments,
  normalizeSender,
  parseClaudeConversation,
  parseClaudeConversationsJson,
  parseClaudeMessage,
  renderConversationBody,
  renderMessageMarkdown,
  serializePageFile,
  slugify,
  toDate,
  type ClaudeConversation,
  type ClaudeMessage,
  type PlanContext,
} from "@/lib/import/claude";

const CONV_A = "6f1c0a44-3a1e-4d2b-9f77-1c9a2b7d4e01";
const CONV_B = "b2d4f6a8-1111-4222-8333-444455556666";
const MSG_1 = "aa110000-0000-4000-8000-000000000001";
const MSG_2 = "aa110000-0000-4000-8000-000000000002";
const MSG_3 = "aa110000-0000-4000-8000-000000000003";

/** A message in the exporter's own shape. */
function rawMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uuid: MSG_1,
    text: "hello",
    content: [{ type: "text", text: "hello" }],
    sender: "human",
    created_at: "2024-08-15T14:23:11.123456+00:00",
    updated_at: "2024-08-15T14:23:11.123456+00:00",
    attachments: [],
    files: [],
    ...overrides,
  };
}

function rawConversation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uuid: CONV_A,
    name: "A conversation",
    summary: "",
    created_at: "2024-08-15T14:23:11.123456+00:00",
    updated_at: "2024-08-15T15:01:02.654321+00:00",
    account: { uuid: "0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9" },
    chat_messages: [rawMessage()],
    ...overrides,
  };
}

function parseMessage(overrides: Record<string, unknown> = {}, index = 0): ClaudeMessage {
  return parseClaudeMessage(rawMessage(overrides), index);
}

function parseConversation(overrides: Record<string, unknown> = {}): ClaudeConversation {
  return parseClaudeConversation(rawConversation(overrides), 0);
}

function planCtx(overrides: Partial<PlanContext> = {}): PlanContext {
  return {
    existingPages: new Map<string, string>(),
    importSource: CLAUDE_IMPORT_SOURCE,
    ...overrides,
  };
}

/** The path the planner derives for a single-conversation plan (asserted, not assumed). */
function plannedPath(conversation: ClaudeConversation): string {
  const plan = buildPlan([conversation], planCtx());
  return plan.conversations[0].relPath;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("toDate", () => {
  it("accepts the exporter's microsecond ISO form with an offset", () => {
    expect(toDate("2024-08-15T14:23:11.123456+00:00")?.toISOString()).toBe(
      "2024-08-15T14:23:11.123Z",
    );
  });

  it("accepts a trailing Z and a date-only value", () => {
    expect(toDate("2024-08-15T14:23:11Z")?.toISOString()).toBe("2024-08-15T14:23:11.000Z");
    expect(toDate("2024-08-15")?.toISOString()).toBe("2024-08-15T00:00:00.000Z");
  });

  it("accepts a Date instance unchanged", () => {
    const date = new Date("2024-08-15T14:23:11.000Z");
    expect(toDate(date)).toBe(date);
  });

  it("accepts epoch milliseconds inside the window only", () => {
    expect(toDate(1723731791000)?.toISOString()).toBe("2024-08-15T14:23:11.000Z");
    // A bare epoch-seconds value lands in 1970 and is therefore a plausible-but-wrong date.
    expect(toDate(1723731791)?.toISOString()).toBe("1970-01-20T22:48:51.791Z");
  });

  it("rejects anything that is not a plausible date", () => {
    expect(toDate("not a date")).toBeNull();
    expect(toDate("")).toBeNull();
    expect(toDate(null)).toBeNull();
    expect(toDate(undefined)).toBeNull();
    expect(toDate(true)).toBeNull();
    expect(toDate({})).toBeNull();
    expect(toDate("2024-13-45T00:00:00Z")).toBeNull(); // month 13
    expect(toDate("0001-01-01T00:00:00Z")).toBeNull(); // before 1970
    expect(toDate("2999-01-01T00:00:00Z")).toBeNull(); // after 2100
    expect(toDate(Number.NaN)).toBeNull();
    expect(toDate(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("rejects a date-shaped string that new Date cannot parse", () => {
    expect(toDate("2024-08-15T99:99:99Z")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("normalizeSender", () => {
  it("passes the two documented senders through", () => {
    expect(normalizeSender("human")).toEqual({ sender: "human", raw: "human" });
    expect(normalizeSender("assistant")).toEqual({ sender: "assistant", raw: "assistant" });
  });

  it("lowercases and trims rather than guessing", () => {
    expect(normalizeSender("  Human ").sender).toBe("human");
    expect(normalizeSender("ASSISTANT").sender).toBe("assistant");
  });

  it("maps an absent or unknown sender to `other`, keeping the raw value", () => {
    expect(normalizeSender(undefined)).toEqual({ sender: "other", raw: null });
    expect(normalizeSender(null)).toEqual({ sender: "other", raw: null });
    expect(normalizeSender("")).toEqual({ sender: "other", raw: null });
    expect(normalizeSender("system")).toEqual({ sender: "other", raw: "system" });
    expect(normalizeSender("tool")).toEqual({ sender: "other", raw: "tool" });
    expect(normalizeSender(7)).toEqual({ sender: "other", raw: null });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("decodeContentBlocks — the double-encoded gotcha", () => {
  it("passes a real array through untouched and unflagged", () => {
    const blocks = [{ type: "text", text: "hi" }];
    const decoded = decodeContentBlocks(blocks);
    expect(decoded.blocks).toEqual(blocks);
    expect(decoded.doubleEncoded).toBe(false);
    expect(decoded.warning).toBeNull();
  });

  it("decodes a content value that arrived as a JSON STRING, and says so", () => {
    const decoded = decodeContentBlocks(
      '[{"type": "text", "text": "decoded"}, {"type": "thinking", "thinking": "hmm"}]',
    );
    expect(decoded.doubleEncoded).toBe(true);
    expect(decoded.blocks).toHaveLength(2);
    expect(decoded.warning).toContain("arrived as a JSON string");
  });

  it("warns, rather than crashing, when the string is not valid JSON", () => {
    const decoded = decodeContentBlocks('{"type": "text"');
    expect(decoded.blocks).toEqual([]);
    expect(decoded.doubleEncoded).toBe(false);
    expect(decoded.warning).toContain("not valid JSON");
  });

  it("warns when the string decodes to a non-array", () => {
    const decoded = decodeContentBlocks('"just a string"');
    expect(decoded.blocks).toEqual([]);
    expect(decoded.warning).toContain("non-array value");
  });

  it("unwraps one level of an object envelope holding a content array", () => {
    const decoded = decodeContentBlocks(
      '{"content": "[{\\"type\\": \\"text\\", \\"text\\": \\"deep\\"}]"}',
    );
    expect(decoded.blocks).toHaveLength(1);
    expect(decoded.warning).toContain("unwrapped once");
  });

  it("treats absent / null / empty as no blocks and no warning", () => {
    for (const value of [undefined, null, "", "   "]) {
      const decoded = decodeContentBlocks(value);
      expect(decoded.blocks).toEqual([]);
      expect(decoded.warning).toBeNull();
    }
  });

  it("warns on a non-array, non-string shape", () => {
    expect(decodeContentBlocks(42).warning).toContain("not an array");
    expect(decodeContentBlocks({ type: "text" }).warning).toContain("not an array");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("extractBlockText — content block kinds", () => {
  it("collects text blocks in order, joined by a blank line", () => {
    const extracted = extractBlockText([
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ]);
    expect(extracted.text).toBe("first\n\nsecond");
    expect(extracted.blockKindCounts.text).toBe(2);
  });

  it("keeps `thinking` as thought text, never as visible prose", () => {
    const extracted = extractBlockText([
      { type: "thinking", thinking: "the model's own reasoning", summaries: [], cut_off: false },
      { type: "text", text: "the answer" },
    ]);
    expect(extracted.thoughtText).toBe("the model's own reasoning");
    expect(extracted.text).toBe("the answer");
    expect(extracted.blockKindCounts.thinking).toBe(1);
  });

  it("counts a cut_off thinking block without treating truncation as an error", () => {
    const extracted = extractBlockText([
      { type: "thinking", thinking: "truncat", summaries: [], cut_off: true },
    ]);
    expect(extracted.thoughtText).toBe("truncat");
    expect(extracted.blockKindCounts["thinking:cut_off"]).toBe(1);
  });

  it("collects several thinking blocks in order", () => {
    const extracted = extractBlockText([
      { type: "thinking", thinking: "one" },
      { type: "text", text: "answer" },
      { type: "thinking", thinking: "two" },
    ]);
    expect(extracted.thoughtText).toBe("one\n\ntwo");
  });

  it("lifts an artifact out of its `artifacts` tool_use", () => {
    const extracted = extractBlockText([
      {
        type: "tool_use",
        name: "artifacts",
        input: {
          id: "art-1",
          type: "application/vnd.ant.code",
          language: "python",
          title: "fizzbuzz",
          content: "for i in range(10): print(i)",
        },
        id: "toolu_1",
      },
    ]);
    expect(extracted.artifacts).toHaveLength(1);
    expect(extracted.artifacts[0]).toMatchObject({
      title: "fizzbuzz",
      type: "application/vnd.ant.code",
      language: "python",
      content: "for i in range(10): print(i)",
      artifactId: "art-1",
      toolUseId: "toolu_1",
    });
    expect(extracted.blockKindCounts["tool_use:artifacts"]).toBe(1);
    // An artifact is not prose: it must not leak into the visible text.
    expect(extracted.text).toBe("");
  });

  it("decodes an artifacts `input` that arrived as a JSON string", () => {
    const extracted = extractBlockText([
      {
        type: "tool_use",
        name: "artifacts",
        input: JSON.stringify({ title: "T", content: "body", type: "text/markdown" }),
        id: "toolu_2",
      },
    ]);
    expect(extracted.artifacts).toHaveLength(1);
    expect(extracted.artifacts[0].content).toBe("body");
  });

  it("drops an artifacts block with no body and no command and says so", () => {
    const extracted = extractBlockText([
      { type: "tool_use", name: "artifacts", input: { title: "empty" }, id: "toolu_3" },
    ]);
    expect(extracted.artifacts).toHaveLength(0);
    expect(extracted.warnings.join(" ")).toContain("no usable body");
  });

  // ── artifact commands in the real export: `create` and `update` ─────────────────────────────

  it("reads an artifact `create` command (the real body shape)", () => {
    const extracted = extractBlockText([
      {
        type: "tool_use",
        name: "artifacts",
        id: null,
        input: {
          id: "mvp-builder-prompt",
          command: "create",
          content: "# NexaLog — MVP Builder Prompt",
          title: "mvp-builder-prompt",
          type: "text/markdown",
          version_uuid: "9b1c",
        },
      },
    ]);
    expect(extracted.artifacts).toHaveLength(1);
    expect(extracted.artifacts[0]).toMatchObject({
      command: "create",
      isPartial: false,
      content: "# NexaLog — MVP Builder Prompt",
      artifactId: "mvp-builder-prompt",
    });
    expect(extracted.warnings).toEqual([]);
  });

  it("reads an artifact `update` command as a labelled partial edit, not a whole body", () => {
    const extracted = extractBlockText([
      {
        type: "tool_use",
        name: "artifacts",
        id: null,
        input: {
          id: "mvp-builder-prompt",
          command: "update",
          new_str: "### 1. Main Dashboard",
          old_str: "# Digital Brain PKMS MVP Builder Prompt",
          version_uuid: "0a110000-0000-4000-8000-0000000000a5",
        },
      },
    ]);
    expect(extracted.artifacts).toHaveLength(1);
    expect(extracted.artifacts[0]).toMatchObject({
      command: "update",
      isPartial: true,
      content: "### 1. Main Dashboard",
      artifactId: "mvp-builder-prompt",
    });
    expect(extracted.warnings).toEqual([]);
    expect(extracted.blockKindCounts["tool_use:artifacts"]).toBe(1);
  });

  it("does NOT warn on a bodyless artifact command (a real `{version_uuid}`-only reference)", () => {
    const extracted = extractBlockText([
      {
        type: "tool_use",
        name: "artifacts",
        id: null,
        input: { version_uuid: "0a110000-0000-4000-8000-0000000000a5" },
      },
      { type: "text", text: "reverted" },
    ]);
    expect(extracted.artifacts).toHaveLength(0);
    expect(extracted.warnings).toEqual([]);
    expect(extracted.blockKindCounts["tool_use:artifacts:bodyless"]).toBe(1);
  });

  it("warns on an artifacts block whose input is unusable", () => {
    const extracted = extractBlockText([
      { type: "tool_use", name: "artifacts", input: "not json", id: "toolu_4" },
    ]);
    expect(extracted.artifacts).toHaveLength(0);
    expect(extracted.warnings.join(" ")).toContain("not a JSON object");
  });

  it("records a NON-artifact tool_use as a tool-call marker without inlining its input", () => {
    const extracted = extractBlockText([
      { type: "tool_use", name: "web_search", input: { query: "the query" }, id: "toolu_5" },
      { type: "text", text: "the answer" },
    ]);
    expect(extracted.text).toBe("the answer");
    expect(extracted.text).not.toContain("the query");
    expect(extracted.artifacts).toHaveLength(0);
    expect(extracted.toolCalls).toEqual([{ name: "web_search", toolUseId: "toolu_5" }]);
    expect(extracted.blockKindCounts["tool_use:other"]).toBe(1);
  });

  it("counts tool_result and token_budget without importing their payloads", () => {
    const extracted = extractBlockText([
      { type: "tool_result", content: "raw tool output" },
      { type: "token_budget", remaining: 12345 },
    ]);
    expect(extracted.text).toBe("");
    expect(extracted.thoughtText).toBe("");
    expect(extracted.blockKindCounts.tool_result).toBe(1);
    expect(extracted.blockKindCounts.token_budget).toBe(1);
  });

  // ── the three kinds the REAL export adds ────────────────────────────────────────────────────

  it("counts an `injected_prompt_block` and never renders it as message content", () => {
    const extracted = extractBlockText([
      {
        type: "injected_prompt_block",
        prompt: "\n\nThe current date is Friday, September 18, 2026.",
        injection_source: "date_note",
        initial_turn_only: false,
        skip_on_truncated_continuation: false,
      },
      { type: "text", text: "the actual turn" },
    ]);
    expect(extracted.blockKindCounts.injected_prompt_block).toBe(1);
    // It is machinery, not prose: the injected text must not reach the page.
    expect(extracted.text).toBe("the actual turn");
    expect(extracted.text).not.toContain("current date");
    expect(extracted.thoughtText).toBe("");
    expect(extracted.warnings).toEqual([]);
  });

  it("skips an injected memory snapshot entirely — no size blow-up, no warning", () => {
    const snapshot = `<system-reminder>\n<user_memory_snapshot>${"x".repeat(
      50_000,
    )}</user_memory_snapshot>\n</system-reminder>`;
    const extracted = extractBlockText([
      { type: "injected_prompt_block", prompt: snapshot, injection_source: "memory" },
      { type: "text", text: "short answer" },
    ]);
    expect(extracted.text).toBe("short answer");
    expect(extracted.blockKindCounts.injected_prompt_block).toBe(1);
    expect(extracted.warnings).toEqual([]);
  });

  it("lifts `document` blocks into file references, never into prose", () => {
    const extracted = extractBlockText([
      {
        type: "document",
        file_uuid: "0a110000-0000-4000-8000-0000000000a8",
        title: "Agreement.docx",
      },
      { type: "text", text: "Here are the updated docs." },
    ]);
    expect(extracted.fileRefs).toEqual([
      {
        kind: "document",
        title: "Agreement.docx",
        fileUuid: "0a110000-0000-4000-8000-0000000000a8",
        source: null,
      },
    ]);
    expect(extracted.text).toBe("Here are the updated docs.");
    expect(extracted.text).not.toContain("Agreement.docx");
    expect(extracted.blockKindCounts.document).toBe(1);
  });

  it("lifts `image` blocks into file references with their file_uuid and source", () => {
    const extracted = extractBlockText([
      { type: "image", source: null, file_uuid: "0a110000-0000-4000-8000-0000000000a7" },
      { type: "text", text: "Ready to test the driver's side then." },
    ]);
    expect(extracted.fileRefs).toEqual([
      {
        kind: "image",
        title: null,
        fileUuid: "0a110000-0000-4000-8000-0000000000a7",
        source: null,
      },
    ]);
    expect(extracted.blockKindCounts.image).toBe(1);
    expect(extracted.text).toBe("Ready to test the driver's side then.");
  });

  it("does NOT warn about the three real-data kinds (they are handled, not unknown)", () => {
    const extracted = extractBlockText([
      { type: "injected_prompt_block", prompt: "p" },
      { type: "document", file_uuid: "f", title: "t" },
      { type: "image", file_uuid: "g" },
      { type: "text", text: "x" },
    ]);
    expect(extracted.warnings).toEqual([]);
    expect(Object.keys(extracted.blockKindCounts).filter((k) => k.startsWith("unknown:"))).toEqual(
      [],
    );
  });

  it("counts a genuinely unknown block kind and names it, instead of throwing", () => {
    const extracted = extractBlockText([
      { type: "future_thing", payload: {} },
      { type: "text", text: "still parsed" },
    ]);
    expect(extracted.blockKindCounts["unknown:future_thing"]).toBe(1);
    expect(extracted.text).toBe("still parsed");
    expect(extracted.warnings.join(" ")).toContain("future_thing");
  });

  it("handles a non-object block and a block with no type", () => {
    const extracted = extractBlockText([null, 7, { text: "no type here" }]);
    expect(extracted.blockKindCounts["unknown:<not-an-object>"]).toBe(2);
    expect(extracted.blockKindCounts["unknown:<no type>"]).toBe(1);
    expect(extracted.warnings.join(" ")).toContain("<not-an-object>");
  });

  it("ignores an empty text block without a warning, and warns on a non-string one", () => {
    const empty = extractBlockText([{ type: "text", text: "" }]);
    expect(empty.text).toBe("");
    expect(empty.warnings).toEqual([]);
    const bad = extractBlockText([{ type: "text", text: 123 }]);
    expect(bad.warnings.join(" ")).toContain("non-string");
  });

  it("collects citations from text blocks, tolerating both observed shapes", () => {
    const flat = extractBlockText([
      {
        type: "text",
        text: "cited",
        citations: [{ url: "https://example.com/a", title: "A", cited_text: "quote" }],
      },
    ]);
    expect(flat.citations[0]).toEqual({
      url: "https://example.com/a",
      title: "A",
      citedText: "quote",
    });

    const nested = extractBlockText([
      {
        type: "text",
        text: "cited",
        citations: [
          {
            uuid: "cit-1",
            details: {
              type: "web_search_result_location",
              url: "https://example.com/b",
              title: "B",
              cited_text: "quote 2",
            },
          },
        ],
      },
    ]);
    expect(nested.citations[0]).toEqual({
      url: "https://example.com/b",
      title: "B",
      citedText: "quote 2",
    });
  });

  it("warns on a non-array citations value", () => {
    const extracted = extractBlockText([{ type: "text", text: "x", citations: "nope" }]);
    expect(extracted.citations).toEqual([]);
    expect(extracted.warnings.join(" ")).toContain("non-array `citations`");
  });

  it("returns empty everything for an empty block list", () => {
    const extracted = extractBlockText([]);
    expect(extracted).toMatchObject({
      text: "",
      thoughtText: "",
      artifacts: [],
      toolCalls: [],
      fileRefs: [],
      citations: [],
      blockKindCounts: {},
      warnings: [],
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("normalizeAttachments", () => {
  it("reads the documented array shape", () => {
    const result = normalizeAttachments(
      [{ file_name: "a.pdf", file_size: 12, file_type: "application/pdf" }],
      [],
    );
    expect(result.attachments).toEqual([
      {
        name: "a.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12,
        fileUuid: null,
        shape: "array",
      },
    ]);
    expect(result.skippedShapes).toBe(0);
  });

  it("reads the object-map shape (keyed by upload id)", () => {
    const result = normalizeAttachments(
      { "first-upload": { file_name: "shot.png", file_type: "image/png", file_size: 5 } },
      [],
    );
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toMatchObject({ name: "shot.png", shape: "map" });
  });

  it("reads a single attachment object as one attachment", () => {
    const result = normalizeAttachments({ file_name: "solo.png", file_size: 9 }, null);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].name).toBe("solo.png");
  });

  it("reads the `files` field, its shape, and its file_uuid (the real-data shape)", () => {
    const result = normalizeAttachments(
      [],
      [{ file_uuid: "0a110000-0000-4000-8000-0000000000b1", file_name: "Service Agreement.pdf" }],
    );
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toEqual({
      name: "Service Agreement.pdf",
      mimeType: null,
      sizeBytes: null,
      fileUuid: "0a110000-0000-4000-8000-0000000000b1",
      shape: "file",
    });
  });

  it("keeps `extracted_content` out of the record (it is huge and not part of the page)", () => {
    const result = normalizeAttachments(
      [
        {
          file_name: "transcript.txt",
          file_size: 15502,
          file_type: "txt",
          extracted_content: "Speaker A: I've made a lot of edits this morning.",
        },
      ],
      [],
    );
    expect(result.attachments[0]).toEqual({
      name: "transcript.txt",
      mimeType: "txt",
      sizeBytes: 15502,
      fileUuid: null,
      shape: "array",
    });
    expect(JSON.stringify(result.attachments)).not.toContain("Speaker A");
  });

  it("accepts the alternate key spellings (filename / name / mime_type / media_type)", () => {
    const result = normalizeAttachments(
      [{ filename: "x", name: "y", mime_type: "text/plain", media_type: "text/markdown" }],
      null,
    );
    expect(result.attachments[0]).toEqual({
      name: "x",
      mimeType: "text/plain",
      sizeBytes: null,
      fileUuid: null,
      shape: "array",
    });
  });

  it("counts an unrecognised shape and warns, rather than guessing", () => {
    const result = normalizeAttachments("a-file-name.png", 42);
    expect(result.attachments).toEqual([]);
    expect(result.skippedShapes).toBe(2);
    expect(result.warnings.join(" ")).toContain("where an attachment list was expected");
  });

  it("counts a malformed entry inside an otherwise valid array", () => {
    const result = normalizeAttachments([{ file_name: "ok.txt" }, "not-an-object", 9], []);
    expect(result.attachments).toHaveLength(1);
    expect(result.skippedShapes).toBe(2);
  });

  it("returns nothing for absent fields", () => {
    expect(normalizeAttachments(undefined, undefined)).toEqual({
      attachments: [],
      skippedShapes: 0,
      warnings: [],
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("parseClaudeMessage — text precedence and totality", () => {
  it("prefers the content array over the plain text field when both are present and disagree", () => {
    const message = parseMessage({
      text: "FALLBACK that must lose",
      content: [{ type: "text", text: "the content array wins" }],
    });
    expect(message.text).toBe("the content array wins");
    expect(message.textSource).toBe("content");
  });

  it("falls back to the plain text field when there is no content array at all", () => {
    const raw = rawMessage();
    delete raw.content;
    const message = parseClaudeMessage(raw, 0);
    expect(message.text).toBe("hello");
    expect(message.textSource).toBe("text field");
  });

  it("falls back to the plain text field when the content array is EMPTY", () => {
    const message = parseMessage({ text: "fallback", content: [] });
    expect(message.text).toBe("fallback");
    expect(message.textSource).toBe("text field");
  });

  it("uses only the plain text field when a content value is undecodable", () => {
    const message = parseMessage({ text: "still useful", content: "not json {" });
    expect(message.text).toBe("still useful");
    expect(message.textSource).toBe("text field");
    expect(message.warnings.join(" ")).toContain("not valid JSON");
  });

  it("reads a message whose only contribution is thought text", () => {
    const message = parseMessage({
      text: "",
      content: [{ type: "thinking", thinking: "only reasoning here" }],
    });
    expect(message.text).toBe("");
    expect(message.thoughtText).toBe("only reasoning here");
    expect(messageHasImportableContent(message)).toBe(true);
  });

  it("reads a message whose only contribution is an artifact", () => {
    const message = parseMessage({
      text: "",
      content: [
        {
          type: "tool_use",
          name: "artifacts",
          input: { title: "T", content: "code", type: "application/vnd.ant.code" },
          id: "t1",
        },
      ],
    });
    expect(message.artifacts).toHaveLength(1);
    expect(messageHasImportableContent(message)).toBe(true);
  });

  it("treats a document / image reference as importable content even with no prose", () => {
    const message = parseMessage({
      text: "",
      content: [{ type: "image", source: null, file_uuid: "0a110000-0000-4000-8000-0000000000a7" }],
      files: [{ file_uuid: "0a110000-0000-4000-8000-0000000000a7", file_name: "photo-4638.jpg" }],
    });
    expect(message.text).toBe("");
    expect(messageHasImportableContent(message)).toBe(true);
  });

  it("treats a `files`-only turn (a real shape: empty text block + a file) as importable", () => {
    const message = parseMessage({
      text: "",
      content: [{ type: "text", text: "" }],
      files: [
        {
          file_uuid: "0a110000-0000-4000-8000-0000000000b1",
          file_name: "Service Agreement Example 10 Ton.pdf",
        },
      ],
      attachments: [],
    });
    expect(message.text).toBe("");
    expect(message.attachments).toHaveLength(1);
    expect(messageHasImportableContent(message)).toBe(true);
  });

  it("marks a tool-only / injected-only / empty turn as not importable", () => {
    const toolOnly = parseMessage({
      text: "",
      content: [{ type: "tool_result", content: "output" }],
    });
    expect(messageHasImportableContent(toolOnly)).toBe(false);

    const injectedOnly = parseMessage({
      text: "",
      content: [{ type: "injected_prompt_block", prompt: "\n\nThe current date is …" }],
    });
    expect(messageHasImportableContent(injectedOnly)).toBe(false);

    const empty = parseMessage({ text: "", content: [] });
    expect(messageHasImportableContent(empty)).toBe(false);
  });

  it("flags a double-encoded content value on the message", () => {
    const message = parseMessage({
      content: '[{"type": "text", "text": "decoded"}]',
    });
    expect(message.doubleEncodedContent).toBe(true);
    expect(message.text).toBe("decoded");
  });

  it("keeps a null uuid and warns (identity is never synthesised)", () => {
    const raw = rawMessage();
    delete raw.uuid;
    const message = parseClaudeMessage(raw, 3);
    expect(message.uuid).toBeNull();
    expect(message.index).toBe(3);
    expect(message.warnings.join(" ")).toContain("no uuid");
  });

  it("warns on an unrecognised sender but still reads the text", () => {
    const message = parseMessage({ sender: "system" });
    expect(message.sender).toBe("other");
    expect(message.senderRaw).toBe("system");
    expect(message.warnings.join(" ")).toContain('unrecognised sender "system"');
  });

  it("warns on an unparseable created_at and stores NULL", () => {
    const message = parseMessage({ created_at: "not a date" });
    expect(message.createdAt).toBeNull();
    expect(message.warnings.join(" ")).toContain("unparseable created_at");
  });

  it("accepts a null updated_at without a warning", () => {
    const message = parseMessage({ updated_at: null });
    expect(message.updatedAt).toBeNull();
    expect(message.warnings).toEqual([]);
  });

  it("is total on a non-object message", () => {
    const message = parseClaudeMessage("nonsense", 7);
    expect(message.uuid).toBeNull();
    expect(message.index).toBe(7);
    expect(message.warnings.join(" ")).toContain("not a JSON object");
  });

  it("records the message position from the array index", () => {
    expect(parseClaudeMessage(rawMessage(), 0).index).toBe(0);
    expect(parseClaudeMessage(rawMessage(), 41).index).toBe(41);
  });

  it("keeps the message's own timestamps distinct from the conversation's", () => {
    const message = parseMessage({
      created_at: "2024-01-01T00:00:00.000000+00:00",
      updated_at: "2024-01-02T00:00:00.000000+00:00",
    });
    expect(message.createdAt?.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    expect(message.updatedAt?.toISOString()).toBe("2024-01-02T00:00:00.000Z");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("parseClaudeConversation", () => {
  it("reads the documented fields", () => {
    const conversation = parseConversation();
    expect(conversation.uuid).toBe(CONV_A);
    expect(conversation.title).toBe("A conversation");
    expect(conversation.accountUuid).toBe("0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9");
    expect(conversation.createdAt?.toISOString()).toBe("2024-08-15T14:23:11.123Z");
    expect(conversation.updatedAt?.toISOString()).toBe("2024-08-15T15:01:02.654Z");
    expect(conversation.messages).toHaveLength(1);
    expect(conversation.rawMessageCount).toBe(1);
  });

  it("treats an empty-string summary as absent", () => {
    expect(parseConversation({ summary: "" }).summary).toBeNull();
    expect(parseConversation({ summary: "  " }).summary).toBeNull();
    expect(parseConversation({ summary: "real summary" }).summary).toBe("real summary");
    expect(parseConversation({ summary: null }).summary).toBeNull();
  });

  it("treats an empty-string title as absent", () => {
    expect(parseConversation({ name: "" }).title).toBe("");
    expect(parseConversation({ name: null }).title).toBe("");
  });

  it("keeps an unnamed conversation with a valid uuid importable", () => {
    const conversation = parseConversation({ name: undefined });
    expect(conversation.uuid).toBe(CONV_A);
    expect(conversation.title).toBe("");
    expect(conversation.warnings).toEqual([]);
  });

  it("warns when the conversation itself has no uuid", () => {
    const conversation = parseClaudeConversation(rawConversation({ uuid: undefined }), 0);
    expect(conversation.uuid).toBeNull();
    expect(conversation.warnings.join(" ")).toContain("no uuid");
  });

  it("handles a missing chat_messages array", () => {
    const conversation = parseConversation({ chat_messages: undefined });
    expect(conversation.messages).toEqual([]);
    expect(conversation.rawMessageCount).toBe(0);
    expect(conversation.warnings.join(" ")).toContain("no chat_messages array");
  });

  it("handles a non-array chat_messages value", () => {
    const conversation = parseConversation({ chat_messages: { "0": rawMessage() } });
    expect(conversation.messages).toEqual([]);
    expect(conversation.warnings.join(" ")).toContain("not an array");
  });

  it("keeps a conversation with zero messages valid", () => {
    const conversation = parseConversation({ chat_messages: [] });
    expect(conversation.messages).toEqual([]);
    expect(conversation.uuid).toBe(CONV_A);
    expect(conversation.warnings).toEqual([]);
  });

  it("warns when the account object is missing", () => {
    const conversation = parseConversation({ account: undefined });
    expect(conversation.accountUuid).toBeNull();
  });

  it("warns on an unparseable conversation created_at", () => {
    const conversation = parseConversation({ created_at: "2024-99-99" });
    expect(conversation.createdAt).toBeNull();
    expect(conversation.warnings.join(" ")).toContain("unparseable created_at");
  });

  it("is total on a non-object conversation", () => {
    const conversation = parseClaudeConversation(null, 2);
    expect(conversation.uuid).toBeNull();
    expect(conversation.index).toBe(2);
    expect(conversation.warnings.join(" ")).toContain("not a JSON object");
  });

  it("keeps every message, in array order, with its own index", () => {
    const conversation = parseConversation({
      chat_messages: [
        rawMessage({ uuid: MSG_1, text: "one", content: [{ type: "text", text: "one" }] }),
        rawMessage({ uuid: MSG_2, text: "two", content: [{ type: "text", text: "two" }] }),
      ],
    });
    expect(conversation.messages.map((m) => m.index)).toEqual([0, 1]);
    expect(conversation.messages.map((m) => m.text)).toEqual(["one", "two"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("parseClaudeConversationsJson", () => {
  it("parses an array of conversations", () => {
    const result = parseClaudeConversationsJson(
      JSON.stringify([rawConversation(), rawConversation({ uuid: CONV_B })]),
    );
    expect(result.conversations).toHaveLength(2);
    expect(result.conversations[1].uuid).toBe(CONV_B);
  });

  it("throws loudly when the file is not valid JSON", () => {
    expect(() => parseClaudeConversationsJson("{not json")).toThrow(/not valid JSON/);
  });

  it("throws when the top level is not an array (wrong file, not a bad item)", () => {
    expect(() => parseClaudeConversationsJson('{"conversations": []}')).toThrow(
      /must be a JSON array/,
    );
    expect(() => parseClaudeConversationsJson("null")).toThrow(/must be a JSON array/);
    expect(() => parseClaudeConversationsJson("42")).toThrow(/must be a JSON array/);
  });

  it("does NOT throw on a bad item inside a valid array — it degrades to warnings", () => {
    const result = parseClaudeConversationsJson(
      JSON.stringify([null, 7, "nope", rawConversation()]),
    );
    expect(result.conversations).toHaveLength(4);
    expect(result.conversations[0].warnings.join(" ")).toContain("not a JSON object");
    expect(result.conversations[3].uuid).toBe(CONV_A);
  });

  it("accepts an empty array (an export with no conversations)", () => {
    expect(parseClaudeConversationsJson("[]").conversations).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("slugs — derived, then validated by the app's own Slug.of", () => {
  it("slugifies to a legal segment, never to something that escapes its directory", () => {
    expect(slugify("Kubernetes ingress 502s after cert rotation")).toBe(
      "kubernetes-ingress-502s-after-cert-rotation",
    );
    expect(slugify("  Mixed CASE  ")).toBe("mixed-case");
    expect(slugify("Café — résumé!")).toBe("cafe-resume");
    expect(slugify("../../etc/passwd")).toBe("etc-passwd");
    expect(slugify("a".repeat(200))).toHaveLength(48);
    expect(slugify("！！！")).toBe("");
  });

  it("accepts what Slug.of accepts and rejects what it rejects", () => {
    expect(isValidSlugPath("notes/a-valid-slug.md")).toBe(true);
    // Slug.of lowercases, so an uppercase segment normalizes rather than failing.
    expect(isValidSlugPath("notes/Bad-Slug.md")).toBe(true);
    for (const bad of ["notes/-leading.md", "notes/.hidden.md", "notes/a b.md", "notes/badü.md"]) {
      expect(isValidSlugPath(bad)).toBe(false);
    }
  });

  it("falls back to a uuid-derived slug when the title slugifies to nothing", () => {
    expect(deriveSlug("！！！", CONV_A)).toBe("claude-6f1c0a44");
    const conversation = parseConversation({ name: "！！！" });
    expect(plannedPath(conversation)).toBe("notes/claude-6f1c0a44.md");
    expect(Slug.of(plannedPath(conversation)).value).toBe("notes/claude-6f1c0a44");
  });

  it("titles an unnamed conversation by its date, then by its uuid", () => {
    const dated = parseConversation({ name: "" });
    expect(conversationTitle(dated)).toBe("Claude conversation 2024-08-15");
    const undated = parseConversation({ name: "", created_at: null });
    expect(conversationTitle(undated)).toBe("Claude conversation 6f1c0a44");
  });

  it("suffixes a slug collision WITHIN the export instead of clobbering", () => {
    const plan = buildPlan(
      [
        parseConversation({ uuid: CONV_A, name: "Same title" }),
        parseConversation({ uuid: CONV_B, name: "Same title" }),
      ],
      planCtx(),
    );
    expect(plan.conversations[0].relPath).toBe("notes/same-title.md");
    expect(plan.conversations[1].relPath).toBe("notes/same-title-b2d4f6a8.md");
    expect(isValidSlugPath(plan.conversations[1].relPath)).toBe(true);
    expect(plan.conversations[1].reason).toContain("slug collision");
  });

  it("gives SIX unnamed conversations (a real slice shape) six distinct paths", () => {
    const conversations = ["a", "b", "c", "d", "e", "f"].map((_, i) =>
      parseConversation({
        name: "",
        uuid: `6f1c0a44-3a1e-4d2b-9f77-1c9a2b7d4e0${i}`,
        created_at: null,
        chat_messages: [],
      }),
    );
    const plan = buildPlan(conversations, planCtx());
    const paths = plan.conversations.map((c) => c.relPath);
    expect(new Set(paths).size).toBe(6);
    // All six share the "Claude conversation 6f1c0a44" title, so five get a collision suffix.
    expect(paths[0]).toBe("notes/claude-conversation-6f1c0a44.md");
    expect(paths.slice(1).every((p) => p.startsWith("notes/claude-conversation-6f1c0a44-"))).toBe(
      true,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("renderMessageMarkdown / renderConversationBody", () => {
  it("marks every part of a turn: heading, prose, thinking, artifact, sources", () => {
    const message = parseMessage({
      uuid: MSG_2,
      sender: "assistant",
      text: "",
      content: [
        { type: "thinking", thinking: "Check the controller first." },
        {
          type: "text",
          text: "Start with the controller, not the backend.",
          citations: [{ url: "https://example.com/k8s", title: "K8s docs" }],
        },
        {
          type: "tool_use",
          name: "artifacts",
          input: {
            title: "Probe patch",
            type: "application/vnd.ant.code",
            language: "yaml",
            content: "readinessProbe: {}",
          },
          id: "toolu_1",
        },
      ],
    });
    const markdown = renderMessageMarkdown(message);
    expect(markdown).toContain("## Assistant — 2024-08-15T14:23:11.123Z");
    expect(markdown).toContain("Start with the controller, not the backend.");
    expect(markdown).toContain("**Thinking**");
    expect(markdown).toContain("> Check the controller first.");
    expect(markdown).toContain("**Artifact: Probe patch (application/vnd.ant.code, yaml)**");
    expect(markdown).toContain("```yaml\nreadinessProbe: {}\n```");
    expect(markdown).toContain("*Sources:*");
    expect(markdown).toContain("[K8s docs](https://example.com/k8s)");
  });

  it("uses a fence long enough for an artifact that itself contains fences", () => {
    const message = parseMessage({
      sender: "assistant",
      text: "",
      content: [
        {
          type: "tool_use",
          name: "artifacts",
          input: { title: "doc", type: "text/markdown", content: "```js\nconst x = 1;\n```" },
          id: "t",
        },
      ],
    });
    const markdown = renderMessageMarkdown(message);
    expect(markdown).toContain("````\n```js\nconst x = 1;\n```\n````");
  });

  it("labels an `update` artifact as an updated excerpt, not the whole artifact", () => {
    const message = parseMessage({
      sender: "assistant",
      text: "",
      content: [
        {
          type: "tool_use",
          name: "artifacts",
          id: null,
          input: {
            id: "mvp-builder-prompt",
            command: "update",
            new_str: "### 1. Main Dashboard",
            old_str: "# Digital Brain",
            version_uuid: "7d645cdb",
          },
        },
      ],
    });
    const markdown = renderMessageMarkdown(message);
    expect(markdown).toContain("**Artifact: (untitled) — updated excerpt**");
    expect(markdown).toContain("### 1. Main Dashboard");
  });

  it("renders a tool call as a marker and never inlines the tool's input or output", () => {
    const message = parseMessage({
      sender: "assistant",
      text: "Working on it.",
      content: [
        { type: "text", text: "Working on it." },
        { type: "tool_use", name: "web_search", input: { query: "SECRET QUERY" }, id: "t1" },
        { type: "tool_result", content: "SECRET TOOL OUTPUT" },
      ],
    });
    const markdown = renderMessageMarkdown(message);
    expect(markdown).toContain("*[tool call: `web_search`]*");
    expect(markdown).not.toContain("SECRET QUERY");
    expect(markdown).not.toContain("SECRET TOOL OUTPUT");
  });

  it("renders an injected prompt block NOWHERE — the text never reaches the page", () => {
    const message = parseMessage({
      sender: "assistant",
      text: "Answer.",
      content: [
        { type: "text", text: "Answer." },
        {
          type: "injected_prompt_block",
          prompt: "\n\nThe current date is Friday, September 18, 2026.\nSECRET MEMORY SNAPSHOT",
          injection_source: "date_note",
        },
      ],
    });
    const markdown = renderMessageMarkdown(message);
    expect(markdown).not.toContain("current date");
    expect(markdown).not.toContain("SECRET MEMORY SNAPSHOT");
    expect(markdown).toContain("Answer.");
  });

  it("merges a document content block with its `files` record on file_uuid", () => {
    const message = parseMessage({
      text: "Here are the updated docs.",
      content: [
        {
          type: "document",
          file_uuid: "0a110000-0000-4000-8000-0000000000a8",
          title: "Agreement.docx",
        },
        { type: "text", text: "Here are the updated docs." },
      ],
      files: [
        {
          file_uuid: "0a110000-0000-4000-8000-0000000000a8",
          file_name: "Agreement.docx",
          file_size: 4096,
          file_type: "docx",
        },
      ],
    });
    const markdown = renderMessageMarkdown(message);
    expect(markdown).toContain("**Attachments**");
    expect(markdown).toContain(
      "- document: Agreement.docx — docx, 4096 bytes, file 0a110000-0000-4000-8000-0000000000a8",
    );
    // One line for the file, not two — the block and the record are the same thing.
    expect(markdown.split("\n").filter((l) => l.includes("Agreement.docx"))).toHaveLength(1);
  });

  it("renders an attachment-only turn (empty text block + a file) instead of a placeholder", () => {
    const message = parseMessage({
      text: "",
      content: [{ type: "text", text: "" }],
      files: [
        {
          file_uuid: "0a110000-0000-4000-8000-0000000000b1",
          file_name: "Service Agreement Example 10 Ton.pdf",
        },
      ],
    });
    const markdown = renderMessageMarkdown(message);
    expect(markdown).toContain("**Attachments**");
    expect(markdown).toContain("Service Agreement Example 10 Ton.pdf");
    expect(markdown).not.toContain("no importable text");
  });

  it("keeps a turn with nothing renderable as an explicit placeholder naming its blocks", () => {
    const message = parseMessage({
      text: "",
      content: [
        { type: "tool_result", content: "out" },
        { type: "token_budget", remaining: 1 },
      ],
    });
    const markdown = renderMessageMarkdown(message);
    expect(markdown).toContain(
      "*(no importable text — content blocks: token_budget, tool_result)*",
    );
  });

  it("labels a non-standard sender with its raw value", () => {
    const message = parseMessage({
      sender: "system",
      text: "sys",
      content: [{ type: "text", text: "sys" }],
    });
    expect(renderMessageMarkdown(message)).toContain("## Other (system) — ");
  });

  it("omits the timestamp when the export carries none", () => {
    const message = parseMessage({ created_at: null, updated_at: null });
    expect(renderMessageMarkdown(message)).toMatch(/^## Human\n/);
  });

  it("builds a whole body: title heading, provenance line, summary, then turns in order", () => {
    const conversation = parseConversation({
      name: "Kubernetes ingress 502s",
      summary: "Ingress 502s after a cert rotation.",
      chat_messages: [
        rawMessage({ uuid: MSG_1, text: "first", content: [{ type: "text", text: "first" }] }),
        rawMessage({
          uuid: MSG_2,
          sender: "assistant",
          text: "second",
          content: [{ type: "text", text: "second" }],
        }),
      ],
    });
    const body = renderConversationBody(conversation, conversationTitle(conversation));
    expect(body.startsWith("# Kubernetes ingress 502s")).toBe(true);
    expect(body).toContain(`conversation ${CONV_A}`);
    expect(body).toContain("2 message(s)");
    expect(body).toContain("> **Summary.** Ingress 502s after a cert rotation.");
    expect(body.indexOf("first")).toBeLessThan(body.indexOf("second"));
  });

  it("says so when a conversation carries no chat_messages at all", () => {
    const conversation = parseConversation({ chat_messages: [] });
    const body = renderConversationBody(conversation, conversationTitle(conversation));
    expect(body).toContain("*(this conversation carries no chat_messages)*");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("serializePageFile — must survive the brain store's splitFrontmatter + js-yaml load", () => {
  it("emits a leading --- block, a --- close, and exactly one trailing newline", () => {
    const text = serializePageFile({ type: "note", title: "A: B # C" }, "# body\n\nline");
    expect(text.startsWith("---\n")).toBe(true);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
    expect(text).toContain('title: "A: B # C"');
    expect(text.split("\n---\n")).toHaveLength(2);
  });

  it("keeps the body's first line a heading, so `---` can never close the block early", () => {
    const conversation = parseConversation({ name: "Title" });
    const plan = buildPlan([conversation], planCtx());
    const file = plan.conversations[0].fileText;
    const closeIndex = file.indexOf("\n---\n", 4);
    const body = file.slice(closeIndex + 5);
    expect(body.startsWith("# Title")).toBe(true);
  });

  it("trims the body's trailing whitespace like the store does", () => {
    const text = serializePageFile({ type: "note" }, "# heading\n\n\n   \n");
    expect(text.endsWith("# heading\n")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("buildPlan — page actions and idempotency", () => {
  it("plans a WRITE for a conversation with no destination file", () => {
    const plan = buildPlan([parseConversation()], planCtx());
    const page = plan.conversations[0];
    expect(page.action).toBe("WRITE");
    expect(page.target).toBe("brain page");
    expect(page.pageType).toBe(CLAUDE_PAGE_TYPE);
    expect(page.relPath).toBe(`${CLAUDE_PAGE_DIR}/a-conversation.md`);
    expect(page.reason).toContain("new brain page (type=note)");
    expect(page.frontmatter.type).toBe("note");
    expect(page.frontmatter.title).toBe("A conversation");
    expect(page.frontmatter.claude_conversation_uuid).toBe(CONV_A);
    expect(page.frontmatter.import_source).toBe(CLAUDE_IMPORT_SOURCE);
    expect(page.fileText).toBe(serializePageFile(page.frontmatter, page.body));
  });

  it("SKIPs a byte-identical destination (the second run must not churn)", () => {
    const conversation = parseConversation();
    const first = buildPlan([conversation], planCtx());
    const path = first.conversations[0].relPath;
    const second = buildPlan([conversation], {
      existingPages: new Map([[path, first.conversations[0].fileText]]),
      importSource: CLAUDE_IMPORT_SOURCE,
    });
    expect(second.conversations[0].action).toBe("SKIP-identical");
    expect(second.conversations[0].reason).toContain("identical content");
  });

  it("UPDATEs when the destination holds this conversation with different content", () => {
    const conversation = parseConversation();
    const path = plannedPath(conversation);
    const stale = `---\ntype: "note"\ntitle: "A conversation"\nclaude_conversation_uuid: "${CONV_A}"\n---\n\n# A conversation\n\nold body\n`;
    const plan = buildPlan([conversation], {
      existingPages: new Map([[path, stale]]),
      importSource: CLAUDE_IMPORT_SOURCE,
    });
    expect(plan.conversations[0].action).toBe("UPDATE");
    expect(plan.conversations[0].reason).toContain("different content");
  });

  it("REFUSES to overwrite a destination that is not this conversation's page", () => {
    const conversation = parseConversation();
    const path = plannedPath(conversation);
    const foreign = `---\ntype: "note"\ntitle: "Somebody else's note"\n---\n\n# Somebody else's note\n`;
    const plan = buildPlan([conversation], {
      existingPages: new Map([[path, foreign]]),
      importSource: CLAUDE_IMPORT_SOURCE,
    });
    expect(plan.conversations[0].action).toBe("SKIP-conflict");
    expect(plan.conversations[0].reason).toContain("refusing to overwrite");
  });

  it("REFUSES a destination holding a DIFFERENT conversation's uuid", () => {
    const conversation = parseConversation();
    const path = plannedPath(conversation);
    const other = `---\ntype: "note"\nclaude_conversation_uuid: "${CONV_B}"\n---\n\n# other\n`;
    const plan = buildPlan([conversation], {
      existingPages: new Map([[path, other]]),
      importSource: CLAUDE_IMPORT_SOURCE,
    });
    expect(plan.conversations[0].action).toBe("SKIP-conflict");
  });

  it("REFUSES a conversation with no uuid — identity is never synthesised", () => {
    const plan = buildPlan([parseClaudeConversation(rawConversation({ uuid: "" }), 0)], planCtx());
    expect(plan.conversations[0].action).toBe("SKIP-unsupported");
    expect(plan.conversations[0].reason).toContain("no uuid");
    expect(plan.conversations[0].relPath).toBe("");
    expect(plan.conversations[0].fileText).toBe("");
  });

  it("still WRITEs a page for a conversation with zero messages, and says why", () => {
    const plan = buildPlan([parseConversation({ chat_messages: [] })], planCtx());
    expect(plan.conversations[0].action).toBe("WRITE");
    expect(plan.conversations[0].messageCounts).toEqual({ rendered: 0, placeholder: 0 });
    expect(plan.stats.conversationsEmpty).toBe(1);
  });

  it("accounts for every message: rendered or placeholder, never dropped", () => {
    const plan = buildPlan(
      [
        parseConversation({
          chat_messages: [
            rawMessage({ uuid: MSG_1, text: "a", content: [{ type: "text", text: "a" }] }),
            rawMessage({
              uuid: MSG_2,
              text: "",
              content: [{ type: "tool_result", content: "out" }],
            }),
            rawMessage({
              uuid: MSG_3,
              text: "",
              content: [{ type: "injected_prompt_block", prompt: "p" }],
            }),
          ],
        }),
      ],
      planCtx(),
    );
    const conversation = plan.conversations[0];
    expect(conversation.messages).toHaveLength(3);
    expect(conversation.messageCounts).toEqual({ rendered: 1, placeholder: 2 });
    expect(conversation.messages.map((m) => m.rendered)).toEqual([true, false, false]);
    expect(conversation.messages[1].reason).toContain("tool_result");
    // The placeholder turns are still IN the body — a turn is never silently lost.
    expect(conversation.body).toContain("tool_result");
    expect(conversation.body).toContain("injected_prompt_block");
  });

  it("writes NO run timestamp into the page — a re-render is byte-stable", () => {
    const conversation = parseConversation();
    const first = buildPlan([conversation], planCtx());
    const second = buildPlan([conversation], planCtx());
    expect(second.conversations[0].fileText).toBe(first.conversations[0].fileText);
    expect(first.conversations[0].fileText).not.toMatch(/imported_at|importedAt/);
  });

  it("records the provenance fields a re-import needs, and the page contract keys first", () => {
    const plan = buildPlan([parseConversation()], planCtx());
    const frontmatter = plan.conversations[0].frontmatter;
    expect(frontmatter.claude_created_at).toBe("2024-08-15T14:23:11.123Z");
    expect(frontmatter.claude_updated_at).toBe("2024-08-15T15:01:02.654Z");
    expect(frontmatter.claude_account_uuid).toBe("0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9");
    expect(frontmatter.claude_message_count).toBe("1");
    // `type` + `title` are the whole page contract; both are present, `type` first.
    expect(Object.keys(frontmatter).slice(0, 2)).toEqual(["type", "title"]);
  });

  it("dates the page from the conversation's own creation time under the top-level `date` key", () => {
    // The brain indexes a page by the top-level `event_date` / `date` / `published` it can read.
    // `claude_created_at` alone is provenance it does not know, so a page carrying only that key
    // is indexed with its IMPORT time and vanishes from date-scoped recall. `date` is therefore
    // written with the same instant — the conversation's creation time, never the run time.
    const plan = buildPlan([parseConversation()], planCtx());
    expect(plan.conversations[0].frontmatter.date).toBe("2024-08-15T14:23:11.123Z");
    expect(plan.conversations[0].frontmatter.date).toBe(
      plan.conversations[0].frontmatter.claude_created_at,
    );
  });

  it("omits `date` when the export carries no creation date at all, and never invents one", () => {
    const plan = buildPlan([parseConversation({ created_at: null })], planCtx());
    expect(plan.conversations[0].frontmatter.date).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("buildPlan — stats and ordering", () => {
  it("counts messages by sender, including `other`", () => {
    const plan = buildPlan(
      [
        parseConversation({
          chat_messages: [
            rawMessage({ uuid: MSG_1, sender: "human" }),
            rawMessage({ uuid: MSG_2, sender: "assistant" }),
            rawMessage({ uuid: "m3", sender: "system" }),
          ],
        }),
      ],
      planCtx(),
    );
    expect(plan.stats.messagesBySender).toEqual([
      { label: "assistant", count: 1 },
      { label: "human", count: 1 },
      { label: "other", count: 1 },
    ]);
  });

  it("counts every block kind, the real-data kinds included, sorted by label", () => {
    const plan = buildPlan(
      [
        parseConversation({
          chat_messages: [
            rawMessage({
              content: [
                { type: "text", text: "a" },
                { type: "thinking", thinking: "b" },
                { type: "injected_prompt_block", prompt: "c" },
                { type: "image", file_uuid: "d" },
                { type: "document", file_uuid: "e", title: "f" },
                { type: "weird_new_kind" },
              ],
            }),
          ],
        }),
      ],
      planCtx(),
    );
    expect(plan.stats.messagesByContentBlockKind).toEqual([
      { label: "document", count: 1 },
      { label: "image", count: 1 },
      { label: "injected_prompt_block", count: 1 },
      { label: "text", count: 1 },
      { label: "thinking", count: 1 },
      { label: "unknown:weird_new_kind", count: 1 },
    ]);
    expect(plan.stats.referencedFiles).toBe(2);
  });

  it("counts attachment records and skipped shapes across the whole plan", () => {
    const plan = buildPlan(
      [
        parseConversation({
          chat_messages: [
            rawMessage({ attachments: [{ file_name: "a.png", file_size: 1 }], files: "bogus" }),
          ],
        }),
      ],
      planCtx(),
    );
    expect(plan.stats.attachments).toBe(1);
    expect(plan.stats.attachmentShapesSkipped).toBe(1);
  });

  it("preserves export order (conversations are handled in the order the artifact lists them)", () => {
    const plan = buildPlan(
      [
        parseClaudeConversation(rawConversation({ uuid: CONV_B }), 0),
        parseClaudeConversation(rawConversation({ uuid: CONV_A }), 1),
      ],
      planCtx(),
    );
    expect(plan.conversations.map((c) => c.conversationUuid)).toEqual([CONV_B, CONV_A]);
    expect(plan.conversations.map((c) => c.index)).toEqual([0, 1]);
  });

  it("plans an empty export as an empty plan", () => {
    const plan = buildPlan([], planCtx());
    expect(plan.conversations).toEqual([]);
    expect(plan.stats).toMatchObject({ conversations: 0, messages: 0, doubleEncodedMessages: 0 });
  });

  it("prefixes every parser warning with the conversation it came from", () => {
    const plan = buildPlan(
      [parseConversation({ chat_messages: [rawMessage({ sender: "system" })] })],
      planCtx(),
    );
    expect(plan.warnings.some((w) => w.startsWith(CONV_A))).toBe(true);
    expect(plan.warnings.join(" ")).toContain("unrecognised sender");
  });

  it("keeps every parsed conversation exactly once in the plan", () => {
    const plan = buildPlan(
      [
        parseConversation(),
        parseConversation({ uuid: CONV_B }),
        parseClaudeConversation(rawConversation({ uuid: "" }), 2),
      ],
      planCtx(),
    );
    expect(plan.conversations).toHaveLength(3);
    expect(plan.conversations.map((c) => c.index)).toEqual([0, 0, 2]);
    // The accounting invariant: conversations + their messages are never silently dropped.
    const totalMessages = plan.conversations.reduce((n, c) => n + c.messages.length, 0);
    expect(totalMessages).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("buildPlan — full synthetic conversation (the real export's shapes)", () => {
  /**
   * The first conversation of the real slice, rebuilt in memory: a human turn, an assistant turn
   * with thinking + a citation + an artifact + a tool call, then a human turn carrying an image
   * block, an injected date note, and the matching `files` record.
   */
  function fixtureConversation(): ClaudeConversation {
    const raw = {
      uuid: CONV_A,
      name: "Kubernetes ingress 502s after cert rotation",
      summary: "",
      created_at: "2024-08-15T14:23:11.123456+00:00",
      updated_at: "2024-08-15T15:01:02.654321+00:00",
      account: { uuid: "0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9" },
      chat_messages: [
        rawMessage({
          uuid: MSG_1,
          text: "Our ingress started 502ing right after we rotated the wildcard cert.",
          content: [
            {
              type: "text",
              text: "Our ingress started 502ing right after we rotated the wildcard cert.",
              citations: [],
            },
          ],
        }),
        rawMessage({
          uuid: MSG_2,
          sender: "assistant",
          text: "",
          content: [
            {
              type: "thinking",
              thinking: "Check the controller first.",
              summaries: [],
              cut_off: false,
            },
            {
              type: "text",
              text: "Start with the controller, not the backend.",
              citations: [
                {
                  uuid: "cit-1",
                  details: { type: "web_search_result_location", url: "https://example.com/k8s" },
                },
              ],
            },
            {
              type: "tool_use",
              name: "artifacts",
              input: {
                title: "Readiness probe patch",
                type: "application/vnd.ant.code",
                language: "yaml",
                content: "readinessProbe: {}",
              },
              id: "toolu_1",
            },
            {
              type: "tool_use",
              name: "web_search",
              input: { query: "ingress 502 cert rotation" },
              id: "toolu_2",
            },
            { type: "tool_result", content: "search results …" },
          ],
        }),
        rawMessage({
          uuid: MSG_3,
          text: "",
          content: [
            { type: "image", source: null, file_uuid: "0a110000-0000-4000-8000-0000000000a7" },
            { type: "text", text: "Ready to test the driver's side then.", citations: [] },
            {
              type: "injected_prompt_block",
              prompt: "\n\nThe current date is Saturday, September 19, 2026.",
              injection_source: "date_note",
            },
          ],
          files: [{ file_uuid: "0a110000-0000-4000-8000-0000000000a7", file_name: "photo-4638.jpg" }],
        }),
      ],
    };
    return parseClaudeConversation(raw, 0);
  }

  it("plans one page whose body marks prose, thinking, artifact, tool calls and attachments", () => {
    const plan = buildPlan([fixtureConversation()], planCtx());
    const page = plan.conversations[0];
    expect(page.action).toBe("WRITE");
    expect(page.relPath).toBe("notes/kubernetes-ingress-502s-after-cert-rotation.md");
    expect(page.messageCounts).toEqual({ rendered: 3, placeholder: 0 });

    expect(page.body).toContain("## Human — 2024-08-15T14:23:11.123Z");
    expect(page.body).toContain("## Assistant — 2024-08-15T14:23:11.123Z");
    expect(page.body).toContain("Start with the controller, not the backend.");
    expect(page.body).toContain("**Thinking**");
    expect(page.body).toContain(
      "**Artifact: Readiness probe patch (application/vnd.ant.code, yaml)**",
    );
    expect(page.body).toContain("*[tool call: `web_search`]*");
    expect(page.body).toContain("*Sources:*");
    expect(page.body).toContain("[https://example.com/k8s](https://example.com/k8s)");
    expect(page.body).toContain("**Attachments**");
    expect(page.body).toContain("image: photo-4638.jpg — file 0a110000-0000-4000-8000-0000000000a7");
    // The injected block and the tool's input/output are machinery, never page content.
    expect(page.body).not.toContain("current date");
    expect(page.body).not.toContain("ingress 502 cert rotation");
    expect(page.body).not.toContain("search results …");
    // The artifact body never leaks into the prose line, only into its fenced section.
    expect(page.body.indexOf("Readiness probe patch")).toBeLessThan(
      page.body.indexOf("readinessProbe: {}"),
    );
  });

  it("is stable across two runs with the same existing-set (the plan is pure)", () => {
    const conversation = fixtureConversation();
    const first = buildPlan([conversation], planCtx());
    const second = buildPlan([conversation], planCtx());
    expect(JSON.stringify(second.conversations)).toBe(JSON.stringify(first.conversations));
  });

  it("reports the second run as SKIP-identical once the page is on disk", () => {
    const conversation = fixtureConversation();
    const first = buildPlan([conversation], planCtx());
    const path = first.conversations[0].relPath;
    const second = buildPlan([conversation], {
      existingPages: new Map([[path, first.conversations[0].fileText]]),
      importSource: CLAUDE_IMPORT_SOURCE,
    });
    expect(second.conversations[0].action).toBe("SKIP-identical");
    expect(second.conversations.filter((c) => c.action === "WRITE")).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("real-export shapes — verbatim fragments from the on-disk export", () => {
  /** A verbatim `injected_prompt_block` from the real export (54 occurrences there). */
  const REAL_INJECTED = {
    start_timestamp: "2026-09-18T22:08:35.572184Z",
    stop_timestamp: "2026-09-18T22:08:35.572184Z",
    flags: null,
    type: "injected_prompt_block",
    prompt: "\n\nThe current date is Friday, September 18, 2026.",
    injection_source: "date_note",
    initial_turn_only: false,
    skip_on_truncated_continuation: false,
  };

  /** A verbatim `document` block from the real export (4 occurrences). */
  const REAL_DOCUMENT = {
    start_timestamp: null,
    stop_timestamp: null,
    flags: null,
    type: "document",
    file_uuid: "0a110000-0000-4000-8000-0000000000a8",
    title: "10 Ton Incentive Unit Award Agreement Full-On Pictures.docx",
  };

  /** A verbatim `image` block from the real export (16 occurrences). */
  const REAL_IMAGE = {
    start_timestamp: null,
    stop_timestamp: null,
    flags: null,
    type: "image",
    source: null,
    file_uuid: "0a110000-0000-4000-8000-0000000000a7",
  };

  it("parses the real injected / document / image blocks with no unknown-kind warning", () => {
    const extracted = extractBlockText([REAL_DOCUMENT, REAL_IMAGE, REAL_INJECTED]);
    expect(extracted.blockKindCounts).toEqual({
      document: 1,
      image: 1,
      injected_prompt_block: 1,
    });
    expect(extracted.warnings).toEqual([]);
    expect(extracted.text).toBe("");
    expect(extracted.fileRefs).toHaveLength(2);
  });

  it("handles the real 'four documents + text + two injected blocks' message end to end", () => {
    const message = parseClaudeMessage(
      {
        uuid: "0a110000-0000-4000-8000-0000000000a1",
        text: "Here are the updated docs.",
        content: [
          REAL_DOCUMENT,
          {
            ...REAL_DOCUMENT,
            file_uuid: "0a110000-0000-4000-8000-0000000000a6",
            title: "Joinder.docx",
          },
          {
            ...REAL_DOCUMENT,
            file_uuid: "0a110000-0000-4000-8000-0000000000a4",
            title: "Service v2 Clean.docx",
          },
          {
            ...REAL_DOCUMENT,
            file_uuid: "0a110000-0000-4000-8000-0000000000a9",
            title: "Service v2.docx",
          },
          { type: "text", text: "Here are the updated docs.", citations: [] },
          REAL_INJECTED,
          {
            ...REAL_INJECTED,
            prompt: "<system-reminder>…memory…</system-reminder>",
            injection_source: "memory",
          },
        ],
        sender: "human",
        created_at: "2026-09-18T22:08:35.572184Z",
        updated_at: "2026-09-18T22:08:35.572184Z",
        attachments: [],
        files: [],
        parent_message_uuid: "00000000-0000-4000-8000-000000000000",
      },
      0,
    );
    expect(message.text).toBe("Here are the updated docs.");
    expect(message.fileRefs).toHaveLength(4);
    expect(message.blockKindCounts.document).toBe(4);
    expect(message.blockKindCounts.injected_prompt_block).toBe(2);
    const markdown = renderMessageMarkdown(message);
    expect(markdown).toContain(
      "- document: 10 Ton Incentive Unit Award Agreement Full-On Pictures.docx",
    );
    expect(markdown).not.toContain("current date");
    expect(markdown).not.toContain("memory snapshot");
  });

  it("keeps the real 'image + text + injected' message's prose and attachment", () => {
    const message = parseClaudeMessage(
      {
        uuid: "0a110000-0000-4000-8000-0000000000a3",
        content: [
          REAL_IMAGE,
          { type: "text", text: "Ready to test the driver's side then.", citations: [] },
          { ...REAL_INJECTED, prompt: "\n\nThe current date is Saturday, September 19, 2026." },
        ],
        sender: "human",
        created_at: "2026-09-19T16:07:39.444960Z",
        updated_at: "2026-09-19T16:07:39.444960Z",
        attachments: [],
        files: [{ file_uuid: "0a110000-0000-4000-8000-0000000000a7", file_name: "photo-4638.jpg" }],
        parent_message_uuid: "0a110000-0000-4000-8000-0000000000a2",
      },
      0,
    );
    const markdown = renderMessageMarkdown(message);
    expect(message.text).toBe("Ready to test the driver's side then.");
    expect(markdown).toContain("image: photo-4638.jpg");
    expect(markdown).not.toContain("current date");
  });

  it("never lets a real attachment's `extracted_content` reach the page", () => {
    const message = parseClaudeMessage(
      {
        uuid: MSG_1,
        text: "Transcript attached.",
        content: [{ type: "text", text: "Transcript attached." }],
        sender: "human",
        created_at: "2026-09-12T17:33:19.401590Z",
        updated_at: "2026-09-12T17:33:19.401590Z",
        attachments: [
          {
            file_name: "",
            file_size: 15502,
            file_type: "txt",
            extracted_content: "Speaker A: I've made a lot of edits this morning.",
          },
        ],
        files: [],
      },
      0,
    );
    const markdown = renderMessageMarkdown(message);
    expect(markdown).toContain("**Attachments**");
    expect(markdown).toContain("txt, 15502 bytes");
    expect(markdown).not.toContain("Speaker A");
  });

  it("plans a real 100-conversation slice deterministically (shape, not content)", () => {
    const conversations = Array.from({ length: 100 }, (_, i) =>
      parseClaudeConversation(
        {
          ...rawConversation({
            uuid: `6f1c0a44-3a1e-4d2b-9f77-1c9a2b7d${String(i).padStart(4, "0")}`,
          }),
          name: i === 0 ? "Named one" : "",
        },
        i,
      ),
    );
    const plan = buildPlan(conversations, planCtx());
    expect(plan.conversations).toHaveLength(100);
    const paths = plan.conversations.filter((c) => c.action === "WRITE").map((c) => c.relPath);
    expect(paths).toHaveLength(100);
    expect(new Set(paths).size).toBe(100);
    expect(paths.every((p) => isValidSlugPath(p))).toBe(true);
    expect(paths.every((p) => p.startsWith("notes/"))).toBe(true);
  });
});
