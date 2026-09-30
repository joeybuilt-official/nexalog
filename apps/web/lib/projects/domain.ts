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
// Cycle safety falls out of R1 + R2 for an ADD rather than needing its own walk:
// every shape a cycle would require (a child that already has a parent, or a
// parent that is itself someone's child) is exactly what those rules reject.
// **A MOVE is the different question, and it does need the walk**: when a
// project that is already a child is moved under a different parent, R1 is
// precisely what the operation changes, so it cannot also be the guard. See
// `assertReparentable` below.
//
// Depth is a property of THIS guard, not of a column — there is no `parent_id`,
// no depth column and no CHECK constraint (A1.3: raising the limit stays a
// policy change plus a test, not a migration on populated rows). Every write
// path that can nest a project must call `assertNestable` or
// `assertReparentable`.
export const MAX_PROJECT_DEPTH = 2;

export const NESTING_VIOLATION_CODES = [
  "self_nesting",
  "already_has_parent",
  "child_is_parent",
  "parent_is_child",
  "cycle",
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

// ---- Re-parenting (move / promote) ---------------------------------------
// The ADD guard above answers "may this root become a child of this root". A
// MOVE answers a different question — "may this project, whatever it currently
// is, hang off that one instead" — and the two do not share a rule set: the
// child is usually ALREADY someone's child (that is what a move is), so R1 is
// the thing being rewritten rather than a bar. What a move must never do is
// create a cycle, and that is the one check R1+R2 cannot express.
//
// The guard is still PURE: the caller reads the ancestry and passes it in, so
// the whole decision is testable with plain values and there is exactly one
// place the rule lives (every entrypoint — route, job, CLI — gets the same
// answer because the rule is not in the route).

export type ReparentDirection = "nest" | "promote";

export type ReparentCheck = {
  /**
   * The project being moved. `null` when the project is not yet created — the
   * create-a-sub-project path, where the child cannot possibly be its own
   * ancestor and only the parent's own shape can be wrong.
   */
  projectId: string | null;
  /** The prospective parent; `null` promotes the project to a root. */
  parentId: string | null;
  /**
   * The ancestry of the PROSPECTIVE PARENT, nearest ancestor first
   * (`[itsParent, itsGrandparent, …]`). The store walks this from the edge
   * table — the same `project_items` relation every other read uses, never a
   * second mechanism. Empty means the parent is a root. Not read for a promote.
   */
  parentAncestors: readonly string[];
  /**
   * How many sub-projects the project has. Only a move of an EXISTING project
   * cares: moving a parent under another project would make the tree three
   * levels deep, which R2 forbids. A project being created has none, by
   * definition.
   */
  projectSubProjectCount: number;
};

export type ReparentPlan = {
  direction: ReparentDirection;
  /** The parent the project is moving to (`null` promotes). */
  parentId: string | null;
};

/**
 * Pure. Returns `null` when the move is allowed, else the violation — the same
 * coded shape `nestingViolation` returns, so clients branch on one vocabulary.
 *
 * Order matters and is deliberate:
 *
 *   1. `self_nesting`   — a project can never be its own parent;
 *   2. `cycle`          — `projectId` must not appear anywhere in the ancestry
 *                         it is about to join. This is the check that makes a
 *                         move safe, and it subsumes the direct-child case: a
 *                         direct child's ancestry begins with its parent, which
 *                         is the project;
 *   3. `parent_is_child`— the prospective parent must itself be a root, or the
 *                         tree would be three levels deep (R2). This is what
 *                         `nestingViolation` calls `parent_is_child`;
 *   4. `child_is_parent`— the project must not have sub-projects of its own, the
 *                         other half of R2.
 *
 * Nothing here consults the project's CURRENT parent, and that is the point: the
 * parent a project has today is the edge a move replaces.
 */
export function reparentViolation(input: ReparentCheck): NestingViolation | null {
  if (input.parentId === null) return null;

  if (input.projectId !== null && input.parentId === input.projectId) {
    return { code: "self_nesting", message: "A project cannot be nested under itself." };
  }

  if (input.projectId !== null && input.parentAncestors.includes(input.projectId)) {
    return {
      code: "cycle",
      message:
        "That would nest a project inside its own sub-tree. A project can never become its own ancestor.",
    };
  }

  if (input.parentAncestors.length > 0) {
    return {
      code: "parent_is_child",
      message: `That project is itself a sub-project — projects nest ${MAX_PROJECT_DEPTH} levels deep.`,
    };
  }

  if (input.projectSubProjectCount > 0) {
    return {
      code: "child_is_parent",
      message: `This project has sub-projects of its own, so it cannot become a sub-project — projects nest ${MAX_PROJECT_DEPTH} levels deep.`,
    };
  }

  return null;
}

export function canReparent(input: ReparentCheck): boolean {
  return reparentViolation(input) === null;
}

/**
 * The verb a `parentId` expresses, derived once — a uuid is a MOVE ("nest"),
 * `null` is a PROMOTE. Exported so the store's no-op branch and the guard's
 * return cannot disagree about which word describes the same request.
 */
export function reparentDirection(parentId: string | null): ReparentDirection {
  return parentId === null ? "promote" : "nest";
}

/**
 * Write-path guard for a move (and for the create-a-sub-project path, with
 * `projectId: null`). Throws `ProjectNestingError` (coded) on a violation,
 * exactly as `assertNestable` does — the route maps the code to a 400 and
 * nothing is written.
 */
export function assertReparentable(input: ReparentCheck): ReparentPlan {
  const violation = reparentViolation(input);
  if (violation) throw new ProjectNestingError(violation);
  return { direction: reparentDirection(input.parentId), parentId: input.parentId };
}

// ---- Who may be a parent (the picker's rule) ------------------------------
// The UI needs the same rule the guard enforces, or it offers an action the
// server will refuse — and a control that 400s on the obvious choice reads as a
// bug. It lives here, pure, so the picker and the guard cannot disagree and the
// rule is testable without rendering anything.

export type ParentCandidate = {
  id: string;
  name: string;
  /** `null` when the project is a root. */
  parentId: string | null;
};

/**
 * The projects that may legally be the parent of `projectId` — or of a project
 * that does not exist yet, when `projectId` is `null` (the create-a-sub-project
 * picker).
 *
 * A candidate must be a ROOT: a project that is itself a sub-project cannot take
 * a child without making the tree three levels deep (R2). That single test is
 * also what makes a cycle impossible from this picker — a cycle needs the
 * project to be inside its own prospective ancestor chain, and a root has no
 * ancestors at all.
 *
 * The project is never its own candidate, and neither is its own current parent
 * excluded — the picker shows the current parent (so the control reads honestly)
 * and a move to the same parent is a reported no-op rather than an error, which
 * the store decides, not this function.
 */
export function parentCandidates<T extends ParentCandidate>(
  projects: readonly T[],
  projectId: string | null,
): T[] {
  return projects.filter(
    (project) => project.parentId === null && project.id !== projectId,
  );
}

/**
 * Whether a project can be nested under another AT ALL — the one condition that
 * is a property of the project itself rather than of the prospective parent.
 *
 * A project with sub-projects of its own is a root by construction and cannot
 * become a child (R2, the `child_is_parent` arm of the guard), so a UI that
 * offers it a move is offering a guaranteed 400.
 */
export function canBecomeSubProject(project: { subProjectCount: number }): boolean {
  return project.subProjectCount === 0;
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
