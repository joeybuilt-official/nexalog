// SPDX-License-Identifier: MIT
// NEXALOG-PROJECTS — pure domain layer. No I/O, no AI. Lifecycle rules +
// grouping value types + the intelligence port the domain depends on (DIP).
// The Jex/Plexo client implements ProjectIntelligencePort; AI concerns never
// leak past this boundary. See plans/projects/adr/0001-nexalog-projects.md.

export const LIFECYCLE_STATES = ["draft", "active", "archived"] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export const ITEM_KINDS = ["note", "bookmark", "journal", "project"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

// Allowed lifecycle transitions. draft↔active, active→archived, archived→active.
// Reopening a draft from archived is not allowed (go via active).
const TRANSITIONS: Record<LifecycleState, readonly LifecycleState[]> = {
  draft: ["active", "archived"],
  active: ["draft", "archived"],
  archived: ["active"],
};

export function isLifecycleState(v: unknown): v is LifecycleState {
  return typeof v === "string" && (LIFECYCLE_STATES as readonly string[]).includes(v);
}

export function isItemKind(v: unknown): v is ItemKind {
  return typeof v === "string" && (ITEM_KINDS as readonly string[]).includes(v);
}

export function canTransition(from: LifecycleState, to: LifecycleState): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

/** Pure guard. Throws a stable error string on an illegal transition. */
export function assertTransition(from: LifecycleState, to: LifecycleState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal lifecycle transition: ${from} -> ${to}`);
  }
}

// ---- Sub-project nesting policy -------------------------------------------
// A sub-project is a `project_items` row with kind 'project' whose item_id is
// the CHILD project's id — the same reference-based container the item layer
// uses, applied one level up (ADR-0018 §D1/§D2; nesting policy ADR-0001
// Amendment A1.3). Two rules, both POLICY, never schema:
//
//   R1 one parent   — a project that already has a parent cannot gain another.
//   R2 two levels   — a sub-project may not itself be a parent, and a parent
//                     must itself be a root.
//
// Cycle safety falls out of R1 + R2 rather than needing its own walk: every
// shape a cycle would require (a child that already has a parent, or a parent
// that is itself someone's child) is exactly what those rules reject.
//
// Depth is a property of THIS guard, not of a column — there is no `parent_id`,
// no depth column and no CHECK constraint (A1.3: raising the limit stays a
// policy change plus a test, not a migration on populated rows). Every write
// path that can nest a project must call `assertNestable`.
export const MAX_PROJECT_DEPTH = 2;

export const NESTING_VIOLATION_CODES = [
  "self_nesting",
  "already_has_parent",
  "child_is_parent",
  "parent_is_child",
] as const;
export type NestingViolationCode = (typeof NESTING_VIOLATION_CODES)[number];

export type NestingCheck = {
  /** The project that would be given a parent (the proposed child). */
  childId: string;
  /** The proposed parent. */
  parentId: string;
  /** The child's current parent, `null` when it is a root. */
  childParentId: string | null;
  /** How many sub-projects the child already has. */
  childSubProjectCount: number;
  /** The proposed parent's own parent, `null` when it is a root. */
  parentParentId: string | null;
};

export type NestingViolation = { code: NestingViolationCode; message: string };

/** Coded domain error — routes map `code` onto a 400, never the message text. */
export class ProjectNestingError extends Error {
  readonly code: NestingViolationCode;

  constructor(violation: NestingViolation) {
    super(violation.message);
    this.name = "ProjectNestingError";
    this.code = violation.code;
  }
}

/** Pure. Returns `null` when the nesting is allowed, else the violation. */
export function nestingViolation(input: NestingCheck): NestingViolation | null {
  if (input.childId === input.parentId) {
    return {
      code: "self_nesting",
      message: "A project cannot be nested under itself.",
    };
  }
  if (input.childParentId) {
    return {
      code: "already_has_parent",
      message:
        "This project already has a parent — a sub-project has exactly one, so detach it before nesting it elsewhere.",
    };
  }
  if (input.childSubProjectCount > 0) {
    return {
      code: "child_is_parent",
      message: `This project has sub-projects of its own, so it cannot become a sub-project — projects nest ${MAX_PROJECT_DEPTH} levels deep.`,
    };
  }
  if (input.parentParentId) {
    return {
      code: "parent_is_child",
      message: `That project is itself a sub-project — projects nest ${MAX_PROJECT_DEPTH} levels deep.`,
    };
  }
  return null;
}

export function canNestSubProject(input: NestingCheck): boolean {
  return nestingViolation(input) === null;
}

/** Write-path guard. Throws `ProjectNestingError` (coded) on a violation. */
export function assertNestable(input: NestingCheck): void {
  const violation = nestingViolation(input);
  if (violation) throw new ProjectNestingError(violation);
}

// ---- Presentation-agnostic grouping --------------------------------------
// `GroupedUnit`s come back from the store in insertion order; every surface
// that renders them (detail page, digest) needs them bucketed by kind in the
// canonical ITEM_KINDS order. Pure, so it is testable without a database.
export function groupUnitsByKind<T extends { kind: ItemKind }>(
  units: T[],
): Array<{ kind: ItemKind; units: T[] }> {
  return ITEM_KINDS.map((kind) => ({ kind, units: units.filter((u) => u.kind === kind) })).filter(
    (group) => group.units.length > 0,
  );
}

// ---- Intelligence port (Dependency Inversion at the Jex boundary) ----------
// The domain/routes depend on THIS, never on a concrete Plexo client. One
// implementation lives in lib/plexo.ts. Plexo holds the Work history keyed by
// projectId; readWorkHistory reads it back. Nothing here knows about models,
// embeddings, or HTTP.

export type BrainstormTurn = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type ProjectContextDigest = {
  projectId: string;
  name: string;
  /** Living-doc + grouped-knowledge summary fed to the Work as context. */
  summary: string;
  /** Compact grouped-unit references for richer grounding (appState). */
  groupedUnits: Array<{ kind: ItemKind; id: string; title: string }>;
};

export interface ProjectIntelligencePort {
  /**
   * Run one brainstorm turn over Jex, scoped to the project. Inference runs in
   * Plexo (no local AI); the project digest grounds the reply and prior turns
   * give continuity. Returns only the assistant reply — turn persistence is the
   * route's concern (the I/O seam), keeping this port pure intelligence.
   */
  brainstorm(input: {
    workspaceId: string;
    digest: ProjectContextDigest;
    history: BrainstormTurn[];
    message: string;
  }): Promise<{ reply: string }>;
}
