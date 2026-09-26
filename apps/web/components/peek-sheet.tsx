// SPDX-License-Identifier: MIT
"use client";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { usePeek } from "./peek-context";

type NotePreview = { id: string; title: string; content: string | object };

function stripMarkdown(s: string) {
  return s.replace(/[#*`[\]()]/g, "").slice(0, 800);
}

function NotePane({ id }: { id: string }) {
  const [note, setNote] = useState<NotePreview | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    fetch(`/api/notes/resolve?ref=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: NotePreview) => setNote(d))
      .catch(() => setErr(true));
  }, [id]);

  if (err) return <p className="text-sm text-muted-foreground">Not found.</p>;
  if (!note)
    return <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>;
  const body =
    typeof note.content === "string"
      ? note.content
      : JSON.stringify(note.content);
  return (
    <div>
      <h2 className="text-base font-semibold mb-2">{note.title || "Untitled"}</h2>
      <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-[12]">
        {stripMarkdown(body)}
      </p>
    </div>
  );
}

export function PeekSheet() {
  const { item, open, close } = usePeek();
  const visible = item !== null;

  // ESC to close
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [visible, close]);

  // Intercept wikilink anchor clicks globally → open peek instead of navigate
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest(
        "a[data-wikilink]",
      ) as HTMLAnchorElement | null;
      if (!target) return;
      e.preventDefault();
      const match = target.href.match(/\/app\/notes\/([^/?#]+)/);
      if (match?.[1]) open({ type: "note", id: match[1] });
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [open]);

  return (
    <>
      {visible && (
        <div
          className="fixed inset-0 z-40 bg-black/30"
          onClick={close}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed inset-y-0 right-0 z-50 w-80 bg-background border-l border-border shadow-xl flex flex-col transform transition-transform duration-200 ${
          visible ? "translate-x-0" : "translate-x-full"
        }`}
        aria-label="Peek panel"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <span className="text-sm font-medium">Preview</span>
          <button
            onClick={close}
            className="rounded p-1 hover:bg-muted"
            aria-label="Close peek"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {item?.type === "note" && <NotePane key={item.id} id={item.id} />}
          {item?.type === "queue" && (
            <div>
              <h2 className="text-base font-semibold mb-2">
                {item.title || "Untitled"}
              </h2>
              {item.reason && (
                <p className="text-sm text-muted-foreground mb-3">
                  {item.reason}
                </p>
              )}
              {item.url && (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-500 underline"
                >
                  Open →
                </a>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
