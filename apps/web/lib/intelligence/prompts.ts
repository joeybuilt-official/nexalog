// SPDX-License-Identifier: MIT

/**
 * Prompt templates — CONFIGURATION, not code hidden at a call site
 * (`.agents/rules/ai-features.md`: "keep prompts as configuration … versioned
 * templates with named variables"). Each entry is versioned so a later model or
 * prompt can be attributed, and a call site renders one by name rather than
 * inlining a string.
 *
 * Model identifiers and tuning parameters come from `lib/env.ts`
 * (`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`); only prompts live here,
 * because a prompt is a file-shaped artifact while a model name is deployment
 * config. Tuning knobs (`maxTokens`, `temperature`) travel with the template
 * that was tuned for, and are read from this config object at the call site —
 * never written as literals next to the request.
 */

export type PromptTemplate = {
  /** Bump on any wording change; recorded with every output. */
  version: string;
  /** System frame (role: system). */
  system: string;
  /** User turn, with a single `{{input}}` placeholder. */
  template: string;
  maxTokens: number;
  temperature: number;
};

export const PROMPTS: Record<"projectBrief", PromptTemplate> = {
  projectBrief: {
    version: "project-brief-v1",
    system:
      "You write terse, factual project briefs from structured notes. " +
      "Use only the data supplied; never invent facts, names, dates or numbers. " +
      "Where the data cannot answer a question, say so plainly rather than guessing.",
    template: [
      "Write a project brief as GitHub-flavoured markdown with exactly these sections, in order:",
      "",
      "## What this project is",
      "## Current state",
      "## Active threads",
      "## Recent activity",
      "## Open questions",
      "",
      "Keep each section to a few short bullets. Cite note titles where they ground a claim.",
      "Do not repeat the input verbatim; synthesise it. If a section has no support in the",
      "data, write \"No evidence in the linked notes yet.\" rather than inventing content.",
      "",
      "--- PROJECT DATA ---",
      "{{input}}",
    ].join("\n"),
    maxTokens: 900,
    temperature: 0.2,
  },
};

/** Substitute the assembled input into a template. Throws if the placeholder is gone. */
export function renderPrompt(template: PromptTemplate, input: string): string {
  if (!template.template.includes("{{input}}")) {
    throw new Error(`Prompt template ${template.version} is missing its {{input}} placeholder`);
  }
  return template.template.replace("{{input}}", input);
}

/**
 * The inline block-edit commands, versioned like every other prompt.
 *
 * These began life as unversioned strings in `lib/ai/inline.ts` — a module nothing
 * imported, whose route was never written, so both editors shipped a menu that
 * called a 404. Moving them here makes them configuration with a version, which is
 * what lets an output be attributed to the prompt that produced it
 * (`.agents/rules/ai-features.md`).
 *
 * Every system frame carries the same two constraints the brief prompt carries,
 * because both are about honesty rather than style: use only the supplied text, and
 * never invent facts. The `related` command is the one exception in shape — it
 * produces NEW material rather than a rewrite, so it is told so explicitly.
 */
export const INLINE_COMMANDS = [
  "summarize",
  "related",
  "checklist",
  "expand",
  "shorten",
  "rephrase",
] as const;

export type InlineCommand = (typeof INLINE_COMMANDS)[number];

const INLINE_SYSTEM =
  "You edit one block of a personal knowledge note. " +
  "Work only from the text supplied; never invent facts, names, dates or numbers. " +
  "Return only the resulting text — no preamble, no explanation, no surrounding quotes.";

export const INLINE_PROMPTS: Record<InlineCommand, PromptTemplate> = {
  summarize: {
    version: "inline-summarize-v1",
    system: INLINE_SYSTEM,
    template: ["Condense the following note block, keeping its substance:", "", "{{input}}"].join("\n"),
    maxTokens: 500,
    temperature: 0.2,
  },
  related: {
    version: "inline-related-v1",
    system:
      INLINE_SYSTEM +
      " You are adding NEW material, not rewriting: propose adjacent ideas the block implies but does not state.",
    template: [
      "Write 2-4 short lines naming ideas related to this note block.",
      "Return them as plain lines, no bullet characters, no heading:",
      "",
      "{{input}}",
    ].join("\n"),
    maxTokens: 400,
    temperature: 0.6,
  },
  checklist: {
    version: "inline-checklist-v1",
    system: INLINE_SYSTEM,
    template: [
      "Convert the following note block into a markdown checklist.",
      "Use `- [ ]` for each item. Do not add items the text does not support:",
      "",
      "{{input}}",
    ].join("\n"),
    maxTokens: 500,
    temperature: 0.2,
  },
  expand: {
    version: "inline-expand-v1",
    system: INLINE_SYSTEM,
    template: [
      "Expand the following note block with more detail, preserving its meaning and voice:",
      "",
      "{{input}}",
    ].join("\n"),
    maxTokens: 700,
    temperature: 0.5,
  },
  shorten: {
    version: "inline-shorten-v1",
    system: INLINE_SYSTEM,
    template: [
      "Shorten the following note block, preserving its key meaning:",
      "",
      "{{input}}",
    ].join("\n"),
    maxTokens: 400,
    temperature: 0.2,
  },
  rephrase: {
    version: "inline-rephrase-v1",
    system: INLINE_SYSTEM,
    template: ["Rephrase the following note block, preserving its meaning:", "", "{{input}}"].join("\n"),
    maxTokens: 500,
    temperature: 0.4,
  },
};
