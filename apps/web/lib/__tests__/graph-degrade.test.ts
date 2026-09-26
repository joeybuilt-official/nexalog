// SPDX-License-Identifier: MIT
// Garden polish: the graph degradation ladder — the route's answer-selection
// logic, extracted to lib/ so the layering stays inward-only and the ladder is
// testable without a running Next server or a live MCP endpoint.
import { describe, it, expect } from "vitest";

import { resolveGraphPayload, type GbrainOutcome, type LocalOutcome } from "@/lib/graph/degrade";

const GBRAIN_NODES = [{ slug: "concepts/litellm-gateway", title: "LiteLLM Gateway", type: "concept" }];
const LOCAL: LocalOutcome = {
  nodes: [
    { slug: "people/example-person", title: "Example Person", type: "person" },
    { slug: "companies/joeybuilt", title: "Joeybuilt", type: "company" },
  ],
  edges: [
    { from: "people/example-person", to: "companies/joeybuilt", linkType: "wikilink", context: null },
  ],
  pagesScanned: 3,
  truncated: false,
};

const EMPTY_LOCAL: LocalOutcome = { nodes: [], edges: [], pagesScanned: 0, truncated: false };

function resolve(gbrain: GbrainOutcome, local: LocalOutcome = LOCAL) {
  return resolveGraphPayload({ gbrain, local, root: null, depth: 2 });
}

describe("resolveGraphPayload", () => {
  it("prefers GBrain and reports the graph as not degraded", () => {
    const payload = resolve({ status: "ok", nodes: GBRAIN_NODES, edges: [] });
    expect(payload.source).toBe("gbrain");
    expect(payload.degraded).toBe(false);
    expect(payload.nodes).toEqual(GBRAIN_NODES);
    expect(payload.note).toBeUndefined();
  });

  it("falls to the local graph when GBrain is unconfigured, naming the reason", () => {
    const payload = resolve({ status: "unconfigured" });
    expect(payload.source).toBe("local");
    expect(payload.degraded).toBe(true);
    expect(payload.ok).toBe(true);
    expect(payload.nodes).toHaveLength(2);
    expect(payload.note).toMatch(/not configured/);
    expect(payload.note).toMatch(/3 pages scanned/);
  });

  it("falls to the local graph when GBrain is unreachable — still a 200-shaped payload", () => {
    const payload = resolve({ status: "unreachable" });
    expect(payload.ok).toBe(true);
    expect(payload.source).toBe("local");
    expect(payload.note).toMatch(/unreachable/);
    // The note tells the reader the limits of a fallback graph.
    expect(payload.note).toMatch(/explicit links only/);
  });

  it("falls to the local graph when GBrain answers with an empty graph", () => {
    const payload = resolve({ status: "empty" });
    expect(payload.source).toBe("local");
    expect(payload.note).toMatch(/no links/);
  });

  it("treats an ok-but-empty GBrain graph as degraded, never as success", () => {
    const payload = resolve({ status: "ok", nodes: [], edges: [] });
    expect(payload.source).toBe("local");
    expect(payload.degraded).toBe(true);
  });

  it("reports source:none (with a reason) only when there is nothing at all", () => {
    for (const status of ["unconfigured", "unreachable", "empty", "ok"] as GbrainOutcome["status"][]) {
      const gbrain: GbrainOutcome = status === "ok" ? { status: "ok", nodes: [], edges: [] } : { status };
      const payload = resolve(gbrain, EMPTY_LOCAL);
      expect(payload.source).toBe("none");
      expect(payload.nodes).toEqual([]);
      expect(payload.note).toBeTruthy();
    }
  });

  it("passes the root, depth, and truncation through to the payload", () => {
    const payload = resolveGraphPayload({
      gbrain: { status: "unconfigured" },
      local: { ...LOCAL, truncated: true },
      root: "people/example-person",
      depth: 3,
    });
    expect(payload.root).toBe("people/example-person");
    expect(payload.depth).toBe(3);
    expect(payload.truncated).toBe(true);
  });

  it("omits the truncation flag when the local walk was complete", () => {
    expect(resolve({ status: "unconfigured" }).truncated).toBeUndefined();
  });
});
