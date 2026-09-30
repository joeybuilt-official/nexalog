// SPDX-License-Identifier: MIT
/**
 * The SUB-PROJECT controls' rendering — the part of this feature that is not
 * pure logic and therefore cannot be reached by the domain module's tests.
 *
 * What this pins, and why each is a real regression:
 *   - the create form offers a parent picker whose options are the ROOTS only,
 *     fed by the DOMAIN's `parentCandidates` (so it cannot drift from the guard
 *     and offer a nesting the server will refuse);
 *   - it offers no picker at all when there is no valid parent — a select with a
 *     single "no parent" option is a control that does nothing;
 *   - the re-parent control is present with its move/promote affordances for a
 *     project that can move, and is REPLACED BY AN EXPLANATION for one that
 *     cannot, rather than being shown disabled or 400ing on the obvious choice;
 *   - the control's options carry the projects' own names, so a reader can tell
 *     "10 Ton" from "Full-On Pictures" before clicking.
 *
 * Written as a `.ts` spec with `createElement`: vitest collects `*.test.ts` only,
 * so a `.tsx` render spec would silently never run (the gate would stay green over
 * an untested surface). Co-located with the surfaces it renders (not under `lib/`)
 * so it can import `app/` without crossing `web-lib-no-ui`.
 */

import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// These are client components; `useRouter` is the one hook whose real
// implementation needs a Next.js request context that a static render has not
// got. Stubbing it here is stubbing the FRAMEWORK, not the code under test —
// state, markup and the domain calls all still run for real.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { NewProjectForm } from "../new-project-form";
import { ReparentControl } from "../[id]/reparent-control";

const PROJECTS = [
  { id: "p1", name: "10 Ton", parentId: null },
  { id: "p2", name: "Full-On Pictures", parentId: null },
  { id: "p3", name: "Frame Forge", parentId: "p1" },
];

describe("NewProjectForm — the create-as-sub-project picker", () => {
  it("offers the root projects as parents, and never a project that is itself a sub-project", () => {
    const markup = renderToStaticMarkup(
      createElement(NewProjectForm, { workspaceId: "ws-1", projects: PROJECTS }),
    );

    expect(markup).toContain('id="project-parent"');
    expect(markup).toContain("10 Ton");
    expect(markup).toContain("Full-On Pictures");
    // Frame Forge is already a sub-project: nesting under it would be three
    // levels, so the domain rule removes it and the control must not offer it.
    expect(markup).not.toContain("Frame Forge");
  });

  it("always offers the no-parent option, so a root is the default", () => {
    const markup = renderToStaticMarkup(
      createElement(NewProjectForm, { workspaceId: "ws-1", projects: PROJECTS }),
    );

    expect(markup).toContain("No parent");
  });

  it("renders NO picker when no project can be a parent — an empty control is worse than none", () => {
    const markup = renderToStaticMarkup(
      createElement(NewProjectForm, { workspaceId: "ws-1", projects: [] }),
    );

    expect(markup).not.toContain('id="project-parent"');
    // The rest of the form is unaffected: creation as a root still works.
    expect(markup).toContain('id="project-name"');
    expect(markup).toContain("New Project");
  });

  it("hides the picker when every visible project is already nested", () => {
    const markup = renderToStaticMarkup(
      createElement(NewProjectForm, {
        workspaceId: "ws-1",
        projects: [{ id: "only", name: "Learning Curve", parentId: "elsewhere" }],
      }),
    );

    expect(markup).not.toContain('id="project-parent"');
    expect(markup).not.toContain("Learning Curve");
  });
});

describe("ReparentControl — the move / promote verb", () => {
  it("renders the picker with the root projects and a promote affordance for a nested project", () => {
    const markup = renderToStaticMarkup(
      createElement(ReparentControl, {
        projectId: "p3",
        currentParentId: "p1",
        subProjectCount: 0,
        projects: PROJECTS,
      }),
    );

    expect(markup).toContain("data-reparent-select");
    expect(markup).toContain("10 Ton");
    expect(markup).toContain("Full-On Pictures");
    // A nested project can be lifted back to the top level — the "promote" half
    // of the verb, which is the only way out of a wrong nesting.
    expect(markup).toContain("data-reparent-promote");
    expect(markup).toContain("Promote to top level");
  });

  it("never offers the project itself as its own parent", () => {
    const markup = renderToStaticMarkup(
      createElement(ReparentControl, {
        projectId: "p1",
        currentParentId: null,
        subProjectCount: 0,
        projects: PROJECTS,
      }),
    );

    // "10 Ton" is the project being moved, so only the OTHER root is offered.
    expect(markup).toContain("Full-On Pictures");
    const options = markup.split("<option").filter((o) => o.includes("10 Ton"));
    expect(options).toHaveLength(0);
  });

  it("shows no promote control for a project that is already a root", () => {
    const markup = renderToStaticMarkup(
      createElement(ReparentControl, {
        projectId: "p1",
        currentParentId: null,
        subProjectCount: 0,
        projects: PROJECTS,
      }),
    );

    expect(markup).not.toContain("data-reparent-promote");
    expect(markup).toContain("data-reparent-select");
  });

  it("explains instead of offering the move when the project HAS sub-projects", () => {
    const markup = renderToStaticMarkup(
      createElement(ReparentControl, {
        projectId: "p1",
        currentParentId: null,
        subProjectCount: 2,
        projects: PROJECTS,
      }),
    );

    // No picker: the guard would refuse (`child_is_parent`), so the screen says
    // why rather than showing a control that cannot succeed.
    expect(markup).not.toContain("data-reparent-select");
    expect(markup).toContain("cannot become a sub-project");
  });
});
