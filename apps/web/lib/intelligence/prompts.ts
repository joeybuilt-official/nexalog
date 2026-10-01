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
