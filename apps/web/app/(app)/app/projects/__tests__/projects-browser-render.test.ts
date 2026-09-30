// SPDX-License-Identifier: MIT
/**
 * The projects browser's ROW rendering — the one part of the browse feature that
 * is not pure logic, and therefore the only part the pure module's tests cannot
 * reach.
 *
 * What this pins, and why each of them is a real regression:
 *   - the description is rendered under the name (all 38 projects now carry one,
 *     so a row that drops it is throwing away the most informative field);
 *   - the "Summary" indicator appears exactly when `livingDocUpdatedAt` is set —
 *     the badge means the project HAS a living document, so rendering it for a
 *     project without one would make the signal worthless;
 *   - the counts and lifecycle badge survive (no regression of the existing row);
 *   - a sub-project renders as an indented row inside its parent group, and the
 *     root gets a disclosure control;
 *   - the control lists are DERIVED — every lifecycle state the domain declares
 *     and every sort key is offered, so the UI cannot drift from the domain.
 *
 * The default (unfiltered) state is what `renderToStaticMarkup` produces; the
 * filtered paths — including the A1.7 "child survives its parent's filter"
 * invariant — live in `@/lib/projects/browse` and are asserted there against the
 * pure function, which is where the rule actually is. Rendering a filtered state
 * here would only re-prove the DOM, not the rule.
 *
 * Written as a `.ts` spec with `createElement`: vitest collects `*.test.ts` only,
 * so a `.tsx` render spec would silently never run. Co-located with the surface
 * it renders (not under `lib/`) so it can import app/ without crossing the
 * `web-lib-no-ui` architecture rule.
 */

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LIFECYCLE_FILTERS, PROJECT_SORTS, PROJECT_SORT_LABELS } from "@/lib/projects/browse";
import { LIFECYCLE_STATES } from "@/lib/projects/domain";
import { ProjectsBrowser } from "../projects-browser";

const PROJECTS = [
  {
    id: "p1",
    name: "Full-On Pictures",
    description: "Influencer CRM for creator relationships — rebranded to Lightcast.",
    lifecycleState: "active" as const,
    livingDocUpdatedAt: new Date("2026-09-20T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-20T00:00:00.000Z"),
    parentId: null,
    itemCount: 4,
    subProjectCount: 1,
  },
  {
    id: "p2",
    name: "Learning Curve",
    description: "Tutorial pipeline.",
    lifecycleState: "draft" as const,
    livingDocUpdatedAt: null,
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
    updatedAt: new Date("2026-02-01T00:00:00.000Z"),
    parentId: "p1",
    itemCount: 0,
    subProjectCount: 0,
  },
];

function html(): string {
  return renderToStaticMarkup(createElement(ProjectsBrowser, { projects: PROJECTS }));
}

describe("ProjectsBrowser — rendered rows", () => {
  it("renders each project's description under its name", () => {
    const markup = html();
    expect(markup).toContain("Full-On Pictures");
    expect(markup).toContain("Influencer CRM for creator relationships");
    expect(markup).toContain("Tutorial pipeline.");
  });

  it("shows the Summary indicator only for a project that has a living document", () => {
    const markup = html();
    const rows = markup.split('data-project-row=').slice(1);
    const withDoc = rows.find((row) => row.startsWith('"p1"'))!;
    const withoutDoc = rows.find((row) => row.startsWith('"p2"'))!;
    expect(withDoc).toContain("Summary");
    expect(withoutDoc).not.toContain("Summary");
  });

  it("keeps the item count, the sub-project count and the lifecycle badge", () => {
    const markup = html();
    expect(markup).toContain("4 items");
    expect(markup).toContain("1 sub");
    expect(markup).toContain(">active<");
    expect(markup).toContain(">draft<");
  });

  it("renders a sub-project as a row inside its parent's group, with a disclosure on the root", () => {
    const markup = html();
    expect(markup).toContain('data-disclosure="p1"');
    expect(markup).toContain('data-project-row="p2"');
    // A child gets no disclosure of its own — the tree is two levels, full stop.
    expect(markup).not.toContain('data-disclosure="p2"');
  });

  it("offers every lifecycle state the domain declares, plus `all`", () => {
    const markup = html();
    for (const filter of LIFECYCLE_FILTERS) {
      expect(markup).toContain(`value="${filter}"`);
    }
    // The control is derived from LIFECYCLE_STATES — a hardcoded list would miss
    // a value added to the domain and this catches that.
    expect(LIFECYCLE_FILTERS).toEqual(["all", ...LIFECYCLE_STATES]);
  });

  it("offers every sort key, labelled", () => {
    const markup = html();
    for (const sort of PROJECT_SORTS) {
      expect(markup).toContain(`value="${sort}"`);
      expect(markup).toContain(PROJECT_SORT_LABELS[sort]);
    }
  });

  it("reports the match count against the whole list", () => {
    expect(html()).toContain('data-project-match-count="2"');
  });
});
