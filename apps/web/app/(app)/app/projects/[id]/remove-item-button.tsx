// SPDX-License-Identifier: MIT
"use client";

// Detach a reference. Two-step (ConfirmButton) like every other destructive
// action in this app, but the copy says the truthful thing: removing a
// reference never deletes the thing it pointed at (ADR-0018 §D5).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { ConfirmButton } from "@/components/confirm-button";

export function RemoveItemButton({
  projectId,
  kind,
  itemId,
  label,
}: {
  projectId: string;
  kind: "note" | "bookmark" | "journal" | "project";
  itemId: string;
  label?: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`/api/projects/${projectId}/items`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id: itemId }),
      });
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmButton
      onConfirm={remove}
      disabled={busy}
      className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
      confirmLabel={<span className="px-1 text-[10px] font-bold text-destructive">Detach?</span>}
      timeoutMs={4000}
    >
      <X className="h-4 w-4" />
      <span className="sr-only">{label ?? "Remove from project"}</span>
    </ConfirmButton>
  );
}
