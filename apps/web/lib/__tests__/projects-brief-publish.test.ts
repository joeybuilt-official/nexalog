// SPDX-License-Identifier: MIT
/**
 * The web-side PUBLISH rules — where a project is addressed in the brain, and
 * what route a published row links to.
 *
 * WHAT THIS PINS, AND WHY EACH ONE MATTERS
 * ----------------------------------------
 *   - **Every address is deterministic and VALID.** The same project always
 *     resolves to the same slug, and the result always passes the app's own slug
 *     charset — a proposal addressed to `projects/` would resolve to no page at
 *     all, which is the silent-loss failure mode this feature exists to avoid.
 *   - **A sub-project is addressed FLAT** (`projects/<parent>--<child>`), because
 *     the brain's slug vocabulary is flat and every wire consumer here treats the
 *     part after the prefix as one segment.
 *   - **A project nobody can name still gets a stable address** — the id-derived
 *     fallback — rather than an empty or invalid one.
 *   - **The href STRIPS the `projects/` prefix.** The in-app route already
 *     carries it, so appending it again is the defect that produces a 404 no test
 *     would catch.
 *   - **A page is picked by NAME MATCH, never by the best cosine.** The live index
 *     returns the whole project directory as a neighborhood, so a high-cosine
 *     neighbor is the wrong page to publish a brief onto.
 *
 * Pure: no React, no database, no network.
 */

import { describe, it, expect } from "vitest";

import {
  BRIEF_PUBLISH_EVIDENCE_NOTE_TITLES,
  briefPostBody,
  idSegment,
  isMintableSlugSegment,
  isSlugComparable,
  pickProjectPage,
  projectPageHref,
  projectPageSlug,
  projectSlugSegment,
} from "@/lib/projects/publish";

const PROJECT_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

describe("projectSlugSegment — the app mints a valid slug or nothing", () => {
  it("folds a human name into the slug charset", () => {
    expect(projectSlugSegment("Project Alpha")).toBe("project-alpha");
    expect(projectSlugSegment("  Fylo  ")).toBe("fylo");
    expect(projectSlugSegment("Ángel // Release Manager")).toBe("angel-release-manager");
  });

  it("returns null rather than an invalid or empty segment", () => {
    expect(projectSlugSegment("")).toBeNull();
    expect(projectSlugSegment(null)).toBeNull();
    expect(projectSlugSegment("日本語")).toBeNull();
    expect(projectSlugSegment("!!!")).toBeNull();
  });

  it("every segment it mints passes the charset it claims to honour", () => {
    for (const name of ["Project Alpha", "a b c", "MiXeD CaSe", "x--y", "  padded  "]) {
      const segment = projectSlugSegment(name);
      expect(segment).not.toBeNull();
      expect(isMintableSlugSegment(segment!)).toBe(true);
    }
  });
});

describe("projectPageSlug — one deterministic address per project", () => {
  it("addresses a root project as projects/<slug>", () => {
    expect(projectPageSlug({ id: PROJECT_ID, name: "Project Alpha" })).toBe(
      "projects/project-alpha",
    );
  });

  it("addresses a sub-project FLAT under its parent's name", () => {
    expect(
      projectPageSlug({ id: PROJECT_ID, name: "Distribution", parentName: "Angel Studios" }),
    ).toBe("projects/angel-studios--distribution");
    // One segment, never a nested path.
    expect(projectPageSlug({ id: PROJECT_ID, name: "Distribution", parentName: "Angel" })).not.toContain(
      "projects/angel/",
    );
  });

  it("falls back to the project id when the name mints nothing", () => {
    const slug = projectPageSlug({ id: PROJECT_ID, name: "日本語" });
    expect(slug).toBe(`projects/${idSegment(PROJECT_ID)}`);
    expect(slug).toBe("projects/project-7c9e66797425");
  });

  it("prefers a recorded slug, with or without the prefix", () => {
    expect(projectPageSlug({ id: PROJECT_ID, name: "X", slug: "projects/recorded" })).toBe(
      "projects/recorded",
    );
    expect(projectPageSlug({ id: PROJECT_ID, name: "X", slug: "recorded" })).toBe(
      "projects/recorded",
    );
    expect(projectPageSlug({ id: PROJECT_ID, name: "X", slug: "  " })).toBe("projects/x");
  });

  it("is deterministic — the same project always gets the same address", () => {
    const input = { id: PROJECT_ID, name: "Project Alpha", parentName: "Root" };
    expect(projectPageSlug(input)).toBe(projectPageSlug(input));
  });

  it("always produces a slug under the projects/ prefix with a non-empty tail", () => {
    for (const input of [
      { id: PROJECT_ID, name: "Alpha" },
      { id: PROJECT_ID, name: "日本語" },
      { id: PROJECT_ID, name: "", parentName: "" },
      { id: "", name: "" },
    ]) {
      const slug = projectPageSlug(input);
      expect(slug.startsWith("projects/")).toBe(true);
      expect(slug.length).toBeGreaterThan("projects/".length);
    }
  });
});

describe("isSlugComparable — a slug match is an optimization, not a guess", () => {
  it("accepts ASCII-ish display strings and refuses the rest", () => {
    expect(isSlugComparable("Project Alpha")).toBe(true);
    expect(isSlugComparable("  ")).toBe(false);
    expect(isSlugComparable(null)).toBe(false);
    expect(isSlugComparable("日本語")).toBe(false);
  });
});

describe("pickProjectPage — name match first, cosine never invents one", () => {
  const project = { id: PROJECT_ID, name: "Project Alpha" };

  it("prefers a page whose slug IS the project's name, over a higher-cosine neighbor", () => {
    const chosen = pickProjectPage(project, [
      { slug: "projects/panoply", type: "project", cosine: 0.91 },
      { slug: "projects/project-alpha", type: "project", cosine: 0.4 },
    ]);
    expect(chosen).toBe("projects/project-alpha");
  });

  it("accepts an id-addressed page as an exact match", () => {
    const chosen = pickProjectPage(project, [
      { slug: `projects/${idSegment(PROJECT_ID)}`, type: "project", cosine: null },
    ]);
    expect(chosen).toBe(`projects/${idSegment(PROJECT_ID)}`);
  });

  it("falls back to the best project-type cosine when no name matches", () => {
    const chosen = pickProjectPage(project, [
      { slug: "projects/panoply", type: "project", cosine: 0.4 },
      { slug: "projects/fylo", type: "project", cosine: 0.8 },
      { slug: "concepts/agents", type: "concept", cosine: 0.99 },
    ]);
    expect(chosen).toBe("projects/fylo");
  });

  it("returns null when nothing is a project page or nothing reports a cosine", () => {
    expect(pickProjectPage(project, [{ slug: "concepts/agents", cosine: 0.9 }])).toBeNull();
    expect(pickProjectPage(project, [{ slug: "projects/panoply", type: "project" }])).toBeNull();
    expect(pickProjectPage(project, [])).toBeNull();
  });

  it("breaks a cosine tie on the slug, so the answer never depends on hit order", () => {
    const forward = pickProjectPage(project, [
      { slug: "projects/b", type: "project", cosine: 0.7 },
      { slug: "projects/a", type: "project", cosine: 0.7 },
    ]);
    const reverse = pickProjectPage(project, [
      { slug: "projects/a", type: "project", cosine: 0.7 },
      { slug: "projects/b", type: "project", cosine: 0.7 },
    ]);
    expect(forward).toBe("projects/a");
    expect(reverse).toBe("projects/a");
  });
});

describe("projectPageHref — the prefix is stripped, never doubled", () => {
  it("strips the brain prefix, because the app route already carries it", () => {
    expect(projectPageHref("projects/project-alpha")).toBe("/app/projects/project-alpha");
    expect(projectPageHref("project-alpha")).toBe("/app/projects/project-alpha");
  });

  it("encodes each segment and drops a trailing slash", () => {
    expect(projectPageHref("projects/angel-studios--distribution/")).toBe(
      "/app/projects/angel-studios--distribution",
    );
    expect(projectPageHref("projects/two/parts")).toBe("/app/projects/two/parts");
  });

  it("returns null rather than a link into nowhere", () => {
    expect(projectPageHref("")).toBeNull();
    expect(projectPageHref("projects/")).toBeNull();
    expect(projectPageHref("projects")).toBeNull();
  });
});

describe("the publish request body", () => {
  it("accepts the two intents and rejects anything else", () => {
    expect(briefPostBody.safeParse({ intent: "publish" }).success).toBe(true);
    expect(briefPostBody.safeParse({ intent: "regenerate" }).success).toBe(true);
    expect(briefPostBody.safeParse({}).success).toBe(true);
    expect(briefPostBody.safeParse({ intent: "publsh" }).success).toBe(false);
    expect(briefPostBody.safeParse({ intent: "publish", extra: 1 }).success).toBe(false);
  });

  it("bounds the optional source id", () => {
    expect(briefPostBody.safeParse({ intent: "publish", sourceId: "default" }).success).toBe(true);
    expect(briefPostBody.safeParse({ intent: "publish", sourceId: "" }).success).toBe(false);
  });
});

describe("the evidence bound", () => {
  it("is small enough that a queue card stays readable", () => {
    expect(BRIEF_PUBLISH_EVIDENCE_NOTE_TITLES).toBeGreaterThan(0);
    expect(BRIEF_PUBLISH_EVIDENCE_NOTE_TITLES).toBeLessThanOrEqual(20);
  });
});
