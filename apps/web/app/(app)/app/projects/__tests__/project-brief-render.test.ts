// SPDX-License-Identifier: MIT
/**
 * The project page's BRIEF SECTION as rendered markup — the part of this feature
 * that is not pure logic and therefore cannot be reached by the module's tests.
 *
 * What this pins, and why each is a real regression:
 *   - an EMPTY project renders a designed, labelled digest, never a blank region
 *     (a brief computed for a project with no notes still has to say something);
 *   - a POPULATED project renders the synthesized markdown, names the model, and
 *     shows the counts the API returned;
 *   - the fallback is LABELLED as not-synthesized and its reason-specific copy
 *     reaches the DOM, so a reader can never mistake a mechanical digest for a
 *     model's summary;
 *   - the markdown is rendered as an ESCAPED text node — model output can never
 *     become live HTML on the project page;
 *   - the regenerate control is present and named.
 *
 * Written as a `.ts` spec with `createElement`: vitest collects `*.test.ts` only,
 * and the spec lives beside the surface so it can import `app/` without crossing
 * `web-lib-no-ui`.
 */

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BRIEF_FALLBACK_LABEL,
  assembleProjectBriefInput,
  renderFallbackBrief,
  type ProjectBrief,
  type ProjectBriefSource,
} from "@/lib/projects/brief";
import { BriefSection } from "../[id]/brief-section";

const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-01T12:00:00.000Z");

function emptyBrief(): ProjectBrief {
  const source: ProjectBriefSource = {
    project: {
      id: PROJECT_ID,
      name: "Project Alpha",
      description: null,
      lifecycleState: "draft",
      livingDoc: "",
      deletedAt: null,
    },
    notes: [],
    subProjects: [],
    themes: [],
  };
  const input = assembleProjectBriefInput(source, { now: NOW });
  if (!input) throw new Error("fixture project should assemble");
  return {
    state: "fallback",
    markdown: renderFallbackBrief(input, "model_unconfigured"),
    model: null,
    promptVersion: "project-brief-v1",
    generatedAt: NOW.toISOString(),
    reason: "model_unconfigured",
    summary: {
      notesTotal: 0,
      notesShown: 0,
      notesHiddenDeleted: 0,
      subProjectsTotal: 0,
      themes: [],
      livingDocChars: 0,
    },
  };
}

function synthesizedBrief(markdown: string): ProjectBrief {
  return {
    state: "synthesized",
    markdown,
    model: "test-model",
    promptVersion: "project-brief-v1",
    generatedAt: NOW.toISOString(),
    reason: null,
    summary: {
      notesTotal: 3,
      notesShown: 3,
      notesHiddenDeleted: 1,
      subProjectsTotal: 1,
      themes: ["Agents"],
      livingDocChars: 20,
    },
  };
}

function html(brief: ProjectBrief): string {
  return renderToStaticMarkup(
    createElement(BriefSection, { projectId: PROJECT_ID, initialBrief: brief }),
  );
}

describe("BriefSection — the empty project", () => {
  it("renders a labelled digest rather than a blank section", () => {
    const markup = html(emptyBrief());

    expect(markup).toContain("data-project-brief");
    expect(markup).toContain('data-brief-state="fallback"');
    expect(markup).toContain(BRIEF_FALLBACK_LABEL);
    expect(markup).toContain("No linked notes yet");
    expect(markup).toContain("data-brief-body");
    expect(markup).toContain("data-brief-regenerate");
  });

  it("reports zero counts honestly", () => {
    const markup = html(emptyBrief());
    expect(markup).toContain("0 linked notes");
    expect(markup).not.toContain("sub-projects");
  });
});

describe("BriefSection — the populated project", () => {
  const markdown = [
    "# Project Alpha — project brief",
    "",
    "## What this project is",
    "A container for the alpha thread.",
    "",
    "## Current state",
    "- Lifecycle: active",
  ].join("\n");

  it("renders the synthesized markdown and names the model", () => {
    const markup = html(synthesizedBrief(markdown));

    expect(markup).toContain('data-brief-state="synthesized"');
    expect(markup).toContain("What this project is");
    expect(markup).toContain("A container for the alpha thread.");
    expect(markup).toContain("Synthesized");
    expect(markup).toContain("test-model");
  });

  it("shows the counts the API returned", () => {
    const markup = html(synthesizedBrief(markdown));
    expect(markup).toContain("3 linked notes (1 deleted)");
    expect(markup).toContain("1 sub-project");
    expect(markup).toContain("themes: Agents");
  });

  it("offers a labelled regenerate control", () => {
    const markup = html(synthesizedBrief(markdown));
    expect(markup).toContain("Regenerate");
    expect(markup).toContain('aria-busy="false"');
  });
});

describe("BriefSection — the fallback is labelled, and its reason reaches the DOM", () => {
  it("renders the model-failed copy", () => {
    const source: ProjectBriefSource = {
      project: {
        id: PROJECT_ID,
        name: "Project Alpha",
        description: null,
        lifecycleState: "active",
        livingDoc: "",
        deletedAt: null,
      },
      notes: [],
      subProjects: [],
      themes: [],
    };
    const input = assembleProjectBriefInput(source, { now: NOW })!;
    const markup = html({
      ...emptyBrief(),
      reason: "model_failed",
      markdown: renderFallbackBrief(input, "model_failed"),
    });

    expect(markup).toContain(BRIEF_FALLBACK_LABEL);
    expect(markup).toContain("The model could not be reached");
    // Never presented as a synthesis.
    expect(markup).not.toContain(">Synthesized<");
  });
});

describe("BriefSection — model output can never become live HTML here", () => {
  it("escapes a hostile markdown body as text", () => {
    const markup = html(synthesizedBrief('<img src=x onerror="alert(1)"> & <script>bad()</script>'));

    expect(markup).toContain("&lt;img src=x onerror=");
    expect(markup).not.toContain("<img src=x");
    expect(markup).not.toContain("<script>bad()");
  });
});
