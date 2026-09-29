// SPDX-License-Identifier: MIT
// Garden polish: whole-brain graph seeds are DERIVED from live pages, not
// hardcoded. The bug this pins: the old DEFAULT_SEEDS list named
// `people/example-person` — the repo's placeholder convention, not a page that
// exists in a real brain — and `traverse_graph` on a missing slug answers `[]`,
// so that seed silently contributed nothing.
import { describe, it, expect } from "vitest";

import {
  GRAPH_SEED_TYPES,
  MAX_GRAPH_SEEDS,
  selectGraphSeeds,
  type GraphSeedCandidate,
} from "@/lib/graph/seeds";

function row(slug: string): GraphSeedCandidate {
  return { slug, title: slug.split("/").pop() ?? slug, type: slug.split("/")[0] ?? "", updatedAt: null };
}

describe("selectGraphSeeds", () => {
  it("derives seeds from live pages instead of a hardcoded list", () => {
    const seeds = selectGraphSeeds({
      projects: [row("projects/fylo")],
      companies: [row("companies/acme")],
    });
    expect(seeds).toEqual(["projects/fylo", "companies/acme"]);
  });

  it("never invents a slug that was not in the input", () => {
    const seeds = selectGraphSeeds({ people: [row("people/alice")] });
    // The retired placeholder must not reappear by any path.
    expect(seeds).not.toContain("people/example-person");
    expect(seeds).toEqual(["people/alice"]);
  });

  it("round-robins across types so one busy type cannot crowd out the rest", () => {
    const projects = Array.from({ length: 10 }, (_, i) => row(`projects/p${i}`));
    const seeds = selectGraphSeeds(
      { projects, companies: [row("companies/acme")], people: [row("people/alice")] },
      4,
    );
    // One project, then the other two types, then a second project.
    expect(seeds[0]).toBe("projects/p0");
    expect(seeds).toContain("companies/acme");
    expect(seeds).toContain("people/alice");
    expect(seeds).toHaveLength(4);
  });

  it("de-duplicates a slug listed under more than one bucket", () => {
    // A pack with subtypes can report one page under two groups; a repeated
    // seed would just re-walk the same neighborhood.
    const seeds = selectGraphSeeds({
      projects: [row("projects/fylo"), row("projects/fylo")],
      concepts: [row("projects/fylo")],
    });
    expect(seeds).toEqual(["projects/fylo"]);
  });

  it("returns nothing for an empty brain so the caller degrades down the ladder", () => {
    expect(selectGraphSeeds({})).toEqual([]);
    expect(selectGraphSeeds({ projects: [] })).toEqual([]);
  });

  it("respects the limit and the documented type set", () => {
    const many = Object.fromEntries(
      GRAPH_SEED_TYPES.map((t) => [t, [row(`${t}/a`), row(`${t}/b`), row(`${t}/c`)]]),
    ) as Record<(typeof GRAPH_SEED_TYPES)[number], GraphSeedCandidate[]>;
    const seeds = selectGraphSeeds(many);
    expect(seeds).toHaveLength(MAX_GRAPH_SEEDS);
    // Atoms are date-sharded leaf material and are deliberately not a seed type.
    expect(seeds.every((s) => !s.startsWith("atoms/"))).toBe(true);
  });
});
