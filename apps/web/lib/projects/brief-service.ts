// SPDX-License-Identifier: MIT
// NEXALOG-PROJECTS — the brief SYNTHESIS use case.
//
// It takes the pure module's assembled input and produces a `ProjectBrief`. The
// model leg is INJECTED as an `IntelligencePort`, so this file names no provider,
// no model id and no wire shape, and its tests run with an in-process fake — no
// network, no database, no framework.
//
// DEGRADE, NEVER HARD-FAIL (`.agents/rules/ai-features.md`, "Guardrails"):
//   - no model configured        → the labelled mechanical digest, not a 500;
//   - the model errored          → the same digest, reason `model_failed`;
//   - the model returned nothing → `empty_output`.
// A brief that cannot be synthesized is still a brief the reader can use, and
// Plexo (or any model) is optional by design (ADR-0017).
//
// The upstream failure is logged with its stable code and never rendered: a
// fallback carries a reason CODE, never the provider's message text.

import { IntelligenceError, type IntelligencePort } from "@/lib/intelligence/port";
import { PROMPTS, renderPrompt } from "@/lib/intelligence/prompts";
import {
  briefSummary,
  renderBriefSynthesisInput,
  renderFallbackBrief,
  sanitizeBriefMarkdown,
  type BriefFallbackReason,
  type ProjectBrief,
  type ProjectBriefInput,
} from "./brief";

/** Structured-log sink, injected so the use case stays free of the logger module. */
export type BriefLogger = (event: string, data: Record<string, unknown>) => void;

export type SynthesizeBriefDeps = {
  /** Null when no model is configured — a first-class state, not an error. */
  intelligence: IntelligencePort | null;
  /** The instant stamped on the result. Falls back to the input's `asOf`. */
  now?: Date | null;
  signal?: AbortSignal;
  log?: BriefLogger;
};

type BriefShared = Pick<ProjectBrief, "promptVersion" | "generatedAt" | "summary">;

function fallback(input: ProjectBriefInput, shared: BriefShared, reason: BriefFallbackReason): ProjectBrief {
  return {
    state: "fallback",
    markdown: renderFallbackBrief(input, reason),
    model: null,
    reason,
    ...shared,
  };
}

export async function synthesizeProjectBrief(
  input: ProjectBriefInput,
  deps: SynthesizeBriefDeps,
): Promise<ProjectBrief> {
  const prompt = PROMPTS.projectBrief;
  const now = deps.now ?? null;
  const generatedAt =
    now && !Number.isNaN(now.getTime()) ? now.toISOString() : input.asOf;
  const shared: BriefShared = {
    promptVersion: prompt.version,
    generatedAt,
    summary: briefSummary(input),
  };

  if (!deps.intelligence) {
    return fallback(input, shared, "model_unconfigured");
  }

  try {
    const completion = await deps.intelligence.complete({
      system: prompt.system,
      prompt: renderPrompt(prompt, renderBriefSynthesisInput(input)),
      maxTokens: prompt.maxTokens,
      temperature: prompt.temperature,
      ...(deps.signal ? { signal: deps.signal } : {}),
    });

    const markdown = sanitizeBriefMarkdown(completion.text);
    if (!markdown) return fallback(input, shared, "empty_output");

    return {
      state: "synthesized",
      markdown,
      model: completion.model,
      reason: null,
      ...shared,
    };
  } catch (error) {
    // The upstream text is operational detail and stays in the log; the caller
    // gets a stable code it can branch on.
    deps.log?.("brief.synthesis_failed", {
      projectId: input.projectId,
      adapter: deps.intelligence.id,
      code: error instanceof IntelligenceError ? error.code : "unknown",
      status: error instanceof IntelligenceError ? error.status : null,
    });
    return fallback(input, shared, "model_failed");
  }
}
