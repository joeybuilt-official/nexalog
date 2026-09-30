// SPDX-License-Identifier: MIT
"use client";

// Create a project — as a ROOT, or as a SUB-PROJECT of an existing one. The only
// interactive piece on the list page: it POSTs to /api/projects and refreshes the
// server component, so the list stays a single server-rendered read.
//
// The parent picker's options come from the server as props (the list page is
// already holding every project) and are narrowed by the DOMAIN's rule
// (`parentCandidates`), not by a condition written here: a project that is itself
// a sub-project cannot take a child, so offering one would offer a guaranteed
// 400. A refusal that still reaches the server — a race against another tab, an
// id the list did not carry — is rendered as the server's own message rather than
// swallowed.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parentCandidates } from "@/lib/projects/domain";

export function NewProjectForm({
  workspaceId,
  projects,
}: {
  workspaceId: string;
  /**
   * Every project the caller can see, for the optional parent picker. Passed in
   * rather than fetched: the list page has already read them, and a second read
   * would be the same data.
   */
  projects: ReadonlyArray<{ id: string; name: string; parentId: string | null }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parentId, setParentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Derived, never a stored list: a project created or re-parented in another
  // tab arrives as a prop change and the options follow it.
  const parents = parentCandidates(projects, null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          description: description.trim() || null,
          workspaceId,
          // An empty select is "no parent". Sent as an explicit `null` rather
          // than omitted, so the request says what it means either way.
          parentId: parentId || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string; message?: string }
          | null;
        throw new Error(body?.message ?? body?.error ?? `Could not create the project (${res.status})`);
      }
      setName("");
      setDescription("");
      setParentId("");
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the project");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-start"
    >
      <div className="min-w-0 flex-1 space-y-2">
        <label className="block text-xs text-muted-foreground" htmlFor="project-name">
          Name
        </label>
        <input
          id="project-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New project…"
          maxLength={200}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <label className="block text-xs text-muted-foreground" htmlFor="project-description">
          Description <span className="text-muted-foreground/60">(optional)</span>
        </label>
        <input
          id="project-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What is this project about?"
          maxLength={4000}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        {parents.length > 0 && (
          <>
            <label className="block text-xs text-muted-foreground" htmlFor="project-parent">
              Sub-project of <span className="text-muted-foreground/60">(optional)</span>
            </label>
            <select
              id="project-parent"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">No parent — a top-level project</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      <Button type="submit" size="sm" disabled={submitting || pending || !name.trim()} className="sm:mt-6">
        <Plus className="mr-1.5 h-4 w-4" />
        New Project
      </Button>
    </form>
  );
}
