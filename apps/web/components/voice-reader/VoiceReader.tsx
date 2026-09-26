// SPDX-License-Identifier: MIT
"use client";

/**
 * Floating "read me my unread" control. Plays the daily queue as a
 * pseudo-podcast: title + per-item summary, one item at a time.
 *
 * Activates when `open=true`. Host renders a "Listen" trigger and toggles.
 */

import { Pause, Play, SkipForward, Volume2, X } from "lucide-react";
import { useVoiceQueue } from "./useVoiceQueue";

interface VoiceReaderProps {
  open: boolean;
  onClose: () => void;
}

const SPEED_OPTIONS = [0.85, 1, 1.15, 1.3, 1.6];

export function VoiceReader({ open, onClose }: VoiceReaderProps) {
  const q = useVoiceQueue();

  if (!open) return null;

  const idle = !q.playing && !q.loading && q.items.length === 0;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[min(380px,calc(100vw-2rem))] rounded-lg border border-border bg-card p-3 shadow-lg">
      <div className="flex items-start gap-2">
        <Volume2 className="mt-0.5 h-4 w-4 text-[var(--synthesis)]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Listen · queue
            </p>
            <button
              type="button"
              onClick={() => {
                q.stop();
                onClose();
              }}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {q.error ? (
            <p className="mt-1 text-xs text-destructive">{q.error}</p>
          ) : null}

          {idle ? (
            <div className="mt-2">
              <p className="text-sm text-foreground">Read your unread queue.</p>
              <button
                type="button"
                onClick={() => void q.start()}
                disabled={q.loading}
                className="mt-2 inline-flex items-center gap-1.5 rounded bg-[var(--synthesis)] px-3 py-1.5 text-xs font-medium text-[var(--synthesis-fg)] hover:opacity-90 disabled:opacity-50"
              >
                <Play className="h-3 w-3" /> {q.loading ? "Loading…" : "Start"}
              </button>
            </div>
          ) : (
            <div className="mt-1">
              <p className="truncate text-sm font-medium" title={q.current?.title}>
                {q.current?.title ?? "—"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {q.current?.host} · item {q.index + 1} of {q.items.length}
              </p>

              <div className="mt-3 flex items-center gap-1.5">
                {q.playing ? (
                  <button
                    type="button"
                    onClick={q.pause}
                    className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-muted"
                    aria-label="Pause"
                  >
                    <Pause className="h-3 w-3" /> Pause
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={q.resume}
                    className="inline-flex items-center gap-1 rounded bg-[var(--synthesis)] px-2 py-1 text-xs font-medium text-[var(--synthesis-fg)] hover:opacity-90"
                    aria-label="Play"
                  >
                    <Play className="h-3 w-3" /> Play
                  </button>
                )}
                <button
                  type="button"
                  onClick={q.next}
                  className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-muted"
                  aria-label="Skip"
                >
                  <SkipForward className="h-3 w-3" /> Skip
                </button>
                <select
                  value={q.speed}
                  onChange={(e) => q.setSpeed(Number(e.target.value))}
                  className="ml-auto rounded border border-border bg-background px-1.5 py-1 text-xs"
                  aria-label="Playback speed"
                >
                  {SPEED_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}×
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
