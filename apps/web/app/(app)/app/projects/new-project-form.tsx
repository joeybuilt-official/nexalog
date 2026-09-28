// SPDX-License-Identifier: MIT
"use client";

// Create a project. The only interactive piece on the list page — it POSTs to
// /api/projects and refreshes the server component, so the list stays a single
// server-rendered read.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export function NewProjectForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Could not create the project (${res.status})`);
      }
      setName("");
      setDescription("");
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
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      <Button type="submit" size="sm" disabled={submitting || pending || !name.trim()} className="sm:mt-6">
        <Plus className="mr-1.5 h-4 w-4" />
        New Project
      </Button>
    </form>
  );
}
