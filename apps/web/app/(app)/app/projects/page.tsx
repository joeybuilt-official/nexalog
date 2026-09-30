// SPDX-License-Identifier: MIT
// Projects — the container index. A server component: it reads the projects for
// the caller's workspace and hands them, whole, to the browser beside it. The
// interactive pieces (the create form and the browse controls) are client
// components; the rules the browsing applies live in the pure
// `lib/projects/browse` module, never in the components.
//
// Layout follows ADR-0001 Amendment A1.7: roots as top-level rows, each root's
// sub-projects indented exactly one level under a disclosure, and a project that
// is itself a sub-project is never hidden because its parent is filtered out.
// That last rule is a property of `browseProjects`, which renders the parent as
// a context row rather than dropping the child — see the module's header.

import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/server";
import { getUserWorkspaces } from "@/lib/workspace";
import { listProjects } from "@/lib/projects/store";
import { FolderKanban } from "lucide-react";
import { NewProjectForm } from "./new-project-form";
import { ProjectsBrowser } from "./projects-browser";

export default async function ProjectsPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const workspaces = await getUserWorkspaces(user.id);
  const workspace = workspaces[0];
  if (!workspace) redirect("/app/dashboard");

  const projects = await listProjects(workspaces.map((ws) => ws.id));

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
        <ProjectsBrowser projects={projects} />
      )}
    </div>
  );
}
