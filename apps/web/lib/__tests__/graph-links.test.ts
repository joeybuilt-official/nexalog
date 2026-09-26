// SPDX-License-Identifier: MIT
// Garden polish: the local (fallback) graph build — wikilinks + neighborhood.
import { describe, it, expect } from "vitest";

import {
  extractWikilinkTargets,
  neighborhoodSlice,
  normalizeWikilinkTarget,
} from "@/lib/graph/links";

describe("normalizeWikilinkTarget", () => {
  it("normalizes case, slashes, and a trailing .md", () => {
    expect(normalizeWikilinkTarget(" People/Example-Person ")).toBe("people/example-person");
    expect(normalizeWikilinkTarget("concepts/litellm-gateway.md")).toBe("concepts/litellm-gateway");
    expect(normalizeWikilinkTarget("./concepts//x")).toBeNull();
  });

  it("handles aliases and anchors", () => {
    expect(normalizeWikilinkTarget("concepts/litellm|the gateway")).toBe("concepts/litellm");
    expect(normalizeWikilinkTarget("concepts/litellm#why")).toBe("concepts/litellm");
  });

  it("turns a human-written title link into a slug candidate", () => {
    expect(normalizeWikilinkTarget("Example Person")).toBe("example-person");
  });

  it("rejects anything that cannot be a path segment", () => {
    expect(normalizeWikilinkTarget("")).toBeNull();
    expect(normalizeWikilinkTarget("   ")).toBeNull();
    expect(normalizeWikilinkTarget("concepts/../secrets")).toBeNull();
    expect(normalizeWikilinkTarget("a!b")).toBeNull();
  });
});

describe("extractWikilinkTargets", () => {
  it("extracts distinct targets in first-seen order", () => {
    const body = [
      "See [[people/example-person]] for the operator and",
      "[[companies/joeybuilt]] for the company. Again: [[people/example-person]].",
    ].join(" ");
    expect(extractWikilinkTargets(body)).toEqual([
      "people/example-person",
      "companies/joeybuilt",
    ]);
  });

  it("ignores wikilinks inside code fences and inline code", () => {
    const body = [
      "Real: [[concepts/litellm-gateway]].",
      "```md",
      "Example: [[projects/not-a-real-page]]",
      "```",
      "Inline: `[[projects/also-not-real]]`",
    ].join("\n");
    expect(extractWikilinkTargets(body)).toEqual(["concepts/litellm-gateway"]);
  });

  it("returns nothing for an empty body", () => {
    expect(extractWikilinkTargets("")).toEqual([]);
  });
});

describe("neighborhoodSlice", () => {
  const known = ["a", "b", "c", "d", "lonely"];
  const links = [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "c", to: "d" },
  ];

  it("returns the whole graph when there is no root", () => {
    expect(neighborhoodSlice(known, links, null, 1)).toEqual(new Set(known));
  });

  it("returns the whole graph when the root is not a known page", () => {
    expect(neighborhoodSlice(known, links, "ghost", 2)).toEqual(new Set(known));
  });

  it("narrows to the given hop depth, both directions", () => {
    expect(neighborhoodSlice(known, links, "b", 1)).toEqual(new Set(["b", "a", "c"]));
    expect(neighborhoodSlice(known, links, "b", 2)).toEqual(new Set(["b", "a", "c", "d"]));
    // depth is counted from the root, so a deeper walk reaches everything linked
    expect(neighborhoodSlice(known, links, "d", 1)).toEqual(new Set(["d", "c"]));
  });

  it("always includes the root and never loops on cycles", () => {
    const cyclic = [
      { from: "a", to: "b" },
      { from: "b", to: "a" },
    ];
    expect(neighborhoodSlice(["a", "b"], cyclic, "a", 5)).toEqual(new Set(["a", "b"]));
  });

  it("treats a zero/negative depth as the root alone", () => {
    expect(neighborhoodSlice(known, links, "a", 0)).toEqual(new Set(["a"]));
    expect(neighborhoodSlice(known, links, "a", -1)).toEqual(new Set(["a"]));
  });

  it("ignores links whose endpoints are not known pages", () => {
    const dangling = [{ from: "a", to: "ghost" }];
    expect(neighborhoodSlice(["a", "b"], dangling, "a", 3)).toEqual(new Set(["a"]));
  });
});
