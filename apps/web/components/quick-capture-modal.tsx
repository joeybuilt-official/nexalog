// SPDX-License-Identifier: MIT
"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Zap, Link2, FileText, Mic, Loader2, CheckCircle2, X } from "lucide-react";
import { useModals } from "@/components/modal-context";
import { captureOrQueue } from "@/lib/offline/captureOrQueue";

type CaptureKind = "url" | "text" | "markdown";

function detectKind(val: string): CaptureKind {
  const trimmed = val.trim();
  if (/^https?:\/\/\S+/.test(trimmed)) return "url";
  if (trimmed.startsWith("# ") || trimmed.includes("\n## ") || trimmed.includes("\n- ")) return "markdown";
  return "text";
}

export function QuickCaptureModal() {
  const { captureOpen: open, setCaptureOpen: setOpen } = useModals();
  const [value, setValue] = useState("");
  const [kind, setKind] = useState<CaptureKind>("text");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "c") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      prevFocus.current = document.activeElement as HTMLElement | null;
      setValue("");
      setKind("text");
      setDone(false);
      setTimeout(() => ref.current?.focus(), 50);
    } else {
      prevFocus.current?.focus?.();
    }
  }, [open]);

  function trapTab(e: React.KeyboardEvent) {
    if (e.key !== "Tab" || !panelRef.current) return;
    const f = panelRef.current.querySelectorAll<HTMLElement>(
      'button, textarea, input, [href], [tabindex]:not([tabindex="-1"])'
    );
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setValue(val);
    setKind(detectKind(val));
  }

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!value.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { queued } = await captureOrQueue({ kind, content: value.trim(), url: kind === "url" ? value.trim() : undefined });
      setDone(true);
      if (queued) setError("You're offline — saved for later.");
      setTimeout(() => {
        setOpen(false);
        setDone(false);
        setValue("");
        setError(null);
      }, 900);
    } catch {
      setError("Network error — your capture wasn't saved. Try again.");
    } finally {
      setSubmitting(false);
    }
  }, [value, kind, submitting]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      handleSubmit();
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/60 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Quick capture"
        className="w-full max-w-xl rounded-2xl border border-border bg-background shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapTab}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Zap className="h-4 w-4 shrink-0 text-copper" />
          <span className="text-sm font-medium text-foreground">Quick capture</span>
          <div className="ml-auto flex items-center gap-2">
            {kind === "url" && <span title="URL detected"><Link2 className="h-3.5 w-3.5 text-blue-400" /></span>}
            {kind === "markdown" && <span title="Markdown detected"><FileText className="h-3.5 w-3.5 text-green-400" /></span>}
            {kind === "text" && <span title="Text"><Mic className="h-3.5 w-3.5 text-muted-foreground" /></span>}
            <button onClick={() => setOpen(false)} aria-label="Close" className="rounded p-1 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <textarea
            ref={ref}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Paste a URL, type a thought, or drop Markdown…"
            rows={5}
            className="w-full resize-none bg-transparent px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />

          <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
            <span className="text-xs text-muted-foreground">
              {error ? (
                <span role="alert" className="text-red-400">{error}</span>
              ) : (
                <>{kind === "url" ? "URL capture" : kind === "markdown" ? "Markdown note" : "Text note"} · ⌘↵ to save</>
              )}
            </span>
            <button
              type="submit"
              disabled={!value.trim() || submitting}
              className="flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:bg-foreground/90 disabled:opacity-40 transition-colors"
            >
              {done ? (
                <><CheckCircle2 className="h-3.5 w-3.5" /> Saved</>
              ) : submitting ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
              ) : (
                "Save"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
