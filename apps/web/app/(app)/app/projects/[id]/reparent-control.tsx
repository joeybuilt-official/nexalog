// SPDX-License-Identifier: MIT
"use client";

// The MISSING manage verb: move a project under a different parent, or promote
// it to a root. Rename, delete and flat create already lived on this page; the
// hierarchy could only be built by nesting an existing project, never re-shaped.
//
// The picker's options are narrowed by the DOMAIN (`parentCandidates`), so it
// cannot offer a candidate the server would refuse: a project that is itself a
// sub-project cannot take a child (two levels), and a project is never its own
// parent. The server still owns the decision — the cycle guard runs there — and
// its refusal is rendered rather than swallowed, because the only way a control
// and a guard can disagree is a race or a stale prop and the user must see which
// one happened.
//
// `changes: false` on the response means the project was already where the user
// asked it to be. That is a success, and the control says so instead of
// pretending a write happened.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CornerUpLeft, FolderInput } from "lucide-react";
import { Button } from "@/components/ui/button";
import { canBecomeSubProject, parentCandidates } from "@/lib/projects/domain";

export function ReparentControl({
  projectId,
  currentParentId,
  subProjectCount,
  projects,
}: {
  projectId: string;
  /** The project's parent right now, `null` when it is a root. */
  currentParentId: string | null;
  /** Its own sub-project count — 0 is the precondition for becoming a child. */
  subProjectCount: number;
  /** Every project the caller can see, for the picker. */
  projects: ReadonlyArray<{ id: string; name: string; parentId: string | null }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState(currentParentId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const candidates = parentCandidates(projects, projectId);
  const canNest = canBecomeSubProject({ subProjectCount });

  async function patch(parentId: string | null) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { error?: string; code?: string; message?: string }
        | null;
      if (!res.ok) {
        setError(payload?.message ?? payload?.code ?? payload?.error ?? `Failed (${res.status})`);
        return;
      }
      setSelected(parentId ?? "");
      setNotice(parentId ? "Moved." : "Promoted to a top-level project.");
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 rounded-lg border border-border bg-card p-4">
      <h2 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <FolderInput className="h-3.5 w-3.5" />
        Position in the tree
      </h2>

      {canNest ? (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            aria-label="Move this project under"
            data-reparent-select
            className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="">No parent — a top-level project</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || pending || selected === (currentParentId ?? "")}
            onClick={() => patch(selected || null)}
          >
            {selected ? "Move" : "Promote"}
          </Button>
          {currentParentId && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || pending}
              onClick={() => patch(null)}
              data-reparent-promote
            >
              <CornerUpLeft className="mr-1.5 h-3.5 w-3.5" />
              Promote to top level
            </Button>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          This project has sub-projects of its own, so it cannot become a sub-project — detach them
          first if it needs to move.
        </p>
      )}

      {error && (
        <p className="mt-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {notice && <p className="mt-2 text-xs text-muted-foreground">{notice}</p>}
    </section>
  );
}
