// SPDX-License-Identifier: MIT
"use client";

// Pick an existing unit and reference it into this project. One component, one
// kind per instance — the parent page renders one per kind (note, bookmark,
// journal, and project for sub-projects) so each list stays legible and the
// options can be fetched server-side.
//
// A `kind: "project"` add is the sub-project path: the server enforces the
// nesting rules (one parent, two levels) and answers 400 `invalid_nesting` with
// a `code` when it refuses — the message is rendered here rather than the
// failure being swallowed.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AddItemForm({
  projectId,
  kind,
  label,
  options,
  emptyHint,
}: {
  projectId: string;
  kind: "note" | "bookmark" | "journal" | "project";
  label: string;
  options: Array<{ id: string; label: string }>;
  emptyHint?: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || busy) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id: selected }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { error?: string; code?: string; message?: string; alreadyPresent?: boolean }
        | null;
      if (!res.ok) {
        // The nesting guard's refusal is the one error a user will actually hit
        // here — surface its message (one parent, two levels) verbatim.
        setError(payload?.message ?? payload?.code ?? payload?.error ?? `Failed (${res.status})`);
        return;
      }
      setSelected("");
      setError(null);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (options.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyHint ?? "Nothing to add yet."}</p>;
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label={label}
      >
        <option value="">{label}…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" variant="outline" disabled={busy || !selected}>
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        Add
      </Button>
      {error && <p className="basis-full text-xs text-destructive">{error}</p>}
    </form>
  );
}
