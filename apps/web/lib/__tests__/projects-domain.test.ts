import { describe, it, expect } from "vitest";
import {
  canTransition,
  assertTransition,
  isLifecycleState,
  isItemKind,
  LIFECYCLE_STATES,
  ITEM_KINDS,
  MAX_PROJECT_DEPTH,
  canNestSubProject,
  nestingViolation,
  assertNestable,
  ProjectNestingError,
  groupUnitsByKind,
  type NestingCheck,
} from "@/lib/projects/domain";

describe("project lifecycle transitions", () => {
  it("allows draft -> active and draft -> archived", () => {
    expect(canTransition("draft", "active")).toBe(true);
    expect(canTransition("draft", "archived")).toBe(true);
  });

  it("allows active <-> draft and active -> archived", () => {
    expect(canTransition("active", "draft")).toBe(true);
    expect(canTransition("active", "archived")).toBe(true);
  });

  it("allows archived -> active but NOT archived -> draft", () => {
    expect(canTransition("archived", "active")).toBe(true);
    expect(canTransition("archived", "draft")).toBe(false);
  });

  it("treats same-state as a no-op (allowed)", () => {
    for (const s of LIFECYCLE_STATES) expect(canTransition(s, s)).toBe(true);
  });

  it("assertTransition throws a stable message on illegal moves", () => {
    expect(() => assertTransition("archived", "draft")).toThrowError(
      "Illegal lifecycle transition: archived -> draft",
    );
  });
});

describe("type guards", () => {
  it("isLifecycleState", () => {
    expect(isLifecycleState("active")).toBe(true);
    expect(isLifecycleState("deleted")).toBe(false);
    expect(isLifecycleState(42)).toBe(false);
  });

  it("isItemKind accepts the four reference kinds, including 'project'", () => {
    expect(isItemKind("note")).toBe(true);
    expect(isItemKind("bookmark")).toBe(true);
    expect(isItemKind("journal")).toBe(true);
    expect(isItemKind("project")).toBe(true);
    expect(isItemKind("idea")).toBe(false);
    expect(isItemKind(null)).toBe(false);
  });

  it("ITEM_KINDS is the single list both the schema type and the stores agree on", () => {
    expect([...ITEM_KINDS]).toEqual(["note", "bookmark", "journal", "project"]);
  });
});

// ---- sub-project nesting policy (one parent, two levels) -------------------

const nest = (over: Partial<NestingCheck> = {}): NestingCheck => ({
  childId: "child",
  parentId: "parent",
  childParentId: null,
  childSubProjectCount: 0,
  parentParentId: null,
  ...over,
});

describe("sub-project nesting policy", () => {
  it("allows nesting a root project under another root", () => {
    expect(canNestSubProject(nest())).toBe(true);
    expect(nestingViolation(nest())).toBeNull();
    expect(() => assertNestable(nest())).not.toThrow();
  });

  it("R1 — one parent: a project that already has a parent cannot gain another", () => {
    const check = nest({ childParentId: "someone-else" });
    expect(canNestSubProject(check)).toBe(false);
    expect(nestingViolation(check)?.code).toBe("already_has_parent");
  });

  it("R2 — two levels: a project with sub-projects cannot become a sub-project", () => {
    const check = nest({ childSubProjectCount: 2 });
    expect(nestingViolation(check)?.code).toBe("child_is_parent");
  });

  it("R2 — two levels: a project that is itself a sub-project cannot become a parent", () => {
    const check = nest({ parentParentId: "grandparent" });
    expect(nestingViolation(check)?.code).toBe("parent_is_child");
  });

  it("rejects a project nested under itself", () => {
    const check = nest({ childId: "same", parentId: "same" });
    expect(nestingViolation(check)?.code).toBe("self_nesting");
  });

  it("assertNestable throws a coded ProjectNestingError, so routes can branch on `code`", () => {
    try {
      assertNestable(nest({ childParentId: "p" }));
      throw new Error("assertNestable should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ProjectNestingError);
      expect((e as ProjectNestingError).code).toBe("already_has_parent");
      expect((e as ProjectNestingError).name).toBe("ProjectNestingError");
    }
  });

  it("reports the depth limit in the message, from the one constant", () => {
    expect(MAX_PROJECT_DEPTH).toBe(2);
    expect(nestingViolation(nest({ childSubProjectCount: 1 }))?.message).toContain("2 levels deep");
    expect(nestingViolation(nest({ parentParentId: "p" }))?.message).toContain("2 levels deep");
  });

  it("the rules are ordered: self-nesting is reported before ownership rules", () => {
    const check = nest({ childId: "x", parentId: "x", childParentId: "y" });
    expect(nestingViolation(check)?.code).toBe("self_nesting");
  });
});

// ---- grouping (rendering shape) -------------------------------------------

describe("groupUnitsByKind", () => {
  it("buckets by kind in the canonical ITEM_KINDS order and drops empty groups", () => {
    const groups = groupUnitsByKind([
      { kind: "journal" as const, id: "j1", title: "Journal 2026-01-01" },
      { kind: "note" as const, id: "n1", title: "Note" },
      { kind: "note" as const, id: "n2", title: "Note 2" },
    ]);
    expect(groups.map((g) => g.kind)).toEqual(["note", "journal"]);
    expect(groups[0].units.map((u) => u.id)).toEqual(["n1", "n2"]);
  });

  it("preserves insertion order inside a kind", () => {
    const groups = groupUnitsByKind([
      { kind: "project" as const, id: "p3", title: "third" },
      { kind: "project" as const, id: "p1", title: "first" },
    ]);
    expect(groups[0].units.map((u) => u.id)).toEqual(["p3", "p1"]);
  });

  it("returns nothing for an empty list", () => {
    expect(groupUnitsByKind([])).toEqual([]);
  });
});
