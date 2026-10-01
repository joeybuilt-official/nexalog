// SPDX-License-Identifier: MIT
/**
 * The PURE brief rules — every decision the feature makes about what survives,
 * what order it is in, how much of it is carried, which themes are matched, what
 * the model is handed, and what the not-synthesized digest says.
 *
 * These run in-process with plain values: no database, no network, no React, no
 * clock of our own (the instant is injected). That is the point of the module —
 * if any of this needed infrastructure to test, the rule would be in the wrong
 * layer.
 */

import { describe, it, expect } from "vitest";
import {
  BRIEF_FALLBACK_LABEL,
  BRIEF_FALLBACK_REASONS,
  BRIEF_FALLBACK_TEXT,
  BRIEF_MAX_LIVING_DOC_CHARS,
  BRIEF_MAX_NOTES,
  BRIEF_MAX_SUB_PROJECTS,
  BRIEF_MAX_THEMES,
  BRIEF_RECENT_NOTE_DAYS,
  assembleProjectBriefInput,
  boundedText,
  briefCentroid,
  briefSummary,
  compareBriefNotes,
  matchProjectThemes,
  renderBriefSynthesisInput,
  renderFallbackBrief,
  sanitizeBriefMarkdown,
  type ProjectBriefSource,
} from "@/lib/projects/brief";

const NOW = new Date("2026-10-01T12:00:00.000Z");

function source(overrides: Partial<ProjectBriefSource> = {}): ProjectBriefSource {
  return {
    project: {
      id: "p1",
      name: "Project Alpha",
      description: "A container for the alpha thread.",
      lifecycleState: "active",
      livingDoc: "",
      deletedAt: null,
    },
    notes: [],
    subProjects: [],
    themes: [],
    ...overrides,
  };
}

function note(id: string, overrides: Record<string, unknown> = {}) {
  return { id, title: `Note ${id}`, ...overrides } as ProjectBriefSource["notes"][number];
}

function assemble(overrides: Partial<ProjectBriefSource> = {}, now: Date | null = NOW) {
  return assembleProjectBriefInput(source(overrides), { now });
}

describe("assembleProjectBriefInput — emptiness and refusal", () => {
  it("has no brief for a soft-deleted project", () => {
    expect(assemble({ project: { ...source().project, deletedAt: new Date() } })).toBeNull();
  });

  it("assembles an empty project without inventing content", () => {
    const input = assemble();
    expect(input).not.toBeNull();
    expect(input!.notesTotal).toBe(0);
    expect(input!.notes).toEqual([]);
    expect(input!.notesOmitted).toBe(0);
    expect(input!.notesHiddenDeleted).toBe(0);
    expect(input!.subProjects).toEqual([]);
    expect(input!.subProjectsTotal).toBe(0);
    expect(input!.themes).toEqual([]);
    expect(input!.recentCount).toBe(0);
  });

  it("renders a designed digest for an empty project, never a blank", () => {
    const markdown = renderFallbackBrief(
      assemble({
        project: { ...source().project, description: null, livingDoc: "" },
      })!,
      "model_unconfigured",
    );
    expect(markdown).toContain("# Project Alpha — project brief");
    expect(markdown).toContain(BRIEF_FALLBACK_LABEL);
    expect(markdown).toContain("No linked notes yet");
    expect(markdown).toContain("No description and no living document content yet.");
  });

  it("treats a whitespace-only name as Untitled rather than empty", () => {
    const input = assemble({ project: { ...source().project, name: "   " } });
    expect(input!.name).toBe("Untitled");
  });
});

describe("assembleProjectBriefInput — notes", () => {
  it("orders notes most-recently-updated first, then linked, then id — a TOTAL order", () => {
    const input = assemble({
      notes: [
        note("b", { updatedAt: "2026-09-02T00:00:00.000Z" }),
        note("a", { updatedAt: "2026-09-02T00:00:00.000Z", addedAt: "2026-09-01T00:00:00.000Z" }),
        note("c", { updatedAt: "2026-09-03T00:00:00.000Z" }),
        note("d", { updatedAt: "2026-09-02T00:00:00.000Z", addedAt: "2026-09-05T00:00:00.000Z" }),
      ],
    });
    expect(input!.notes.map((n) => n.id)).toEqual(["c", "d", "a", "b"]);
  });

  it("is deterministic — the same rows assemble byte-identically", () => {
    const rows = { notes: [note("z", { updatedAt: NOW }), note("y", { updatedAt: NOW })] };
    expect(assemble(rows)).toEqual(assemble(rows));
  });

  it("refuses soft-deleted notes and counts what it withheld", () => {
    const input = assemble({
      notes: [
        note("live"),
        note("gone", { deletedAt: new Date("2026-09-01T00:00:00.000Z") }),
      ],
    });
    expect(input!.notes.map((n) => n.id)).toEqual(["live"]);
    expect(input!.notesTotal).toBe(1);
    expect(input!.notesHiddenDeleted).toBe(1);
  });

  it("caps the listed notes and reports the remainder", () => {
    const notes = Array.from({ length: BRIEF_MAX_NOTES + 7 }, (_, i) =>
      note(`n${String(i).padStart(3, "0")}`, {
        updatedAt: new Date(NOW.getTime() - i * 60_000),
      }),
    );
    const input = assemble({ notes });
    expect(input!.notes).toHaveLength(BRIEF_MAX_NOTES);
    expect(input!.notesTotal).toBe(BRIEF_MAX_NOTES + 7);
    expect(input!.notesOmitted).toBe(7);
  });

  it("carries a very large note as a SIZE, never as content", () => {
    const input = assemble({
      notes: [note("huge", { contentLength: 1_500_000, updatedAt: NOW })],
    });
    expect(input!.notes[0].sizeChars).toBe(1_500_000);
  });

  it("normalises a missing title and a missing size", () => {
    const input = assemble({ notes: [note("x", { title: "   " })] });
    expect(input!.notes[0].title).toBe("Untitled");
    expect(input!.notes[0].sizeChars).toBe(0);
  });
});

describe("assembleProjectBriefInput — recency is injected, not read", () => {
  it("counts only notes inside the window", () => {
    const input = assemble({
      notes: [
        note("recent", { updatedAt: new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000) }),
        note("stale", { updatedAt: new Date(NOW.getTime() - 200 * 24 * 60 * 60 * 1000) }),
      ],
    });
    expect(input!.recentCount).toBe(1);
    expect(input!.recentNotes.map((n) => n.id)).toEqual(["recent"]);
    expect(input!.recentWindowDays).toBe(BRIEF_RECENT_NOTE_DAYS);
  });

  it("reports no recency at all when no clock was supplied", () => {
    const input = assemble({ notes: [note("recent", { updatedAt: NOW })] }, null);
    expect(input!.recentCount).toBe(0);
    expect(input!.recentNotes).toEqual([]);
    expect(input!.asOf).toBeNull();
  });

  it("stamps the injected instant", () => {
    expect(assemble()!.asOf).toBe(NOW.toISOString());
  });
});

describe("assembleProjectBriefInput — sub-projects", () => {
  it("lists live sub-projects alphabetically and drops soft-deleted ones", () => {
    const input = assemble({
      subProjects: [
        { id: "s3", name: "Zeta", lifecycleState: "active" },
        { id: "s1", name: "alpha", lifecycleState: "draft" },
        { id: "s2", name: "Gone", lifecycleState: "active", deletedAt: new Date() },
      ],
    });
    expect(input!.subProjects.map((s) => s.name)).toEqual(["alpha", "Zeta"]);
    expect(input!.subProjectsTotal).toBe(2);
  });

  it("caps the sub-project list and counts the remainder", () => {
    const subProjects = Array.from({ length: BRIEF_MAX_SUB_PROJECTS + 3 }, (_, i) => ({
      id: `s${String(i).padStart(3, "0")}`,
      name: `Sub ${i}`,
      lifecycleState: "active",
    }));
    const input = assemble({ subProjects });
    expect(input!.subProjects).toHaveLength(BRIEF_MAX_SUB_PROJECTS);
    expect(input!.subProjectsOmitted).toBe(3);
  });
});

describe("assembleProjectBriefInput — the living document is bounded", () => {
  it("keeps a short living doc whole and without an ellipsis", () => {
    const input = assemble({ project: { ...source().project, livingDoc: "Short doc." } });
    expect(input!.livingDoc).toEqual({ text: "Short doc.", chars: 10, truncated: false });
  });

  it("bounds a huge living doc and reports the honest original length", () => {
    const doc = "word ".repeat(5000);
    const input = assemble({ project: { ...source().project, livingDoc: doc } });
    expect(input!.livingDoc.chars).toBe(doc.length);
    expect(input!.livingDoc.truncated).toBe(true);
    expect([...input!.livingDoc.text].length).toBeLessThanOrEqual(BRIEF_MAX_LIVING_DOC_CHARS + 1);
    expect(input!.livingDoc.text.endsWith("…")).toBe(true);
  });
});

describe("boundedText — code points, word boundary, honest length", () => {
  it("cuts on a word boundary and marks the cut", () => {
    const out = boundedText("alpha beta gamma delta", 12);
    expect(out.text).toBe("alpha beta…");
    expect(out.truncated).toBe(true);
    expect(out.chars).toBe(22);
  });

  it("never splits a surrogate pair", () => {
    const out = boundedText("😀😀😀😀", 2);
    expect(out.text).toBe("😀😀…");
    expect(out.text).not.toContain("�");
  });

  it("returns nothing (but the true length) for a non-positive budget", () => {
    expect(boundedText("abc", 0)).toEqual({ text: "", chars: 3, truncated: true });
    expect(boundedText("", 10)).toEqual({ text: "", chars: 0, truncated: false });
  });
});

describe("theme matching — reads themes, never recomputes them", () => {
  const themes = [
    { themeId: "t.exact", label: "Exact", size: 10, centroid: [1, 0] },
    { themeId: "t.orthogonal", label: "Orthogonal", size: 99, centroid: [0, 1] },
    { themeId: "t.spin", label: "Near", size: 5, centroid: [0.9, 0.1] },
    { themeId: "t.none", label: "No centroid", size: 3, centroid: null },
  ];

  it("scores by cosine and drops themes below the floor", () => {
    const matched = matchProjectThemes([{ embedding: [1, 0] }], themes);
    expect(matched.map((t) => t.themeId)).toEqual(["t.exact", "t.spin"]);
    expect(matched[0].score).toBeCloseTo(1, 6);
    expect(matched[1].score).toBeGreaterThan(0.2);
  });

  it("carries the theme size for ordering context", () => {
    const matched = matchProjectThemes([{ embedding: [1, 0] }], themes);
    expect(matched[0].size).toBe(10);
  });

  it("refuses a degenerate project centroid rather than ranking noise", () => {
    expect(briefCentroid([[1, 0], [-1, 0]])).toBeNull();
    expect(matchProjectThemes([{ embedding: [1, 0] }, { embedding: [-1, 0] }], themes)).toEqual([]);
  });

  it("refuses a theme whose centroid has no direction", () => {
    const matched = matchProjectThemes([{ embedding: [1, 0] }], [
      { themeId: "t.zero", label: "Zero", size: 1, centroid: [0, 0] },
    ]);
    expect(matched).toEqual([]);
  });

  it("skips notes without an embedding and returns nothing when none have one", () => {
    expect(matchProjectThemes([{ embedding: null }], themes)).toEqual([]);
    expect(matchProjectThemes([], themes)).toEqual([]);
  });

  it("breaks a tie on size, then themeId, and caps the list", () => {
    const tied = [
      { themeId: "t.b", label: "B", size: 1, centroid: [1, 0] },
      { themeId: "t.a", label: "A", size: 5, centroid: [1, 0] },
      { themeId: "t.c", label: "C", size: 5, centroid: [1, 0] },
    ];
    const matched = matchProjectThemes([{ embedding: [1, 0] }], tied, { max: 2 });
    // Same score: size 5 before size 1, and the two 5s by id.
    expect(matched.map((t) => t.themeId)).toEqual(["t.a", "t.c"]);
  });

  it("caps at BRIEF_MAX_THEMES by default", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      themeId: `t${String(i).padStart(2, "0")}`,
      label: `T${i}`,
      size: 1,
      centroid: [1, 0],
    }));
    expect(matchProjectThemes([{ embedding: [1, 0] }], many)).toHaveLength(BRIEF_MAX_THEMES);
  });
});

describe("renderBriefSynthesisInput — deterministic, body-free DATA", () => {
  it("carries the project's facts and its counts", () => {
    const input = assemble({
      notes: [note("n1", { title: "Kickoff chat", date: "2026-09-20", contentLength: 4200, updatedAt: NOW, embedding: [1, 0] })],
      subProjects: [{ id: "s1", name: "Sub Alpha", lifecycleState: "active" }],
      themes: [{ themeId: "t1", label: "Agents", size: 12, centroid: [1, 0] }],
      project: { ...source().project, livingDoc: "The living document." },
    })!;
    const block = renderBriefSynthesisInput(input);
    expect(block).toContain("Project: Project Alpha");
    expect(block).toContain("Lifecycle: active");
    expect(block).toContain("[2026-09-20] Kickoff chat (4200 chars");
    expect(block).toContain("Sub Alpha (active)");
    expect(block).toContain("Agents (size 12; similarity 1.000)");
    expect(block).toContain("The living document.");
  });

  it("says (none) for every empty section instead of omitting it", () => {
    const block = renderBriefSynthesisInput(assemble()!);
    expect(block).toContain("Notes (most recently updated first; showing 0 of 0):\n- (none)");
    expect(block).toContain("Sub-projects: 0 live (showing 0)\n- (none)");
    expect(block).toContain("Themes matched by embedding similarity: 0 of 0\n- (none)");
  });

  it("is byte-identical across calls", () => {
    const rows = { notes: [note("n1", { updatedAt: NOW })] };
    expect(renderBriefSynthesisInput(assemble(rows)!)).toBe(
      renderBriefSynthesisInput(assemble(rows)!),
    );
  });
});

describe("renderFallbackBrief — labelled, and every reason has copy", () => {
  it("labels every fallback reason and never presents itself as a synthesis", () => {
    const input = assemble()!;
    for (const reason of BRIEF_FALLBACK_REASONS) {
      const markdown = renderFallbackBrief(input, reason);
      expect(markdown).toContain(BRIEF_FALLBACK_LABEL);
      expect(markdown).toContain(BRIEF_FALLBACK_TEXT[reason]);
    }
  });

  it("renders the digest from the project's own data", () => {
    const input = assemble({
      notes: [note("n1", { title: "Kickoff", date: "2026-09-20", updatedAt: NOW })],
    })!;
    const markdown = renderFallbackBrief(input, "model_failed");
    expect(markdown).toContain("## Current state");
    expect(markdown).toContain("- Lifecycle: active");
    expect(markdown).toContain("- Kickoff (2026-09-20)");
    expect(markdown).toContain("## Open questions");
  });
});

describe("sanitizeBriefMarkdown — constrain model output before it is displayed", () => {
  it("trims and unwraps a single surrounding code fence", () => {
    expect(sanitizeBriefMarkdown("```markdown\n# Title\n\nBody\n```")).toBe("# Title\n\nBody");
  });

  it("returns null for anything unusable", () => {
    expect(sanitizeBriefMarkdown("")).toBeNull();
    expect(sanitizeBriefMarkdown("   \n  ")).toBeNull();
    expect(sanitizeBriefMarkdown(null)).toBeNull();
    expect(sanitizeBriefMarkdown(42)).toBeNull();
  });

  it("caps a runaway response at the ceiling", () => {
    const out = sanitizeBriefMarkdown("x".repeat(50_000));
    expect(out).not.toBeNull();
    expect([...out!].length).toBeLessThanOrEqual(20_003);
    expect(out!.endsWith("…")).toBe(true);
  });
});

describe("compareBriefNotes / briefSummary", () => {
  it("is a total comparator (never returns undefined, always well-defined for equal keys)", () => {
    const a = note("a");
    const b = note("b");
    expect(compareBriefNotes(a, b)).toBeLessThan(0);
    expect(compareBriefNotes(b, a)).toBeGreaterThan(0);
    expect(compareBriefNotes(a, a)).toBe(0);
  });

  it("summarises the counts the API returns", () => {
    const input = assemble({
      notes: [note("n1", { deletedAt: new Date() }), note("n2", { embedding: [1, 0] })],
      themes: [{ themeId: "t1", label: "Agents", size: 1, centroid: [1, 0] }],
    })!;
    expect(briefSummary(input)).toEqual({
      notesTotal: 1,
      notesShown: 1,
      notesHiddenDeleted: 1,
      subProjectsTotal: 0,
      themes: ["Agents"],
      livingDocChars: 0,
    });
  });
});
