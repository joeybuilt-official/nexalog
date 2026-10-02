// SPDX-License-Identifier: MIT
// NEXALOG-AI-INLINE — the inline block-edit use case.
//
// Both editor surfaces POST `{ command, blockText }` to `/api/ai/inline` and read
// `{ result }`: the web slash menu (`components/editor/slash-extension.ts`) and the
// native note editor (`mobile/lib/src/features/notes/wysiwyg_note_editor.dart`).
// That route was never committed, so both clients have always shipped a menu whose
// call 404s. This module is the rule the route serves.
//
// It replaces the previous contents of this file — six unversioned prompt strings
// behind `buildInlineAiPrompt`, imported by nothing. The prompts moved to
// `lib/intelligence/prompts.ts` (versioned configuration, per
// `.agents/rules/ai-features.md`); the rule lives here, with the model leg INJECTED
// as an `IntelligencePort`, so this file names no provider, no model id and no wire
// shape and its tests run against an in-process fake.
//
// WHICH COMMANDS EXIST IS A CLOSED SET, and an unknown one is refused rather than
// becoming a free-form prompt: `command` arrives from a client, and letting an
// arbitrary string through would make this endpoint a general-purpose model proxy
// for any signed-in user.
//
// `related` is the one command that INSERTS rather than REPLACES: it returns new
// text to place below the block, where the other five return a replacement for the
// block itself. The mode travels with the result so a caller never has to know which
// is which.

import { IntelligenceError, type IntelligencePort } from "@/lib/intelligence/port";
import { INLINE_PROMPTS, renderPrompt, type InlineCommand } from "@/lib/intelligence/prompts";

export { INLINE_COMMANDS, type InlineCommand } from "@/lib/intelligence/prompts";

export function isInlineCommand(value: unknown): value is InlineCommand {
  return typeof value === "string" && value in INLINE_PROMPTS;
}

/** How the caller applies the result: `replace` swaps the block, `insert` appends below. */
export function inlineCommandMode(command: InlineCommand): "replace" | "insert" {
  return command === "related" ? "insert" : "replace";
}

/** Stable failure vocabulary — the route maps these to status codes. */
export type InlineFailureReason = "model_unconfigured" | "model_failed" | "empty_output";

export type InlineResult =
  | {
      ok: true;
      text: string;
      model: string;
      promptVersion: string;
      mode: "replace" | "insert";
    }
  | { ok: false; reason: InlineFailureReason };

/** Structured-log sink, injected so the use case stays free of the logger module. */
export type InlineLogger = (event: string, data: Record<string, unknown>) => void;

export type RunInlineCommandDeps = {
  /** Null when no model is configured — a first-class state, not an error. */
  intelligence: IntelligencePort | null;
  signal?: AbortSignal;
  log?: InlineLogger;
};

/**
 * The input ceiling. A block is a paragraph, not a document; a caller sending more is
 * either a bug or an attempt to use this as a general model proxy, and both are
 * answered by refusing rather than by silently truncating the user's own text.
 */
export const INLINE_MAX_INPUT_CHARS = 8000;

/** Trim; return null for absent, empty, or oversized input. */
export function normalizeBlockText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text) return null;
  if (text.length > INLINE_MAX_INPUT_CHARS) return null;
  return text;
}

/**
 * Run one inline command over one block.
 *
 * Never throws for a model problem: the caller gets `{ ok: false, reason }` and
 * decides the status. The upstream message is operational detail and stays in the log.
 */
export async function runInlineCommand(
  command: InlineCommand,
  blockText: string,
  deps: RunInlineCommandDeps,
): Promise<InlineResult> {
  const prompt = INLINE_PROMPTS[command];

  if (!deps.intelligence) {
    return { ok: false, reason: "model_unconfigured" };
  }

  try {
    const completion = await deps.intelligence.complete({
      system: prompt.system,
      prompt: renderPrompt(prompt, blockText),
      maxTokens: prompt.maxTokens,
      temperature: prompt.temperature,
      ...(deps.signal ? { signal: deps.signal } : {}),
    });

    // A model that answers with whitespace has not answered. Refusing is honest;
    // returning "" would silently blank the user's paragraph.
    const text = completion.text.trim();
    if (!text) return { ok: false, reason: "empty_output" };

    return {
      ok: true,
      text,
      model: completion.model,
      promptVersion: prompt.version,
      mode: inlineCommandMode(command),
    };
  } catch (error) {
    deps.log?.("ai.inline_failed", {
      command,
      adapter: deps.intelligence.id,
      code: error instanceof IntelligenceError ? error.code : "unknown",
      status: error instanceof IntelligenceError ? error.status : null,
    });
    return { ok: false, reason: "model_failed" };
  }
}
