// SPDX-License-Identifier: MIT
// NEXALOG-PROJECTS — pure domain layer. No I/O, no AI. Lifecycle rules +
// grouping value types + the intelligence port the domain depends on (DIP).
// The Jex/Plexo client implements ProjectIntelligencePort; AI concerns never
// leak past this boundary. See plans/projects/adr/0001-nexalog-projects.md.

export const LIFECYCLE_STATES = ["draft", "active", "archived"] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export const ITEM_KINDS = ["note", "bookmark", "journal"] as const;
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
