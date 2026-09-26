// SPDX-License-Identifier: MIT
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BookOpen, ArrowRight } from "lucide-react";

interface JournalPromoProps {
  workspaceId: string;
  date: string;
  initialBody: string | null;
}

const SAVE_DEBOUNCE_MS = 800;

export function JournalPromo({ workspaceId, date, initialBody }: JournalPromoProps) {
  const router = useRouter();
  const [body, setBody] = useState(initialBody ?? "");
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const isEmpty = !body.trim();

  function scheduleSave(next: string) {
    if (timer) clearTimeout(timer);
    const t = setTimeout(async () => {
      setSaving("saving");
      try {
        const res = await fetch(`/api/journal/${date}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, body: next }),
        });
        setSaving(res.ok ? "saved" : "error");
        if (res.ok) router.refresh();
      } catch {
        setSaving("error");
      }
    }, SAVE_DEBOUNCE_MS);
    setTimer(t);
  }

  return (
    <section className="mb-6 rounded-lg border border-border bg-card/60 p-4">
      <header className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Today&rsquo;s journal</h2>
        </div>
        <Link
          href={`/app/journal/${date}`}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Open full editor
          <ArrowRight className="h-3 w-3" />
        </Link>
      </header>
      {isEmpty && initialBody === null && (
        <p className="mb-2 text-xs text-muted-foreground">
          A journal isn&rsquo;t notes — it&rsquo;s today, in your own words. The system reads
          it, but only you ever see the entry.
        </p>
      )}
      <textarea
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          scheduleSave(e.target.value);
        }}
        placeholder="What happened today? What did you notice?"
        className="min-h-[6rem] w-full resize-y rounded-md border border-border bg-background p-3 text-sm leading-relaxed outline-none focus:border-ring"
      />
      <div className="mt-1 flex items-center justify-end gap-2 text-xs text-muted-foreground">
        {saving === "saving" && <span>Saving…</span>}
        {saving === "saved" && <span className="text-green-500">Saved</span>}
        {saving === "error" && <span className="text-destructive">Save failed</span>}
      </div>
    </section>
  );
}
