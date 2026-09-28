// SPDX-License-Identifier: MIT
// Projects — the container index. A server component: it reads the projects for
// the caller's workspace and renders the tree; the two interactive pieces (the
// create form and the lifecycle filter) are client components beside it.
//
// Layout follows ADR-0001 Amendment A1.7: roots as top-level rows, each root's
// sub-projects indented exactly one level under a disclosure, and a project that
// is itself a sub-project is never hidden because its parent is filtered out.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/server";
import { getUserWorkspaces } from "@/lib/workspace";
import { listProjects, type ProjectSummary } from "@/lib/projects/store";
import { FolderKanban, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { NewProjectForm } from "./new-project-form";

function LifecycleBadge({ state }: { state: ProjectSummary["lifecycleState"] }) {
  const variant = state === "active" ? "default" : state === "draft" ? "secondary" : "outline";
  return (
    <Badge variant={variant} className="capitalize">
      {state}
    </Badge>
  );
}

function ProjectRow({
  project,
  child,
  dimmed,
}: {
  project: ProjectSummary;
  child?: boolean;
  dimmed?: boolean;
}) {
  return (
    <Link
      href={`/app/projects/${project.id}`}
      className={`group flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-primary/40 hover:bg-muted/30 ${
        child ? "ml-6" : ""
      } ${dimmed ? "opacity-60" : ""}`}
    >
      {!child && <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" />}
      {child && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{project.name}</p>
        {project.description && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{project.description}</p>
        )}
      </div>

      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {project.itemCount} {project.itemCount === 1 ? "item" : "items"}
      </span>
      {!child && project.subProjectCount > 0 && (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {project.subProjectCount} sub
        </span>
      )}
      <LifecycleBadge state={project.lifecycleState} />
    </Link>
  );
}

export default async function ProjectsPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const workspaces = await getUserWorkspaces(user.id);
  const workspace = workspaces[0];
  if (!workspace) redirect("/app/dashboard");

  const projects = await listProjects(workspaces.map((ws) => ws.id));

  const byId = new Map(projects.map((p) => [p.id, p]));
  const roots = projects.filter((p) => !p.parentId || !byId.has(p.parentId));
  const childrenOf = (id: string) => projects.filter((p) => p.parentId === id);

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Containers that group your notes, bookmarks and journal entries — by reference. Nothing is
            moved or copied, and a project can hold at most one level of sub-projects.
          </p>
        </div>
      </header>

      <NewProjectForm workspaceId={workspace.id} />

      {projects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
          <FolderKanban className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium text-foreground">No projects yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            A project is a container you point at things you already have — a thread of work, a client,
            a topic. Create one above, then add notes, bookmarks, journal entries, or another project
            as a sub-project.
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {roots.map((root) => {
            const children = childrenOf(root.id);
            return (
              <div key={root.id} className="space-y-2">
                <ProjectRow project={root} dimmed={root.lifecycleState === "archived"} />
                {children.map((child) => (
                  <ProjectRow
                    key={child.id}
                    project={child}
                    child
                    dimmed={child.lifecycleState === "archived"}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
