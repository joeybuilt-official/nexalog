"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface PendingSuggestion {
  kind: string;
  confidence: number;
  properties: Record<string, unknown>;
}

export function InboxSuggestionChip({
  captureId,
  suggestion,
}: {
  captureId: string;
  suggestion: PendingSuggestion;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  async function accept() {
    setBusy(true);
    try {
      await fetch("/api/typed-objects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: suggestion.kind, data: { ...suggestion.properties, captureId } }),
      });
      await fetch("/api/capture/classify/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captureId }),
      });
      setDismissed(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    setBusy(true);
    try {
      await fetch("/api/capture/classify/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captureId }),
      });
      setDismissed(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="mt-2 flex items-center gap-2 rounded border border-indigo-400/40 bg-indigo-50/30 px-2 py-1 text-xs dark:bg-indigo-950/30"
      onClick={(e) => e.preventDefault()}
    >
      <span className="text-indigo-700 dark:text-indigo-300 font-medium">
        This looks like a <span className="font-semibold">{suggestion.kind}</span>.
        Use this type?
      </span>
      <button
        onClick={accept}
        disabled={busy}
        className="rounded border border-indigo-400/60 bg-indigo-600 px-2 py-0.5 text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        ✓ Accept
      </button>
      <button
        onClick={skip}
        disabled={busy}
        className="rounded border border-border px-2 py-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        Skip
      </button>
    </div>
  );
}
