// SPDX-License-Identifier: MIT
/**
 * describeProposal — the one place that knows the worker's `nexalog.proposal`
 * block is untrusted. Covers every shape observed in the brain repo plus the
 * malformed cases that must degrade instead of throwing.
 */

import { describe, it, expect } from "vitest";
import { describeProposal } from "@/lib/captures/proposal";

describe("describeProposal", () => {
  it("returns an empty, renderable view for null/garbage", () => {
    for (const input of [null, undefined, "nope", 42, [], true]) {
      const view = describeProposal(input);
      expect(view.hasContent).toBe(false);
      expect(view.pages).toEqual([]);
      expect(view.links).toEqual([]);
      expect(view.summary).toBeNull();
      expect(view.confidence).toBeNull();
    }
  });

  it("normalizes string page paths (the shape the skill writes) into links", () => {
    const view = describeProposal({
      pages: ["people/jane-doe", "concepts/foo"],
      links: [],
      summary: "Extracted 1 person, 1 concept",
    });

    expect(view.hasContent).toBe(true);
    expect(view.summary).toBe("Extracted 1 person, 1 concept");
    expect(view.pages.map((p) => p.slug)).toEqual(["people/jane-doe", "concepts/foo"]);
    expect(view.pages[0]).toMatchObject({
      label: "Jane Doe",
      dir: "people",
      type: "person",
      typeLabel: "Person",
      href: "/app/graph?slug=people%2Fjane-doe",
    });
    expect(view.pages[1]).toMatchObject({ type: "concept", typeLabel: "Concept" });
  });

  it("normalizes the core contract shape (slug/type/title objects)", () => {
    const view = describeProposal({
      pages: [{ slug: "people/jane-doe", type: "person", title: "Jane Doe" }],
      links: [],
      confidence: 0.42,
    });
    expect(view.pages[0]).toMatchObject({
      slug: "people/jane-doe",
      label: "Jane Doe",
      type: "person",
      href: "/app/graph?slug=people%2Fjane-doe",
    });
    expect(view.confidence).toBe(0.42);
  });

  it("accepts links as pairs, as flattened pairs, and as {from,to}", () => {
    const links = [
      ["people/jane-doe", "companies/acme"],
      "people/jane-doe,companies/acme",
      { from: "people/jane-doe", to: "concepts/foo" },
    ];
    const view = describeProposal({ pages: [], links });
    expect(view.links).toHaveLength(3);
    expect(view.links[0].from.slug).toBe("people/jane-doe");
    expect(view.links[0].to.slug).toBe("companies/acme");
    expect(view.links[2].to.slug).toBe("concepts/foo");
    // Link endpoints resolve to linkable pages too.
    expect(view.links[0].to.href).toBe("/app/graph?slug=companies%2Facme");
  });

  it("drops unusable page and link entries instead of rendering dead links", () => {
    const view = describeProposal({
      pages: ["people/jane-doe", "", "  ", "has space", "foo/../bar", 7, { nope: 1 }],
      links: [["people/jane-doe"], "no-comma", { from: "people/jane-doe" }, []],
    });
    expect(view.pages.map((p) => p.slug)).toEqual(["people/jane-doe"]);
    expect(view.links).toEqual([]);
  });

  it("dedupes repeated page paths", () => {
    const view = describeProposal({
      pages: ["people/jane-doe", "people/jane-doe", { slug: "people/jane-doe" }],
    });
    expect(view.pages).toHaveLength(1);
  });

  it("strips a .md suffix and normalizes case, keeping the link target a real slug", () => {
    const view = describeProposal({ pages: ["People/Jane-Doe.md"] });
    expect(view.pages[0].slug).toBe("people/jane-doe");
  });

  it("clamps confidence into 0..1 and ignores non-numeric values", () => {
    expect(describeProposal({ confidence: 1.7 }).confidence).toBe(1);
    expect(describeProposal({ confidence: -3 }).confidence).toBe(0);
    expect(describeProposal({ confidence: "0.9" }).confidence).toBeNull();
    expect(describeProposal({ confidence: Number.NaN }).confidence).toBeNull();
  });

  it("labels atom pages as Atom, not Concept, even though both render as concept nodes", () => {
    const view = describeProposal({ pages: ["atoms/2026-09-25/healthcheck-lesson"] });
    expect(view.pages[0]).toMatchObject({
      type: "concept",
      typeLabel: "Atom",
      label: "Healthcheck Lesson",
    });
  });

  it("handles bare single-segment slugs, which have no directory to type", () => {
    const view = describeProposal({ pages: ["orphan-page"] });
    expect(view.pages[0]).toMatchObject({
      slug: "orphan-page",
      dir: "",
      type: null,
      typeLabel: null,
      label: "Orphan Page",
    });
  });

  it("counts links alone as content so a links-only block still renders", () => {
    const view = describeProposal({ links: [["people/a", "companies/b"]] });
    expect(view.hasContent).toBe(true);
    expect(view.pages).toEqual([]);
  });
});
