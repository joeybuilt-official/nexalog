import { describe, it, expect } from "vitest";
import {
  canTransition,
  assertTransition,
  isLifecycleState,
  isItemKind,
  LIFECYCLE_STATES,
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

  it("isItemKind", () => {
    expect(isItemKind("note")).toBe(true);
    expect(isItemKind("bookmark")).toBe(true);
    expect(isItemKind("journal")).toBe(true);
    expect(isItemKind("project")).toBe(false);
  });
});
