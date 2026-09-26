"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { VoiceMemo } from "@/components/voice-memo";

export function CaptureBar({ workspaceId }: { workspaceId: string }) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [flash, setFlash] = useState(false);
  const router = useRouter();

  async function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter" || !value.trim() || submitting) return;
    const text = value.trim();
    setValue("");
    setSubmitting(true);

    await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, title: text, lifecycleState: "raw" }),
    });

    setSubmitting(false);
    setFlash(true);
    setTimeout(() => setFlash(false), 2000);
    router.refresh();
  }

  function handleVoiceCaptured() {
    setFlash(true);
    setTimeout(() => setFlash(false), 2000);
    router.refresh();
  }

  return (
    <div className="mb-6">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Capture a thought… (Enter to save)"
        disabled={submitting}
        className="w-full rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm outline-none focus:border-ring focus:bg-background transition-colors placeholder:text-muted-foreground disabled:opacity-50"
      />
      <div className="mt-2 flex items-center gap-2">
        <VoiceMemo workspaceId={workspaceId} onCaptured={handleVoiceCaptured} />
        {flash && <span className="text-xs text-green-500">Captured!</span>}
      </div>
    </div>
  );
}
