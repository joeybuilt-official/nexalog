// SPDX-License-Identifier: MIT
// NEXALOG-PROJECTS — I/O layer for the project domain. Ownership-guarded
// grouping-by-reference + grouped-unit hydration + context digest. Keeps
// routes thin and the security guard in one place (no IDOR).
//
// Sub-projects ride the same mechanism: a `project_items` row with
// kind 'project' whose `itemId` is the CHILD project's id (ADR-0018
// reference-based containers). That means the item layer needs no new table —
// and it means the two container rules (one parent per project, at most two
// levels) are enforced HERE in the write path via `assertNestable`, never by
// the schema. Read paths filter soft-deleted children rather than mutating the
// parent's rows.

import { db, schema } from "@/lib/db";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  assertNestable,
  assertReparentable,
  assertTransition,
  reparentDirection,
  MAX_PROJECT_DEPTH,
  type ItemKind,
  type LifecycleState,
  type ProjectContextDigest,
  type ReparentPlan,
} from "@/lib/projects/domain";

/**
 * Hard bound on the ancestry walk below. The walk exists to REFUSE a cycle, so
 * it must terminate on malformed data rather than trust the tree to be acyclic
 * — `MAX_PROJECT_DEPTH * this` steps is far more than any legal chain and still
 * finite. When depth is ever raised, both factors move together.
 */
const ANCESTRY_WALK_LIMIT = 8;

export type UnitRef = { kind: ItemKind; id: string };
export type GroupedUnit = {
  kind: ItemKind;
  id: string;
  title: string;
  /**
   * Journal entries only: the ISO `entry_date`. The date is part of the unit's
   * address (`/app/journal/<date>`), so the surface cannot link to it without
   * it — carried here rather than re-parsed out of `title`.
   */
  date?: string;
};

/** A container reference: the child project hanging off a parent project. */
export type SubProjectRef = { id: string; name: string; lifecycleState: LifecycleState };

export type ProjectSummary = {
  id: string;
  workspaceId: string;
  userId: string;
  name: string;
  description: string | null;
  lifecycleState: LifecycleState;
  livingDocUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** The project this one is nested under, `null` when it is a root. */
  parentId: string | null;
  /** Members that are notes/bookmarks/journal entries. */
  itemCount: number;
  /** Live child projects (soft-deleted children are not counted). */
  subProjectCount: number;
};

export type ProjectDetail = ProjectSummary & {
  livingDoc: string;
  /** Insertion-ordered grouped units, all kinds, soft-deleted targets dropped. */
  units: GroupedUnit[];
  subProjects: SubProjectRef[];
  parent: SubProjectRef | null;
};

export type ProjectItemRef = UnitRef;
export type ProjectItemRemoval = { kind: ItemKind; id: string };

// ---- ownership guard ------------------------------------------------------

/**
 * Batched ownership check. Given candidate refs, return only those whose
 * underlying unit belongs to one of the user's workspaces. One query per kind
 * (no N+1). Anything not returned is rejected by the caller.
 *
 * For `kind === 'project'` the target is another PROJECT row, so it must both
 * belong to one of `workspaceIds` and not be soft-deleted — otherwise a caller
 * could nest a project they cannot see (and, worse, one belonging to someone
 * else) into their own tree.
 */
export async function filterOwnedRefs(
  workspaceIds: string[],
  refs: UnitRef[],
): Promise<UnitRef[]> {
  if (workspaceIds.length === 0 || refs.length === 0) return [];

  const byKind: Record<ItemKind, string[]> = { note: [], bookmark: [], journal: [], project: [] };
  for (const r of refs) {
    const bucket = byKind[r.kind];
    if (bucket) bucket.push(r.id);
  }

  const owned: UnitRef[] = [];

  if (byKind.note.length) {
    const rows = await db
      .select({ id: schema.notes.id })
      .from(schema.notes)
      .where(and(inArray(schema.notes.id, byKind.note), inArray(schema.notes.workspaceId, workspaceIds)));
    for (const row of rows) owned.push({ kind: "note", id: row.id });
  }
  if (byKind.bookmark.length) {
    const rows = await db
      .select({ id: schema.captureSources.id })
      .from(schema.captureSources)
      .where(
        and(
          inArray(schema.captureSources.id, byKind.bookmark),
          inArray(schema.captureSources.workspaceId, workspaceIds),
        ),
      );
    for (const row of rows) owned.push({ kind: "bookmark", id: row.id });
  }
  if (byKind.journal.length) {
    const rows = await db
      .select({ id: schema.journalEntries.id })
      .from(schema.journalEntries)
      .where(
        and(
          inArray(schema.journalEntries.id, byKind.journal),
          inArray(schema.journalEntries.workspaceId, workspaceIds),
        ),
      );
    for (const row of rows) owned.push({ kind: "journal", id: row.id });
  }
  if (byKind.project.length) {
    const rows = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(
        and(
          inArray(schema.projects.id, byKind.project),
          inArray(schema.projects.workspaceId, workspaceIds),
          isNull(schema.projects.deletedAt),
        ),
      );
    for (const row of rows) owned.push({ kind: "project", id: row.id });
  }

  return owned;
}

// ---- reads ----------------------------------------------------------------

/** Every live project in the caller's workspaces, with the two counts the UI shows. */
export async function listProjects(workspaceIds: string[]): Promise<ProjectSummary[]> {
  if (workspaceIds.length === 0) return [];

  const rows = await db
    .select()
    .from(schema.projects)
    .where(and(inArray(schema.projects.workspaceId, workspaceIds), isNull(schema.projects.deletedAt)))
    .orderBy(desc(schema.projects.updatedAt));

  if (rows.length === 0) return [];

  const projectIds = rows.map((r) => r.id);

  // Two aggregates, each one query — never a count per row. Members and
  // sub-projects are counted separately because they are different numbers to
  // the user ("4 items" vs "2 sub-projects"), and a sub-project is not a member.
  const [memberRows, subProjectRows] = await Promise.all([
    db
      .select({ projectId: schema.projectItems.projectId, count: sql<number>`count(*)::int` })
      .from(schema.projectItems)
      .where(and(inArray(schema.projectItems.projectId, projectIds), ne(schema.projectItems.itemKind, "project")))
      .groupBy(schema.projectItems.projectId),
    db
      .select({ projectId: schema.projectItems.projectId, count: sql<number>`count(*)::int` })
      .from(schema.projectItems)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.projectItems.itemId))
      .where(
        and(
          inArray(schema.projectItems.projectId, projectIds),
          eq(schema.projectItems.itemKind, "project"),
          isNull(schema.projects.deletedAt),
        ),
      )
      .groupBy(schema.projectItems.projectId),
  ]);

  const itemCounts = new Map(memberRows.map((r) => [r.projectId, Number(r.count)]));
  const subCounts = new Map(subProjectRows.map((r) => [r.projectId, Number(r.count)]));
  const parents = await getParentIdsFor(projectIds);

  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    name: row.name,
    description: row.description,
    lifecycleState: row.lifecycleState as LifecycleState,
    livingDocUpdatedAt: row.livingDocUpdatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    parentId: parents.get(row.id) ?? null,
    itemCount: itemCounts.get(row.id) ?? 0,
    subProjectCount: subCounts.get(row.id) ?? 0,
  }));
}

/** One project, scoped to the caller's workspaces. `null` means "not yours". */
export async function getProject(
  workspaceIds: string[],
  projectId: string,
): Promise<ProjectDetail | null> {
  const project = await getProjectRow(workspaceIds, projectId);
  if (!project) return null;

  const [units, subProjects, parentId] = await Promise.all([
    hydrateGroupedUnits(projectId),
    getSubProjects(projectId, workspaceIds),
    getProjectParentId(projectId),
  ]);

  const parentRows = parentId
    ? await db
        .select({
          id: schema.projects.id,
          name: schema.projects.name,
          lifecycleState: schema.projects.lifecycleState,
        })
        .from(schema.projects)
        .where(
          and(
            eq(schema.projects.id, parentId),
            inArray(schema.projects.workspaceId, workspaceIds),
            isNull(schema.projects.deletedAt),
          ),
        )
        .limit(1)
    : [];

  const sums = await summariseCounts([projectId]);

  return {
    id: project.id,
    workspaceId: project.workspaceId,
    userId: project.userId,
    name: project.name,
    description: project.description,
    lifecycleState: project.lifecycleState as LifecycleState,
    livingDoc: project.livingDoc,
    livingDocUpdatedAt: project.livingDocUpdatedAt,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    parentId,
    itemCount: sums.itemCounts.get(projectId) ?? 0,
    subProjectCount: sums.subProjectCounts.get(projectId) ?? 0,
    units,
    subProjects,
    parent: parentRows[0]
      ? {
          id: parentRows[0].id,
          name: parentRows[0].name,
          lifecycleState: parentRows[0].lifecycleState as LifecycleState,
        }
      : null,
  };
}

/**
 * Hydrate grouped refs into display units (title per kind) for a project.
 *
 * Order is `project_items` insertion order, preserved across all four kinds.
 * A ref whose target no longer resolves (hard-deleted, or a child project that
 * was soft-deleted) is dropped rather than rendered as a broken row — the same
 * "unresolved members do not survive" rule ADR-0018 §D2 sets for a rebuild.
 */
export async function hydrateGroupedUnits(projectId: string): Promise<GroupedUnit[]> {
  const items = await db
    .select({ itemKind: schema.projectItems.itemKind, itemId: schema.projectItems.itemId })
    .from(schema.projectItems)
    .where(eq(schema.projectItems.projectId, projectId));

  const ids: Record<ItemKind, string[]> = { note: [], bookmark: [], journal: [], project: [] };
  for (const it of items) {
    const k = it.itemKind as ItemKind;
    if (ids[k]) ids[k].push(it.itemId);
  }

  const titleById = new Map<string, GroupedUnit>();

  if (ids.note.length) {
    const rows = await db
      .select({ id: schema.notes.id, title: schema.notes.title })
      .from(schema.notes)
      .where(and(inArray(schema.notes.id, ids.note), isNull(schema.notes.deletedAt)));
    for (const r of rows) titleById.set(`note:${r.id}`, { kind: "note", id: r.id, title: r.title || "Untitled" });
  }
  if (ids.bookmark.length) {
    const rows = await db
      .select({ id: schema.captureSources.id, ogTitle: schema.captureSources.ogTitle, url: schema.captureSources.url })
      .from(schema.captureSources)
      .where(and(inArray(schema.captureSources.id, ids.bookmark), isNull(schema.captureSources.deletedAt)));
    for (const r of rows)
      titleById.set(`bookmark:${r.id}`, { kind: "bookmark", id: r.id, title: r.ogTitle ?? r.url ?? "Untitled" });
  }
  if (ids.journal.length) {
    const rows = await db
      .select({ id: schema.journalEntries.id, entryDate: schema.journalEntries.entryDate })
      .from(schema.journalEntries)
      .where(and(inArray(schema.journalEntries.id, ids.journal), isNull(schema.journalEntries.deletedAt)));
    for (const r of rows)
      titleById.set(`journal:${r.id}`, {
        kind: "journal",
        id: r.id,
        title: `Journal ${r.entryDate}`,
        date: r.entryDate,
      });
  }
  if (ids.project.length) {
    const rows = await db
      .select({ id: schema.projects.id, name: schema.projects.name })
      .from(schema.projects)
      .where(and(inArray(schema.projects.id, ids.project), isNull(schema.projects.deletedAt)));
    for (const r of rows)
      titleById.set(`project:${r.id}`, { kind: "project", id: r.id, title: r.name || "Untitled project" });
  }

  // Preserve insertion order from project_items.
  return items
    .map((it) => titleById.get(`${it.itemKind}:${it.itemId}`))
    .filter((u): u is GroupedUnit => Boolean(u));
}

/** Live child projects of `projectId`, oldest reference first. */
export async function getSubProjects(
  projectId: string,
  workspaceIds: string[],
): Promise<SubProjectRef[]> {
  if (workspaceIds.length === 0) return [];

  const rows = await db
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      lifecycleState: schema.projects.lifecycleState,
      addedAt: schema.projectItems.addedAt,
    })
    .from(schema.projectItems)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.projectItems.itemId))
    .where(
      and(
        eq(schema.projectItems.projectId, projectId),
        eq(schema.projectItems.itemKind, "project"),
        inArray(schema.projects.workspaceId, workspaceIds),
        isNull(schema.projects.deletedAt),
      ),
    )
    .orderBy(schema.projectItems.addedAt);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    lifecycleState: r.lifecycleState as LifecycleState,
  }));
}

/**
 * The project's parent, or `null` when it is a root. Reads the nesting edge
 * rather than a `parent_id` column — the edge IS the relation (ADR-0018).
 */
export async function getProjectParentId(projectId: string): Promise<string | null> {
  const rows = await db
    .select({ itemId: schema.projectItems.itemId })
    .from(schema.projectItems)
    .where(and(eq(schema.projectItems.itemId, projectId), eq(schema.projectItems.itemKind, "project")))
    .limit(1);
  return rows[0]?.itemId ?? null;
}

/**
 * What the add-item flow can offer. Bounded lists (newest first) because a
 * picker is a picker, not a second browse surface — a user who wants the whole
 * library searches for it.
 */
export async function listGroupableCandidates(
  workspaceIds: string[],
  limit = 50,
): Promise<{
  notes: Array<{ id: string; title: string }>;
  bookmarks: Array<{ id: string; title: string }>;
  journals: Array<{ id: string; title: string; date: string }>;
  projects: Array<{ id: string; name: string; lifecycleState: LifecycleState; parentId: string | null }>;
}> {
  if (workspaceIds.length === 0) return { notes: [], bookmarks: [], journals: [], projects: [] };

  const [noteRows, bookmarkRows, journalRows, projectRows, edgeRows] = await Promise.all([
    db
      .select({ id: schema.notes.id, title: schema.notes.title })
      .from(schema.notes)
      .where(and(inArray(schema.notes.workspaceId, workspaceIds), isNull(schema.notes.deletedAt)))
      .orderBy(desc(schema.notes.updatedAt))
      .limit(limit),
    db
      .select({ id: schema.captureSources.id, ogTitle: schema.captureSources.ogTitle, url: schema.captureSources.url })
      .from(schema.captureSources)
      .where(and(inArray(schema.captureSources.workspaceId, workspaceIds), isNull(schema.captureSources.deletedAt)))
      .orderBy(desc(schema.captureSources.createdAt))
      .limit(limit),
    db
      .select({ id: schema.journalEntries.id, entryDate: schema.journalEntries.entryDate })
      .from(schema.journalEntries)
      .where(and(inArray(schema.journalEntries.workspaceId, workspaceIds), isNull(schema.journalEntries.deletedAt)))
      .orderBy(desc(schema.journalEntries.entryDate))
      .limit(limit),
    db
      .select({
        id: schema.projects.id,
        name: schema.projects.name,
        lifecycleState: schema.projects.lifecycleState,
      })
      .from(schema.projects)
      .where(and(inArray(schema.projects.workspaceId, workspaceIds), isNull(schema.projects.deletedAt)))
      .orderBy(schema.projects.name),
    // One query for every nesting edge, so the caller knows which projects are
    // already children without an N+1 probe per row.
    db
      .select({ childId: schema.projectItems.itemId, parentId: schema.projectItems.projectId })
      .from(schema.projectItems)
      .where(eq(schema.projectItems.itemKind, "project")),
  ]);

  const parentByChild = new Map(edgeRows.map((e) => [e.childId, e.parentId]));

  return {
    notes: noteRows.map((r) => ({ id: r.id, title: r.title || "Untitled" })),
    bookmarks: bookmarkRows.map((r) => ({ id: r.id, title: r.ogTitle ?? r.url ?? "Untitled" })),
    journals: journalRows.map((r) => ({
      id: r.id,
      title: `Journal ${r.entryDate}`,
      date: r.entryDate,
    })),
    projects: projectRows.map((r) => ({
      id: r.id,
      name: r.name,
      lifecycleState: r.lifecycleState as LifecycleState,
      parentId: parentByChild.get(r.id) ?? null,
    })),
  };
}

// ---- writes ---------------------------------------------------------------

/**
 * Resolve an optional parent for a project about to be created or moved, and
 * return the ancestry the pure guard needs.
 *
 * One helper, used by BOTH write paths, because the rules are the same and the
 * answer must not depend on which route the caller came through:
 *
 *   - the parent must be one of `workspaceIds` and not soft-deleted — a parent
 *     the caller cannot see is reported as `parent_not_found`, never as
 *     "forbidden", for the same reason `addItemToProject` reports a foreign
 *     target that way: 403 would confirm the id exists somewhere;
 *   - the whole ancestry of that parent is then read and handed to the pure
 *     guard, which owns the actual rule.
 *
 * `null` means "the parent is not the caller's" and is the only failure this
 * reports — an EMPTY array is a legitimate answer (the parent is a root), which
 * is why the two are distinct and a truthiness check on the array alone would
 * conflate them.
 *
 * The ancestry walk is the SAME `project_items` chain every other sub-project
 * read uses — there is no second nesting mechanism and no `parent_id` column
 * (ADR-0018 §D1/§D2).
 */
async function resolveParentAncestorsForWrite(
  workspaceIds: string[],
  parentId: string,
): Promise<string[] | null> {
  const parent = await getProjectRow(workspaceIds, parentId);
  if (!parent) return null;
  return getAncestorIds(parent.id);
}

/**
 * The ancestry of `projectId`, nearest ancestor first — its parent, then that
 * project's parent, and so on until a project with no parent (a root).
 *
 * Bounded by `MAX_PROJECT_DEPTH * ANCESTRY_WALK_LIMIT` rather than trusting the
 * data to be acyclic: this walk runs inside a cycle REFUSAL path, so it has to
 * terminate on the malformed tree it is there to prevent, not spin on it. A
 * pre-existing cycle (which the UI can no longer author, but a hand-applied SQL
 * edit or an older client could have left) therefore still terminates, and the
 * caller's guard sees the repeated id and refuses.
 */
async function getAncestorIds(projectId: string): Promise<string[]> {
  const ancestors: string[] = [];
  const seen = new Set<string>([projectId]);
  let current = projectId;

  for (let depth = 0; depth < MAX_PROJECT_DEPTH * ANCESTRY_WALK_LIMIT; depth += 1) {
    const parentId = await getProjectParentId(current);
    if (!parentId || seen.has(parentId)) break;
    ancestors.push(parentId);
    seen.add(parentId);
    current = parentId;
  }

  return ancestors;
}

export async function createProject(input: {
  workspaceId: string;
  userId: string;
  name: string;
  description?: string | null;
  /**
   * Optional parent: creates the project AS A SUB-PROJECT in one call. Without
   * it the project is a root, which is every existing caller's behaviour — the
   * field is additive and an absent key means root.
   *
   * `null` and an absent key are the same thing here (a root); the route
   * distinguishes them only to reject an explicitly unknown parent.
   *
   * The guard runs BEFORE the project row is inserted, so a refused parent
   * leaves nothing behind; the parent edge is then written as a `project_items`
   * row (kind 'project') once the child's id exists. Ordered that way round
   * because the edge needs the child id — the only step that has to come after
   * the insert is the one that cannot come before it.
   */
  parentId?: string | null;
}): Promise<ProjectSummary | null> {
  const parentId = input.parentId ?? null;

  if (parentId) {
    const parentAncestors = await resolveParentAncestorsForWrite([input.workspaceId], parentId);
    if (parentAncestors === null) return null;

    // `projectId: null` — a project that does not exist yet cannot be its own
    // ancestor, so only the parent's own shape and the two-level rule can fire.
    assertReparentable({
      projectId: null,
      parentId,
      parentAncestors,
      projectSubProjectCount: 0,
    });
  }

  const [row] = await db
    .insert(schema.projects)
    .values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      name: input.name,
      description: input.description ?? null,
      lifecycleState: "active",
    })
    .returning();

  if (parentId) {
    await db
      .insert(schema.projectItems)
      .values({ projectId: parentId, itemKind: "project", itemId: row.id })
      .onConflictDoNothing();
  }

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    name: row.name,
    description: row.description,
    lifecycleState: row.lifecycleState as LifecycleState,
    livingDocUpdatedAt: row.livingDocUpdatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    parentId,
    itemCount: 0,
    subProjectCount: 0,
  };
}

/**
 * Re-parent a project — the manage verb that was missing: move it under a
 * different parent, or `parentId: null` to promote it to a root.
 *
 * The edge is replaced, not added: the existing `project_items` row naming this
 * project as the child is deleted, then the new one inserted. Both statements
 * run in ONE transaction, because the two halves are one fact — a crash between
 * them would leave a project with no parent at all (recoverable, but the point
 * is not to need recovery) or, worse on a retry against a partially written
 * state, two parents, which R1 exists to prevent.
 *
 * A refusal is never silently swallowed: an illegal move throws the guard's coded
 * `ProjectNestingError`, an unknown parent is the `parent_not_found` outcome and a
 * project that is not the caller's is `project_not_found` — three distinct
 * answers, none of them a bare 500 and none of them a no-op.
 */
export async function reparentProject(
  workspaceIds: string[],
  projectId: string,
  parentId: string | null,
): Promise<ReparentOutcome> {
  const project = await getProjectRow(workspaceIds, projectId);
  if (!project) return { ok: false, reason: "project_not_found" };

  const [currentParentId, subProjectCount] = await Promise.all([
    getProjectParentId(projectId),
    countSubProjects(projectId),
  ]);

  // A move to the parent this project already has changes nothing. Reported as
  // a successful no-op (the caller asked for a state the project is already in)
  // rather than an error, and it never reaches the database: re-writing the same
  // edge would delete and re-insert a row for no change.
  if (parentId === currentParentId) {
    return { ok: true, changed: false, plan: { direction: reparentDirection(parentId), parentId } };
  }

  if (parentId !== null) {
    const parentAncestors = await resolveParentAncestorsForWrite(workspaceIds, parentId);
    if (parentAncestors === null) return { ok: false, reason: "parent_not_found" };

    assertReparentable({
      projectId,
      parentId,
      parentAncestors,
      projectSubProjectCount: subProjectCount,
    });
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(schema.projectItems)
      .where(and(eq(schema.projectItems.itemKind, "project"), eq(schema.projectItems.itemId, projectId)));

    if (parentId) {
      await tx
        .insert(schema.projectItems)
        .values({ projectId: parentId, itemKind: "project", itemId: projectId })
        .onConflictDoNothing();
    }
  });

  return { ok: true, changed: true, plan: { direction: reparentDirection(parentId), parentId } };
}

export type ReparentOutcome =
  | { ok: true; changed: boolean; plan: ReparentPlan }
  | { ok: false; reason: "project_not_found" | "parent_not_found" };

/**
 * Update name / description / living document / lifecycle. Only the fields
 * present are written — an absent key means "leave it", never "blank it" (a
 * caller that wants to clear the description sends `null` explicitly).
 *
 * Every field lands in ONE `UPDATE`, and the lifecycle is validated by the
 * domain's `assertTransition` before that statement runs, so an illegal move
 * (archived -> draft) leaves the row exactly as it was instead of half-written.
 * `assertTransition` throws a stable message; the route maps it onto a 409.
 */
export async function updateProject(
  workspaceIds: string[],
  projectId: string,
  patch: {
    name?: string;
    description?: string | null;
    livingDoc?: string;
    lifecycleState?: LifecycleState;
  },
): Promise<ProjectSummary | null> {
  const existing = await getProjectRow(workspaceIds, projectId);
  if (!existing) return null;

  if (patch.lifecycleState !== undefined) {
    assertTransition(existing.lifecycleState as LifecycleState, patch.lifecycleState);
  }

  const values: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.description !== undefined) values.description = patch.description;
  if (patch.livingDoc !== undefined) {
    values.livingDoc = patch.livingDoc;
    values.livingDocUpdatedAt = new Date();
  }
  if (patch.lifecycleState !== undefined) values.lifecycleState = patch.lifecycleState;

  const [row] = await db
    .update(schema.projects)
    .set(values)
    .where(eq(schema.projects.id, projectId))
    .returning();

  const sums = await summariseCounts([projectId]);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    name: row.name,
    description: row.description,
    lifecycleState: row.lifecycleState as LifecycleState,
    livingDocUpdatedAt: row.livingDocUpdatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    parentId: await getProjectParentId(projectId),
    itemCount: sums.itemCounts.get(projectId) ?? 0,
    subProjectCount: sums.subProjectCounts.get(projectId) ?? 0,
  };
}

/**
 * Lifecycle via the domain's transition table — one write path, shared with
 * `updateProject`, so a lifecycle move cannot bypass the guard by arriving
 * through a different function.
 */
export async function setProjectLifecycle(
  workspaceIds: string[],
  projectId: string,
  to: LifecycleState,
): Promise<ProjectSummary | null> {
  return updateProject(workspaceIds, projectId, { lifecycleState: to });
}

/** Archive = the reversible state. Same transition rules, named for the UI. */
export async function archiveProject(
  workspaceIds: string[],
  projectId: string,
): Promise<ProjectSummary | null> {
  return setProjectLifecycle(workspaceIds, projectId, "archived");
}

/**
 * Soft delete. Three writes, ordered so a partial failure is benign:
 *
 *   1. detach the project from ITS parent — the reference goes, the project is
 *      not deleted from anyone else's tree by accident;
 *   2. promote its children to roots (the `ON DELETE SET NULL` semantics A1.6
 *      chose for the parent edge), so nothing is left dangling under a row no
 *      surface will show;
 *   3. set `deleted_at`.
 *
 * Members (notes/bookmarks/journal rows) are never touched: deleting a project
 * destroys nothing the user wrote (ADR-0018 §D5).
 */
export async function softDeleteProject(
  workspaceIds: string[],
  projectId: string,
): Promise<boolean> {
  const existing = await getProjectRow(workspaceIds, projectId);
  if (!existing) return false;

  await db
    .delete(schema.projectItems)
    .where(and(eq(schema.projectItems.itemKind, "project"), eq(schema.projectItems.itemId, projectId)));

  await db
    .delete(schema.projectItems)
    .where(and(eq(schema.projectItems.projectId, projectId), eq(schema.projectItems.itemKind, "project")));

  await db
    .update(schema.projects)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.projects.id, projectId));

  return true;
}

export type AddItemOutcome =
  | { ok: true; alreadyPresent: boolean }
  | { ok: false; reason: "project_not_found" }
  | { ok: false; reason: "item_not_found" };

/**
 * Add a reference — a note, bookmark, journal entry, or (kind 'project') an
 * existing project as a SUB-PROJECT.
 *
 * Two guards run before the write, in this order:
 *
 *   1. `filterOwnedRefs` — the target must belong to one of the caller's
 *      workspaces. A ref that fails is reported as `item_not_found`, never as
 *      "forbidden": a 403 would confirm the id exists somewhere. It runs FIRST
 *      because the nesting guard below reads the target's own edges, and
 *      answering `already_has_parent` about a project the caller cannot see
 *      would leak that project's shape.
 *   2. `assertNestable` — only for `kind === 'project'`. One parent per
 *      project, at most two levels, enforced here (the schema deliberately
 *      cannot express it). Throws `ProjectNestingError`, which the route turns
 *      into a 400 carrying the machine-readable `code`.
 */
export async function addItemToProject(input: {
  workspaceIds: string[];
  projectId: string;
  kind: ItemKind;
  itemId: string;
}): Promise<AddItemOutcome> {
  const project = await getProjectRow(input.workspaceIds, input.projectId);
  if (!project) return { ok: false, reason: "project_not_found" };

  // Ownership FIRST, structure second. The nesting guard reads the target's own
  // edges (its parent, its children), so running it before this check would let
  // a caller learn the shape of a project they cannot see — `already_has_parent`
  // on an id from another workspace is a leak, `item_not_found` is not.
  const owned = await filterOwnedRefs(input.workspaceIds, [
    { kind: input.kind, id: input.itemId },
  ]);
  if (owned.length === 0) return { ok: false, reason: "item_not_found" };

  if (input.kind === "project") {
    const [childParentId, childSubProjectCount, parentParentId] = await Promise.all([
      getProjectParentId(input.itemId),
      countSubProjects(input.itemId),
      getProjectParentId(input.projectId),
    ]);

    assertNestable({
      childId: input.itemId,
      parentId: input.projectId,
      childParentId,
      childSubProjectCount,
      parentParentId,
    });
  }

  const inserted = await db
    .insert(schema.projectItems)
    .values({ projectId: input.projectId, itemKind: input.kind, itemId: input.itemId })
    .onConflictDoNothing()
    .returning({ id: schema.projectItems.id });

  return { ok: true, alreadyPresent: inserted.length === 0 };
}

/** Remove a reference. Never a delete of the referenced thing. */
export async function removeItemFromProject(input: {
  workspaceIds: string[];
  projectId: string;
  kind: ItemKind;
  itemId: string;
}): Promise<{ ok: boolean }> {
  const project = await getProjectRow(input.workspaceIds, input.projectId);
  if (!project) return { ok: false };

  await db
    .delete(schema.projectItems)
    .where(
      and(
        eq(schema.projectItems.projectId, input.projectId),
        eq(schema.projectItems.itemKind, input.kind),
        eq(schema.projectItems.itemId, input.itemId),
      ),
    );

  return { ok: true };
}

/** Live sub-project count for one project (used by the nesting guard). */
export async function countSubProjects(projectId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.projectItems)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.projectItems.itemId))
    .where(
      and(
        eq(schema.projectItems.projectId, projectId),
        eq(schema.projectItems.itemKind, "project"),
        isNull(schema.projects.deletedAt),
      ),
    );
  return Number(rows[0]?.count ?? 0);
}

/** Build the context digest fed to a Plexo Work (living doc + grouped units). */
export function buildContextDigest(
  project: { id: string; name: string; livingDoc: string },
  groupedUnits: GroupedUnit[],
): ProjectContextDigest {
  const docDigest = project.livingDoc.replace(/<[^>]+>/g, " ").trim().slice(0, 2000);
  const unitList = groupedUnits.map((u) => `- (${u.kind}) ${u.title}`).join("\n");
  const summary = [
    `Project: ${project.name}`,
    docDigest ? `\nLiving document:\n${docDigest}` : "",
    groupedUnits.length ? `\nGrouped knowledge (${groupedUnits.length}):\n${unitList}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { projectId: project.id, name: project.name, summary, groupedUnits };
}

// ---- internals ------------------------------------------------------------

/** The one ownership-scoped project read. Every write path starts here. */
async function getProjectRow(workspaceIds: string[], projectId: string) {
  if (workspaceIds.length === 0) return null;
  const rows = await db
    .select()
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, projectId),
        inArray(schema.projects.workspaceId, workspaceIds),
        isNull(schema.projects.deletedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Batched parent lookup for a set of project ids (list rendering, no N+1). */
async function getParentIdsFor(projectIds: string[]): Promise<Map<string, string>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db
    .select({ childId: schema.projectItems.itemId, parentId: schema.projectItems.projectId })
    .from(schema.projectItems)
    .where(
      and(
        eq(schema.projectItems.itemKind, "project"),
        inArray(schema.projectItems.itemId, projectIds),
      ),
    );
  return new Map(rows.map((r) => [r.childId, r.parentId]));
}

/** The two list counts, batched for a set of project ids. */
async function summariseCounts(projectIds: string[]): Promise<{
  itemCounts: Map<string, number>;
  subProjectCounts: Map<string, number>;
}> {
  if (projectIds.length === 0) return { itemCounts: new Map(), subProjectCounts: new Map() };

  const [memberRows, subProjectRows] = await Promise.all([
    db
      .select({ projectId: schema.projectItems.projectId, count: sql<number>`count(*)::int` })
      .from(schema.projectItems)
      .where(
        and(inArray(schema.projectItems.projectId, projectIds), ne(schema.projectItems.itemKind, "project")),
      )
      .groupBy(schema.projectItems.projectId),
    db
      .select({ projectId: schema.projectItems.projectId, count: sql<number>`count(*)::int` })
      .from(schema.projectItems)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.projectItems.itemId))
      .where(
        and(
          inArray(schema.projectItems.projectId, projectIds),
          eq(schema.projectItems.itemKind, "project"),
          isNull(schema.projects.deletedAt),
        ),
      )
      .groupBy(schema.projectItems.projectId),
  ]);

  return {
    itemCounts: new Map(memberRows.map((r) => [r.projectId, Number(r.count)])),
    subProjectCounts: new Map(subProjectRows.map((r) => [r.projectId, Number(r.count)])),
  };
}
