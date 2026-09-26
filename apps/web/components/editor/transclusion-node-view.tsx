"use client";

import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useEffect, useState } from "react";

type ResolvedNote = { id: string; title: string; content: string };
type State =
  | { status: "loading" }
  | { status: "ok"; note: ResolvedNote }
  | { status: "error"; ref: string };

export function TransclusionNodeView({ node }: NodeViewProps) {
  const ref = (node.attrs["ref"] as string | null) ?? "";
  const [state, setState] = useState<State>(
    ref ? { status: "loading" } : { status: "error", ref: "" }
  );

  useEffect(() => {
    if (!ref) return;
    let cancelled = false;
    fetch(`/api/notes/resolve?ref=${encodeURIComponent(ref)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) { setState({ status: "error", ref }); return; }
        const data = (await res.json()) as ResolvedNote;
        setState({ status: "ok", note: data });
      })
      .catch(() => { if (!cancelled) setState({ status: "error", ref }); });
    return () => { cancelled = true; };
  }, [ref]);

  return (
    <NodeViewWrapper>
      <div
        className="transclusion-block my-2 rounded-md border border-border bg-muted/30 px-4 py-3 text-sm"
        data-transclusion={ref}
        contentEditable={false}
      >
        {state.status === "loading" && (
          <span className="text-muted-foreground italic">Loading ![[{ref}]]…</span>
        )}
        {state.status === "error" && (
          <span className="text-destructive/80">[[{ref}]] — note not found</span>
        )}
        {state.status === "ok" && (
          <div>
            <p className="mb-1 font-medium text-foreground">{state.note.title}</p>
            <div
              className="prose prose-sm dark:prose-invert max-w-none line-clamp-6 pointer-events-none select-none opacity-80"
              dangerouslySetInnerHTML={{ __html: state.note.content }}
            />
            <a
              href={`/app/notes/${state.note.id}`}
              className="mt-1 inline-block text-xs text-muted-foreground underline hover:text-foreground"
              target="_blank"
              rel="noreferrer"
            >
              Open note →
            </a>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}
