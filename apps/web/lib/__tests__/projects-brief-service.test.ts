// SPDX-License-Identifier: MIT
/**
 * The brief SYNTHESIS use case — driven with an in-process fake `IntelligencePort`,
 * so the model leg is a value the test controls and nothing connects: no HTTP,
 * no database, no framework.
 *
 * What is pinned here is the DEGRADATION contract the whole feature rests on:
 * a brief always comes back, the fallback is clearly labelled, a model failure is
 * a reason code and never upstream text, and the prompt is the configured
 * template with the deterministic input substituted.
 */

import { describe, it, expect, vi } from "vitest";
import {
  assembleProjectBriefInput,
  type ProjectBriefSource,
} from "@/lib/projects/brief";
import { synthesizeProjectBrief } from "@/lib/projects/brief-service";
import type { IntelligencePort } from "@/lib/intelligence/port";
import { PROMPTS } from "@/lib/intelligence/prompts";

const NOW = new Date("2026-10-01T12:00:00.000Z");

function source(overrides: Partial<ProjectBriefSource> = {}): ProjectBriefSource {
  return {
    project: {
      id: "p1",
      name: "Project Alpha",
      description: "A container.",
      lifecycleState: "active",
      livingDoc: "",
      deletedAt: null,
    },
    notes: [{ id: "n1", title: "Kickoff", updatedAt: NOW, contentLength: 120 }],
    subProjects: [],
    themes: [],
    ...overrides,
  };
}

function input(overrides: Partial<ProjectBriefSource> = {}) {
  const assembled = assembleProjectBriefInput(source(overrides), { now: NOW });
  if (!assembled) throw new Error("fixture project should assemble");
  return assembled;
}

function fakePort(text: string, model = "fake-model"): IntelligencePort {
  return {
    id: "fake",
    model,
    complete: vi.fn(async () => ({ text, model })),
  };
}

describe("synthesizeProjectBrief — no model configured", () => {
  it("returns the labelled fallback instead of failing", async () => {
    const brief = await synthesizeProjectBrief(input(), { intelligence: null, now: NOW });

    expect(brief.state).toBe("fallback");
    expect(brief.reason).toBe("model_unconfigured");
    expect(brief.model).toBeNull();
    expect(brief.markdown).toContain("Not synthesized");
    expect(brief.markdown).toContain("# Project Alpha — project brief");
    expect(brief.promptVersion).toBe(PROMPTS.projectBrief.version);
    expect(brief.generatedAt).toBe(NOW.toISOString());
  });

  it("reports the counts the surface renders", async () => {
    const brief = await synthesizeProjectBrief(input(), { intelligence: null, now: NOW });
    expect(brief.summary.notesTotal).toBe(1);
    expect(brief.summary.notesShown).toBe(1);
  });
});

describe("synthesizeProjectBrief — the model answers", () => {
  it("returns the sanitized markdown and the model that answered", async () => {
    const port = fakePort("```markdown\n# Alpha brief\n\n## Current state\n- live\n```");
    const brief = await synthesizeProjectBrief(input(), { intelligence: port, now: NOW });

    expect(brief.state).toBe("synthesized");
    expect(brief.reason).toBeNull();
    expect(brief.model).toBe("fake-model");
    expect(brief.markdown).toBe("# Alpha brief\n\n## Current state\n- live");
  });

  it("sends the configured template with the deterministic input substituted", async () => {
    const port = fakePort("answer");
    await synthesizeProjectBrief(input(), { intelligence: port, now: NOW });

    const call = vi.mocked(port.complete).mock.calls[0][0];
    expect(call.system).toBe(PROMPTS.projectBrief.system);
    expect(call.maxTokens).toBe(PROMPTS.projectBrief.maxTokens);
    expect(call.temperature).toBe(PROMPTS.projectBrief.temperature);
    expect(call.prompt).toContain("Write a project brief as GitHub-flavoured markdown");
    expect(call.prompt).toContain("Project: Project Alpha");
    expect(call.prompt).toContain("[no date] Kickoff (120 chars");
  });

  it("falls back when the model returns nothing usable", async () => {
    const brief = await synthesizeProjectBrief(input(), {
      intelligence: fakePort("   \n  "),
      now: NOW,
    });
    expect(brief.state).toBe("fallback");
    expect(brief.reason).toBe("empty_output");
    expect(brief.model).toBeNull();
  });
});

describe("synthesizeProjectBrief — the model fails", () => {
  it("degrades to the fallback and logs a stable code, never the upstream text", async () => {
    const port: IntelligencePort = {
      id: "fake",
      model: "fake-model",
      complete: vi.fn(async () => {
        throw new Error("upstream said: secret provider payload");
      }),
    };
    const log = vi.fn();

    const brief = await synthesizeProjectBrief(input(), { intelligence: port, now: NOW, log });

    expect(brief.state).toBe("fallback");
    expect(brief.reason).toBe("model_failed");
    expect(brief.markdown).not.toContain("secret provider payload");
    expect(log).toHaveBeenCalledWith("brief.synthesis_failed", {
      projectId: "p1",
      adapter: "fake",
      code: "unknown",
      status: null,
    });
  });
});
