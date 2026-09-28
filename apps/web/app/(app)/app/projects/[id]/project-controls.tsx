// SPDX-License-Identifier: MIT
"use client";

// The mutating half of the detail page: lifecycle transitions, name/description
// edit, the living document, and the delete action.
//
// Lifecycle is NOT re-derived here. The control offers the moves the domain
// allows from the current state (`draft` and `archived` never offer each other),
// but the transition is validated server-side and a rejection comes back with
// the state the row is actually in — the client renders that message rather than
// pretending the click worked.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
import { canTransition, LIFECYCLE_STATES, type LifecycleState } from "@/lib/projects/domain";

const TRANSITION_LABEL: Record<LifecycleState, string> = {
  draft: "Move to draft",
  active: "Activate",
  archived: "Archive",
};

export function ProjectControls({
  projectId,
  name,
  description,
  lifecycleState,
  livingDoc,
}: {
  projectId: string;
  name: string;
  description: string | null;
  lifecycleState: LifecycleState;
  livingDoc: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [draftDescription, setDraftDescription] = useState(description ?? "");
  const [doc, setDoc] = useState(livingDoc);
  const [docSaved, setDocSaved] = useState(false);

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => null)) as
        | { error?: string; message?: string }
        | null;
      if (!res.ok) {
        setError(payload?.message ?? payload?.error ?? `Request failed (${res.status})`);
        return false;
      }
      startTransition(() => router.refresh());
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveMeta() {
    const ok = await patch({
      name: draftName.trim(),
      description: draftDescription.trim() || null,
    });
    if (ok) setEditing(false);
  }

  async function saveDoc() {
    const ok = await patch({ livingDoc: doc });
    if (ok) {
      setDocSaved(true);
      setTimeout(() => setDocSaved(false), 2000);
    }
  }

  async function remove() {
    const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
    if (res.ok) {
      startTransition(() => router.push("/app/projects"));
    } else {
      setError("Could not delete this project");
    }
  }

  const transitions = LIFECYCLE_STATES.filter(
    (s) => s !== lifecycleState && canTransition(lifecycleState, s),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              aria-label="Project name"
            />
            <input
              value={draftDescription}
              onChange={(e) => setDraftDescription(e.target.value)}
              placeholder="Description"
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              aria-label="Project description"
            />
            <Button size="sm" onClick={saveMeta} disabled={busy || !draftName.trim()}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)} disabled={busy}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              Edit details
            </Button>
            {transitions.map((to) => (
              <Button
                key={to}
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => patch({ lifecycleState: to })}
              >
                {TRANSITION_LABEL[to]}
              </Button>
            ))}
            <ConfirmButton
              onConfirm={remove}
              className="inline-flex h-7 items-center gap-1 rounded-[min(var(--radius-md),12px)] border border-border px-2.5 text-[0.8rem] font-medium text-muted-foreground hover:text-destructive"
              confirmLabel="Confirm delete?"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </ConfirmButton>
          </>
        )}
      </div>

      {error && (
        <p className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div>
        <label className="mb-1 block text-xs text-muted-foreground" htmlFor="living-doc">
          Living document
        </label>
        <textarea
          id="living-doc"
          value={doc}
          onChange={(e) => setDoc(e.target.value)}
          rows={6}
          placeholder="The project's working notes — context, decisions, links."
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <div className="mt-2 flex items-center gap-2">
          <Button size="sm" onClick={saveDoc} disabled={busy}>
            Save document
          </Button>
          {docSaved && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Check className="h-3.5 w-3.5" />
              Saved
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
