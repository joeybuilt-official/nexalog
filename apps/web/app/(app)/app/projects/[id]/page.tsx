// SPDX-License-Identifier: MIT
// Project detail — the project's identity, its lifecycle, its living document,
// the knowledge it groups (by reference, so every title links to the real page),
// and its sub-projects.
//
// Server component: it reads with the store's ownership-scoped `getProject`, so
// a project id from another workspace is a 404 rather than a peek at someone
// else's tree. The interactive pieces (lifecycle, living doc, add/detach) are
// client components beside it.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/server";
import { getUserWorkspaces } from "@/lib/workspace";
import {
  getProject,
  getProjectNotes,
  listGroupableCandidates,
  loadProjectBriefSource,
  type GroupedUnit,
} from "@/lib/projects/store";
import {
  groupUnitsByKind,
  parentCandidates,
  MAX_PROJECT_DEPTH,
  type ItemKind,
} from "@/lib/projects/domain";
import { buildProjectNotesView } from "@/lib/projects/notes";
import { assembleProjectBriefInput } from "@/lib/projects/brief";
import { synthesizeProjectBrief } from "@/lib/projects/brief-service";
import { resolveIntelligence } from "@/lib/intelligence/resolve";
import { logEvent } from "@/lib/logger";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, FolderKanban, Notebook, Bookmark, FileText } from "lucide-react";
import { BriefSection } from "./brief-section";
import { ProjectControls } from "./project-controls";
import { ReparentControl } from "./reparent-control";
import { AddItemForm } from "./add-item-form";
import { RemoveItemButton } from "./remove-item-button";
import { NotesSection } from "./notes-section";

const KIND_LABEL: Record<ItemKind, string> = {
  note: "Notes",
  bookmark: "Bookmarks",
  journal: "Journal entries",
  project: "Projects",
};

const KIND_ICON: Record<ItemKind, typeof FileText> = {
  note: FileText,
  bookmark: Bookmark,
  journal: Notebook,
  project: FolderKanban,
};

/** The real page a reference resolves to. This is the point of the container:
 *  a project is a map, not a copy. */
function unitHref(unit: GroupedUnit): string {
  switch (unit.kind) {
    case "note":
      return `/app/notes/${unit.id}`;
    case "bookmark":
      return `/app/bookmarks/${unit.id}/reader`;
    case "journal":
      return unit.date ? `/app/journal/${unit.date}` : "/app/journal";
    case "project":
      return `/app/projects/${unit.id}`;
  }
}

function LifecycleBadge({ state }: { state: string }) {
  const variant = state === "active" ? "default" : state === "draft" ? "secondary" : "outline";
  return (
    <Badge variant={variant} className="capitalize">
      {state}
    </Badge>
  );
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const workspaces = await getUserWorkspaces(user.id);
  if (!workspaces.length) redirect("/app/dashboard");
  const workspaceIds = workspaces.map((ws) => ws.id);

  const project = await getProject(workspaceIds, id);
  if (!project) notFound();

  // The brief's source is loaded alongside the other reads — it needs the project
  // record (already in hand, so no second fetch of it) plus the linked notes'
  // metadata and the workspace themes. Nothing here reads a note body.
  const now = new Date();
  const [candidates, noteRows, briefSource] = await Promise.all([
    listGroupableCandidates(workspaceIds),
    getProjectNotes(workspaceIds, id),
    loadProjectBriefSource(workspaceIds, project),
  ]);

  // The pure module assembles the input; the use case synthesizes it through the
  // IntelligencePort. With no model configured this is the labelled fallback —
  // instant, and the page never blocks on a model it does not have.
  const briefInput = assembleProjectBriefInput(briefSource, { now });
  const brief = briefInput
    ? await synthesizeProjectBrief(briefInput, {
        intelligence: resolveIntelligence(),
        now,
        log: logEvent,
      })
    : null;

  // Grouped units are grouped by kind with the `project` kind separated out —
  // it IS the sub-project list, not a fourth pile of members.
  const subProjects = project.units.filter((u) => u.kind === "project");
  // NOTES are separated too, and for the same reason: they get their own section
  // (with a date and an excerpt, which a bare title row cannot carry) and rendering
  // them here as well would show every linked note twice on one page.
  const memberGroups = groupUnitsByKind(
    project.units.filter((u) => u.kind !== "project" && u.kind !== "note"),
  );
  const groupedCount = memberGroups.reduce((total, group) => total + group.units.length, 0);

  // Every list rule — which rows survive, the order, the excerpt, the empty copy —
  // is the pure module's. This page only hands it the rows.
  const notesView = buildProjectNotesView(noteRows);

  // A project that already has a parent cannot itself be a parent (two levels),
  // and one that has sub-projects cannot become a sub-project. Say both out loud
  // where they fire, instead of offering an action that will 400.
  const canBeParent = !project.parentId;
  // The domain's own picker rule, shared with the re-parent control and the
  // server-side guard, so the three cannot drift apart.
  const nestableProjects = parentCandidates(candidates.projects, project.id);

  return (
    <div className="mx-auto max-w-4xl">
      <nav className="mb-4 flex items-center gap-1 text-xs text-muted-foreground">
        <Link href="/app/projects" className="hover:text-foreground">
          Projects
        </Link>
        {project.parent && (
          <>
            <ChevronRight className="h-3 w-3" />
            <Link href={`/app/projects/${project.parent.id}`} className="hover:text-foreground">
              {project.parent.name}
            </Link>
          </>
        )}
        <ChevronRight className="h-3 w-3" />
        <span className="truncate text-foreground">{project.name}</span>
      </nav>

      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          <LifecycleBadge state={project.lifecycleState} />
        </div>
        {project.description && (
          <p className="mt-1 text-sm text-muted-foreground">{project.description}</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          {project.itemCount} {project.itemCount === 1 ? "member" : "members"}
          {project.subProjectCount > 0 &&
            ` · ${project.subProjectCount} ${project.subProjectCount === 1 ? "sub-project" : "sub-projects"}`}
        </p>
      </header>

      {/* The BRIEF — what this project is, synthesized from the knowledge below.
          Rendered from the server's own assembly so the first paint is complete;
          with no model configured it is the labelled mechanical digest. */}
      {brief && <BriefSection projectId={project.id} initialBrief={brief} />}

      <ProjectControls
        projectId={project.id}
        name={project.name}
        description={project.description}
        lifecycleState={project.lifecycleState}
        livingDoc={project.livingDoc}
      />

      {/* Where this project sits in the tree — the move/promote verb. Renaming,
          describing, the living doc and deleting already live in the controls
          above; this is the one hierarchy action that did not exist. */}
      <ReparentControl
        projectId={project.id}
        currentParentId={project.parentId}
        subProjectCount={project.subProjectCount}
        projects={candidates.projects}
      />

      {/* Sub-projects — projects nest two levels, so a project with a parent
          never shows this panel's "add" control. */}
      <section className="mt-8">
        <h2 className="mb-2 text-xs font-medium text-muted-foreground">
          Sub-projects {subProjects.length > 0 && `(${subProjects.length})`}
        </h2>

        {subProjects.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
            {project.parentId
              ? `No sub-projects. This project is itself a sub-project, and projects nest ${MAX_PROJECT_DEPTH} levels deep — so it cannot hold sub-projects of its own.`
              : "No sub-projects yet."}
          </p>
        ) : (
          <ul className="space-y-2">
            {subProjects.map((sub) => (
              <li
                key={sub.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
              >
                <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" />
                <Link
                  href={`/app/projects/${sub.id}`}
                  className="min-w-0 flex-1 truncate text-sm font-medium text-foreground hover:text-primary"
                >
                  {sub.title}
                </Link>
                <RemoveItemButton projectId={project.id} kind="project" itemId={sub.id} label="Remove" />
              </li>
            ))}
          </ul>
        )}

        {canBeParent ? (
          <div className="mt-3">
            <AddItemForm
              projectId={project.id}
              kind="project"
              label="Nest an existing project"
              options={nestableProjects.map((c) => ({ id: c.id, label: c.name }))}
              emptyHint="Every project is already nested, or none exist yet."
            />
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            This project has a parent, so it cannot itself hold sub-projects — projects nest{" "}
            {MAX_PROJECT_DEPTH} levels deep.
          </p>
        )}
      </section>

      {/* The project's NOTES — the richest list on the page, and the only one whose
          rows carry a date and an excerpt. A note's body is never loaded here: the
          rows link to the on-demand detail view. */}
      <NotesSection
        projectId={project.id}
        notes={notesView.notes}
        totalLinked={notesView.totalLinked}
        hiddenDeleted={notesView.hiddenDeleted}
      />

      {/* Grouped knowledge — each title links to the real page it lives on. Notes
          are NOT here: they have the section above, and one page does not render a
          note twice. */}
      <section className="mt-8">
        <h2 className="mb-2 text-xs font-medium text-muted-foreground">
          Grouped knowledge {groupedCount > 0 && `(${groupedCount})`}
        </h2>

        {memberGroups.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
            Nothing grouped here yet. Add a bookmark or a journal entry below — notes have their
            own section above, and this project references them, it never copies them.
          </p>
        ) : (
          <div className="space-y-4">
            {memberGroups.map((group) => {
              const Icon = KIND_ICON[group.kind];
              return (
                <div key={group.kind}>
                  <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" />
                    {KIND_LABEL[group.kind]}
                  </h3>
                  <ul className="space-y-1.5">
                    {group.units.map((unit) => (
                      <li
                        key={`${unit.kind}:${unit.id}`}
                        className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2"
                      >
                        <Link
                          href={unitHref(unit)}
                          className="min-w-0 flex-1 truncate text-sm text-foreground hover:text-primary"
                          title={unit.title}
                        >
                          {unit.title}
                        </Link>
                        <RemoveItemButton
                          projectId={project.id}
                          kind={unit.kind}
                          itemId={unit.id}
                          label="Remove"
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-xs font-medium text-muted-foreground">Add knowledge</h2>
        <AddItemForm
          projectId={project.id}
          kind="note"
          label="Add a note"
          options={candidates.notes.map((n) => ({ id: n.id, label: n.title }))}
          emptyHint="No notes yet."
        />
        <AddItemForm
          projectId={project.id}
          kind="bookmark"
          label="Add a bookmark"
          options={candidates.bookmarks.map((b) => ({ id: b.id, label: b.title }))}
          emptyHint="No bookmarks yet."
        />
        <AddItemForm
          projectId={project.id}
          kind="journal"
          label="Add a journal entry"
          options={candidates.journals.map((j) => ({ id: j.id, label: j.title }))}
          emptyHint="No journal entries yet."
        />
      </section>
    </div>
  );
}
