// SPDX-License-Identifier: MIT
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { ConfirmButton } from "@/components/confirm-button";
import { VoiceMemo } from "@/components/voice-memo";

type Initial = {
  body: string;
  mood: number | null;
  energy: number | null;
  voiceSourceId: string | null;
} | null;

type Props = {
  entryDate: string;
  workspaceId: string;
  initial: Initial;
};

const SAVE_DEBOUNCE_MS = 800;

function MarkdownPreview({ text }: { text: string }) {
  // Lightweight, dependency-free markdown shimmer for the preview pane.
  // Heading (# / ## / ###), bold (**…**), italic (*…* / _…_), inline code (`…`),
  // bullets (- / *), and paragraph splitting on blank lines.
  if (!text.trim()) {
    return (
      <p className="text-sm italic text-muted-foreground">
        Preview appears here.
      </p>
    );
  }

  const blocks = text.split(/\n{2,}/);
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none space-y-3 text-sm">
      {blocks.map((block, bi) => {
        const lines = block.split("\n");
        if (/^#\s+/.test(lines[0])) {
          return (
            <h1 key={bi} className="text-lg font-semibold">
              {inline(lines[0].replace(/^#\s+/, ""))}
            </h1>
          );
        }
        if (/^##\s+/.test(lines[0])) {
          return (
            <h2 key={bi} className="text-base font-semibold">
              {inline(lines[0].replace(/^##\s+/, ""))}
            </h2>
          );
        }
        if (/^###\s+/.test(lines[0])) {
          return (
            <h3 key={bi} className="text-sm font-semibold">
              {inline(lines[0].replace(/^###\s+/, ""))}
            </h3>
          );
        }
        if (lines.every((l) => /^[-*]\s+/.test(l))) {
          return (
            <ul key={bi} className="list-disc space-y-1 pl-5">
              {lines.map((l, li) => (
                <li key={li}>{inline(l.replace(/^[-*]\s+/, ""))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={bi} className="whitespace-pre-wrap">
            {inline(block)}
          </p>
        );
      })}
    </div>
  );
}

function inline(s: string): React.ReactNode {
  // Tokenize bold, italic, code in one pass — non-overlapping.
  const tokens: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|_[^_]+_)/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(s)) !== null) {
    if (m.index > lastIdx) tokens.push(s.slice(lastIdx, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      tokens.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      tokens.push(
        <code key={key++} className="rounded bg-muted px-1 py-0.5 text-[12px]">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("*") || tok.startsWith("_")) {
      tokens.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    }
    lastIdx = m.index + tok.length;
  }
  if (lastIdx < s.length) tokens.push(s.slice(lastIdx));
  return tokens;
}

export function JournalEntryEditor({ entryDate, workspaceId, initial }: Props) {
  const router = useRouter();
  const [body, setBody] = useState(initial?.body ?? "");
  const [mood, setMood] = useState<number | null>(initial?.mood ?? null);
  const [energy, setEnergy] = useState<number | null>(initial?.energy ?? null);
  const [voiceSourceId, setVoiceSourceId] = useState<string | null>(initial?.voiceSourceId ?? null);
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>(JSON.stringify({ body: initial?.body ?? "", mood: initial?.mood ?? null, energy: initial?.energy ?? null, voiceSourceId: initial?.voiceSourceId ?? null }));

  const persist = useCallback(
    async (payload: {
      body: string;
      mood: number | null;
      energy: number | null;
      voiceSourceId: string | null;
    }) => {
      const fingerprint = JSON.stringify(payload);
      if (fingerprint === lastSavedRef.current) {
        setSaving("idle");
        return;
      }
      setSaving("saving");
      try {
        const res = await fetch(`/api/journal/${entryDate}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, ...payload }),
        });
        if (!res.ok) {
          setSaving("error");
          return;
        }
        lastSavedRef.current = fingerprint;
        setSaving("saved");
      } catch {
        setSaving("error");
      }
    },
    [entryDate, workspaceId],
  );

  // Debounced auto-save on any field change.
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void persist({ body, mood, energy, voiceSourceId });
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [body, mood, energy, voiceSourceId, persist]);

  async function handleDelete() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await fetch(`/api/journal/${entryDate}`, { method: "DELETE" });
    router.push("/app/journal");
    router.refresh();
  }

  function handleVoiceCaptured(text: string) {
    // Append the transcript to the journal body, prefix with a divider
    // if there's already content.
    setBody((prev) => (prev.trim() ? `${prev.trim()}\n\n${text}` : text));
    // Voice memos save to /api/capture as 'voice' kind — we don't have
    // its capture id back yet, so leave voiceSourceId untouched.
    setVoiceSourceId((v) => v ?? "voice-memo");
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <MoodEnergyPicker label="Mood" value={mood} onChange={setMood} />
        <MoodEnergyPicker label="Energy" value={energy} onChange={setEnergy} />
        <VoiceMemo workspaceId={workspaceId} onCaptured={handleVoiceCaptured} />
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {saving === "saving" && <span>Saving…</span>}
          {saving === "saved" && <span className="text-green-500">Saved</span>}
          {saving === "error" && <span className="text-destructive">Save failed</span>}
        </div>
      </div>

      <div className="mb-2 flex items-center justify-between">
        <div className="inline-flex rounded-md border border-border bg-muted/30 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setShowPreview(false)}
            className={`rounded px-2 py-1 ${!showPreview ? "bg-card text-foreground" : "text-muted-foreground"}`}
          >
            Write
          </button>
          <button
            type="button"
            onClick={() => setShowPreview(true)}
            className={`rounded px-2 py-1 ${showPreview ? "bg-card text-foreground" : "text-muted-foreground"}`}
          >
            Preview
          </button>
        </div>
        <ConfirmButton
          onConfirm={handleDelete}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-destructive transition-colors"
          confirmLabel={
            <span className="text-[11px] font-bold text-destructive">Click again to delete</span>
          }
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete entry
        </ConfirmButton>
      </div>

      {showPreview ? (
        <div className="min-h-[24rem] rounded-md border border-border bg-card/40 p-4">
          <MarkdownPreview text={body} />
        </div>
      ) : (
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What happened today? What did you notice? Markdown welcome."
          className="min-h-[24rem] w-full resize-y rounded-md border border-border bg-background p-4 font-mono text-sm leading-relaxed outline-none focus:border-ring"
        />
      )}
    </div>
  );
}

function MoodEnergyPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="inline-flex overflow-hidden rounded-md border border-border">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(value === n ? null : n)}
            className={`px-2 py-1 text-xs transition-colors ${
              value === n
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
            aria-label={`${label} ${n}`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
