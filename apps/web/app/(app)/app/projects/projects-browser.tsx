// SPDX-License-Identifier: MIT
"use client";

// The browsing half of the projects list: search, lifecycle filter, the
// has-sub-projects toggle, and sort. It owns only the *state* of those controls
// and the shape of the rows — every rule (what matches, what order, and the
// A1.7 guarantee that a matching sub-project is never hidden by a filtered-out
// parent) lives in the pure `lib/projects/browse` module, which is unit-tested
// without React. Nothing here re-derives a filter.
//
// The list arrives whole from the server component: 38 projects is not a data
// set worth a round trip, and filtering in the client is what makes the search
// instant. Nothing refetches while the reader types.

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileText, FolderKanban, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DEFAULT_BROWSE_STATE,
  LIFECYCLE_FILTERS,
  PROJECT_SORTS,
  PROJECT_SORT_LABELS,
  browseProjects,
  countMatches,
  countRenderedRows,
  type BrowsableProject,
  type BrowseState,
  type LifecycleFilter,
} from "@/lib/projects/browse";
import type { LifecycleState } from "@/lib/projects/domain";

const CONTROL_CLASS =
  "rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const LIFECYCLE_LABEL: Record<LifecycleFilter, string> = {
  all: "All states",
  draft: "Draft",
  active: "Active",
  archived: "Archived",
};

function LifecycleBadge({ state }: { state: LifecycleState }) {
  const variant = state === "active" ? "default" : state === "draft" ? "secondary" : "outline";
  return (
    <Badge variant={variant} className="capitalize">
      {state}
    </Badge>
  );
}

/**
 * One row. `child` is the one-level indent under a root; `contextOnly` marks a
 * row rendered ONLY because a matching sub-project needs its parent (A1.7) —
 * it says so, rather than looking like an ordinary search hit.
 */
function ProjectRow({
  project,
  child,
  contextOnly,
  disclosure,
}: {
  project: BrowsableProject;
  child?: boolean;
  contextOnly?: boolean;
  disclosure?: { expanded: boolean; toggle: () => void };
}) {
  return (
    <div className={`flex items-center gap-1 ${child ? "ml-6" : ""}`}>
      <span className="flex w-5 shrink-0 justify-center">
        {disclosure && (
          <button
            type="button"
            onClick={disclosure.toggle}
            aria-expanded={disclosure.expanded}
            aria-label={
              disclosure.expanded ? "Collapse sub-projects" : "Expand sub-projects"
            }
            data-disclosure={project.id}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          >
            {disclosure.expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        )}
      </span>

      <Link
        href={`/app/projects/${project.id}`}
        data-project-row={project.id}
        data-context-row={contextOnly ? "true" : "false"}
        className={`group flex min-w-0 flex-1 items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-primary/40 hover:bg-muted/30 ${
          child ? "border-l-2 border-l-primary/30" : ""
        } ${contextOnly ? "opacity-60" : ""}`}
      >
        {child ? (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
        ) : (
          <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{project.name}</p>
          {project.description && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground" title={project.description}>
              {project.description}
            </p>
          )}
          {contextOnly && (
            <p className="mt-0.5 text-xs text-muted-foreground/80">
              Shown because a sub-project matches.
            </p>
          )}
        </div>

        <span
          className="shrink-0 text-xs tabular-nums text-muted-foreground"
          title={`${project.itemCount} grouped ${project.itemCount === 1 ? "item" : "items"}`}
        >
          {project.itemCount} {project.itemCount === 1 ? "item" : "items"}
        </span>
        {!child && project.subProjectCount > 0 && (
          <span
            className="shrink-0 text-xs tabular-nums text-muted-foreground"
            title={`${project.subProjectCount} sub-${project.subProjectCount === 1 ? "project" : "projects"}`}
          >
            {project.subProjectCount} sub
          </span>
        )}
        {project.livingDocUpdatedAt && (
          <Badge variant="outline" title="This project has a living document">
            <FileText className="h-3 w-3" />
            Summary
          </Badge>
        )}
        <LifecycleBadge state={project.lifecycleState} />
      </Link>
    </div>
  );
}

export function ProjectsBrowser({ projects }: { projects: BrowsableProject[] }) {
  const [state, setState] = useState<BrowseState>(DEFAULT_BROWSE_STATE);
  // Collapsed roots, by id. A root whose children are the match (a context row)
  // is never collapsible — collapsing it would hide the row the reader searched
  // for, which is the one thing A1.7 forbids.
  const [collapsed, setCollapsed] = useState<readonly string[]>([]);

  const groups = useMemo(() => browseProjects(projects, state), [projects, state]);

  const matched = useMemo(() => countMatches(projects, state), [projects, state]);

  const filtering =
    state.query.trim() !== "" ||
    state.lifecycle !== DEFAULT_BROWSE_STATE.lifecycle ||
    state.hasSubProjectsOnly ||
    state.sort !== DEFAULT_BROWSE_STATE.sort;

  function toggleCollapsed(id: string) {
    setCollapsed((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]));
  }

  const rowCount = countRenderedRows(groups);

  return (
    <div className="mt-4 space-y-3" data-browse-groups={groups.length} data-browse-rows={rowCount}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={state.query}
            onChange={(e) => setState((s) => ({ ...s, query: e.target.value }))}
            placeholder="Search name or description…"
            aria-label="Search projects"
            data-project-search
            className={`${CONTROL_CLASS} w-full pl-8`}
          />
          {state.query !== "" && (
            <button
              type="button"
              onClick={() => setState((s) => ({ ...s, query: "" }))}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <select
          value={state.lifecycle}
          onChange={(e) =>
            setState((s) => ({ ...s, lifecycle: e.target.value as LifecycleFilter }))
          }
          aria-label="Filter by lifecycle state"
          data-project-lifecycle-filter
          className={CONTROL_CLASS}
        >
          {LIFECYCLE_FILTERS.map((filter) => (
            <option key={filter} value={filter}>
              {LIFECYCLE_LABEL[filter]}
            </option>
          ))}
        </select>

        <select
          value={state.sort}
          onChange={(e) => setState((s) => ({ ...s, sort: e.target.value as BrowseState["sort"] }))}
          aria-label="Sort projects"
          data-project-sort
          className={CONTROL_CLASS}
        >
          {PROJECT_SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {PROJECT_SORT_LABELS[sort]}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={state.hasSubProjectsOnly}
            onChange={(e) => setState((s) => ({ ...s, hasSubProjectsOnly: e.target.checked }))}
            data-project-has-sub-projects
            className="h-3.5 w-3.5 accent-primary"
          />
          Has sub-projects
        </label>

        {filtering && (
          <button
            type="button"
            onClick={() => setState(DEFAULT_BROWSE_STATE)}
            className="rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            Reset
          </button>
        )}
      </div>

      <p className="text-xs text-muted-foreground" data-project-match-count={matched}>
        {filtering
          ? `Showing ${groups.length} of ${projects.length} ${
              projects.length === 1 ? "project" : "projects"
            } — ${matched} match${matched === 1 ? "" : "es"}, plus ${
              rowCount - matched
            } shown for context.`
          : `${projects.length} ${projects.length === 1 ? "project" : "projects"}.`}
      </p>

      {groups.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
          <Search className="mx-auto h-6 w-6 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium text-foreground">No projects match</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Nothing here matches that search and filter combination. Widen it, or reset the
            controls.
          </p>
          <button
            type="button"
            onClick={() => setState(DEFAULT_BROWSE_STATE)}
            className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted/40"
          >
            Reset controls
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => {
            const kids = group.children;
            // A context row is rendered FOR its child, so it stays open.
            const expanded = group.contextOnly || !collapsed.includes(group.parent.id);
            return (
              <div key={group.parent.id} className="space-y-2">
                <ProjectRow
                  project={group.parent}
                  contextOnly={group.contextOnly}
                  disclosure={
                    group.contextOnly || kids.length === 0
                      ? undefined
                      : {
                          expanded,
                          toggle: () => toggleCollapsed(group.parent.id),
                        }
                  }
                />
                {expanded &&
                  kids.map((child) => (
                    <ProjectRow key={child.id} project={child} child />
                  ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
