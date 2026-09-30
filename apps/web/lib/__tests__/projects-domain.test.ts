import { describe, it, expect } from "vitest";
import {
  canTransition,
  assertTransition,
  isLifecycleState,
  isItemKind,
  LIFECYCLE_STATES,
  ITEM_KINDS,
  MAX_PROJECT_DEPTH,
  NESTING_VIOLATION_CODES,
  canNestSubProject,
  nestingViolation,
  assertNestable,
  canReparent,
  reparentViolation,
  assertReparentable,
  reparentDirection,
  parentCandidates,
  canBecomeSubProject,
  ProjectNestingError,
  groupUnitsByKind,
  type NestingCheck,
  type ReparentCheck,
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

// ---- re-parenting (move / promote) — the walk R1+R2 cannot express ---------
//
// The add-path guard above never consults the child's CURRENT parent, and that is
// exactly why it cannot police a MOVE: the child of a move is normally already
// someone's child, so "already has a parent" is the edge being rewritten rather
// than a bar. These tests pin the guard that DOES police it — chiefly that a
// project can never become its own ancestor.

const move = (over: Partial<ReparentCheck> = {}): ReparentCheck => ({
  projectId: "child",
  parentId: "target",
  parentAncestors: [],
  projectSubProjectCount: 0,
  ...over,
});

describe("sub-project re-parenting policy", () => {
  it("allows moving a child under a root that is not its ancestor", () => {
    expect(canReparent(move())).toBe(true);
    expect(reparentViolation(move())).toBeNull();
    expect(() => assertReparentable(move())).not.toThrow();
  });

  it("allows a move even when the project ALREADY has a parent — the R1 the add-path enforces is what a move replaces", () => {
    // The whole reason this guard exists as a separate rule set. `nestingViolation`
    // would refuse this (`already_has_parent`); the move must not.
    expect(nestingViolation(nest({ childParentId: "old-parent" }))?.code).toBe("already_has_parent");
    expect(canReparent(move())).toBe(true);
  });

  it("rejects a project nested under itself (self-parent)", () => {
    const check = move({ projectId: "same", parentId: "same" });
    expect(reparentViolation(check)?.code).toBe("self_nesting");
    expect(() => assertReparentable(check)).toThrow(ProjectNestingError);
  });

  it("rejects a DIRECT child — the 2-level chain A → B moved under B", () => {
    // B's ancestry is [A]; moving A under B would make A its own ancestor.
    const check = move({ projectId: "A", parentId: "B", parentAncestors: ["A"] });
    expect(reparentViolation(check)?.code).toBe("cycle");
  });

  it("rejects a DEEPER descendant chain — the 3-level A → B → C moved under C", () => {
    // C's ancestry is [B, A]; B is A's child and A is what is moving.
    const check = move({ projectId: "A", parentId: "C", parentAncestors: ["B", "A"] });
    expect(reparentViolation(check)?.code).toBe("cycle");
  });

  it("rejects the deepest case the walk can produce — the project is the ROOT of the prospective parent's chain", () => {
    const check = move({ projectId: "root", parentId: "great", parentAncestors: ["mid", "child", "root"] });
    expect(reparentViolation(check)?.code).toBe("cycle");
    expect(reparentViolation(check)?.message).toContain("own ancestor");
  });

  it("does NOT call a shared ancestor a cycle — the check is identity, not depth", () => {
    // "target" is a root here: its ancestry is empty, so nothing about the
    // project's own position can make this a cycle.
    expect(reparentViolation(move({ parentAncestors: [] }))).toBeNull();
  });

  it("rejects a prospective parent that is itself a sub-project (two levels, R2)", () => {
    const check = move({ projectId: "A", parentId: "B", parentAncestors: ["grandparent"] });
    expect(reparentViolation(check)?.code).toBe("parent_is_child");
  });

  it("rejects moving a project that has sub-projects of its own (the other half of R2)", () => {
    const check = move({ projectSubProjectCount: 2 });
    expect(reparentViolation(check)?.code).toBe("child_is_parent");
  });

  it("promotes unconditionally: parentId null clears the parent with no ancestry to check", () => {
    const check = move({ parentId: null, parentAncestors: ["stale"] });
    expect(reparentViolation(check)).toBeNull();
    expect(assertReparentable(check)).toEqual({ direction: "promote", parentId: null });
  });

  it("reports the direction, so a caller can tell a move from a promote", () => {
    expect(assertReparentable(move()).direction).toBe("nest");
    expect(assertReparentable(move({ parentId: null })).direction).toBe("promote");
  });

  it("derives the direction from ONE function, used by the guard and the store's no-op alike", () => {
    // Two call sites describing the same request must not be able to disagree
    // about which verb it is, which is what a duplicated ternary drifts into.
    expect(reparentDirection("some-uuid")).toBe("nest");
    expect(reparentDirection(null)).toBe("promote");
    for (const parentId of ["some-uuid", null]) {
      expect(assertReparentable(move({ parentId })).direction).toBe(reparentDirection(parentId));
    }
  });

  it("treats a project that does not exist yet (create-as-sub-project) as never its own ancestor", () => {
    // `projectId: null` is the create path. Only the parent's own shape can be
    // wrong — a cycle is impossible because the child is not in any chain.
    expect(
      reparentViolation({ projectId: null, parentId: "p", parentAncestors: [], projectSubProjectCount: 0 }),
    ).toBeNull();
    expect(
      reparentViolation({
        projectId: null,
        parentId: "p",
        parentAncestors: ["gp"],
        projectSubProjectCount: 0,
      })?.code,
    ).toBe("parent_is_child");
  });

  it("throws a coded ProjectNestingError on every refusal, so the route can branch on `code`", () => {
    for (const [check, code] of [
      [move({ projectId: "x", parentId: "x" }), "self_nesting"],
      [move({ parentAncestors: ["child"] }), "cycle"],
      [move({ parentAncestors: ["gp"] }), "parent_is_child"],
      [move({ projectSubProjectCount: 1 }), "child_is_parent"],
    ] as const) {
      try {
        assertReparentable(check);
        throw new Error("assertReparentable should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ProjectNestingError);
        expect((e as ProjectNestingError).code).toBe(code);
      }
    }
  });

  it("names the refusal codes in one vocabulary shared with the add path", () => {
    // `NESTING_VIOLATION_CODES` is the single source: the move adds `cycle` and
    // keeps the other four, so a client can branch on one enum for both verbs.
    expect([...NESTING_VIOLATION_CODES].sort()).toEqual(
      ["already_has_parent", "child_is_parent", "cycle", "parent_is_child", "self_nesting"].sort(),
    );
  });
});

// ---- who may be a parent (the picker's rule) ------------------------------

describe("parentCandidates", () => {
  const projects = [
    { id: "root-a", name: "10 Ton", parentId: null },
    { id: "root-b", name: "Full-On Pictures", parentId: null },
    { id: "child", name: "Frame Forge", parentId: "root-a" },
  ];

  it("offers only ROOT projects — a sub-project cannot take a child (two levels)", () => {
    expect(parentCandidates(projects, null).map((p) => p.id)).toEqual(["root-a", "root-b"]);
  });

  it("never offers the project itself", () => {
    expect(parentCandidates(projects, "root-a").map((p) => p.id)).toEqual(["root-b"]);
  });

  it("keeps a project's own current parent in the list, so the control reads honestly", () => {
    // A move to the same parent is a reported no-op, not an error — excluding it
    // would make the current value unselectable and the select render blank.
    expect(parentCandidates(projects, "child").map((p) => p.id)).toEqual(["root-a", "root-b"]);
  });

  it("returns nothing when every project is already nested", () => {
    expect(parentCandidates([{ id: "only-child", name: "x", parentId: "elsewhere" }], null)).toEqual([]);
  });

  it("accepts a readonly list without copying the caller's array type away", () => {
    const narrowed = parentCandidates(projects as ReadonlyArray<(typeof projects)[number]>, null);
    expect(narrowed).toHaveLength(2);
  });
});

describe("canBecomeSubProject", () => {
  it("is true only for a project with no sub-projects of its own", () => {
    expect(canBecomeSubProject({ subProjectCount: 0 })).toBe(true);
    expect(canBecomeSubProject({ subProjectCount: 1 })).toBe(false);
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
