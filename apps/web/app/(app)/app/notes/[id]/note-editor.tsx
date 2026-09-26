"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Link2, Mic, Trash2 } from "lucide-react";
import { RichEditor } from "@/components/editor/rich-editor";
import { ConfirmButton } from "@/components/confirm-button";
import { NoteChatPanel } from "@/components/note-chat-panel";

type Note = {
  id: string;
  title: string;
  content: string;
  updatedAt: Date;
};

type BacklinkNote = {
  id: string;
  title: string;
  updatedAt: string;
};

type Props = {
  note: Note;
  backlinks: BacklinkNote[];
  audioSrc?: string | null;
};

type Mention = { id: string; title: string };

export function NoteEditor({ note, backlinks, audioSrc }: Props) {
  const [title, setTitle] = useState(note.title);
  const [saving, setSaving] = useState(false);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [linking, setLinking] = useState<string | null>(null);
  const router = useRouter();
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/notes/${note.id}/unlinked-mentions`)
      .then((r) => (r.ok ? r.json() : { mentions: [] }))
      .then((d) => {
        if (active) setMentions(d.mentions ?? []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [note.id]);

  async function handleLink(targetNoteId: string) {
    setLinking(targetNoteId);
    const res = await fetch(`/api/notes/${note.id}/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetNoteId }),
    });
    setLinking(null);
    if (res.ok) {
      setMentions((prev) => prev.filter((m) => m.id !== targetNoteId));
      router.refresh();
    }
  }

  const saveTitle = useCallback(
    async (nextTitle: string) => {
      setSaving(true);
      await fetch(`/api/notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: nextTitle }),
      });
      setSaving(false);
    },
    [note.id]
  );

  function handleTitleChange(value: string) {
    setTitle(value);
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(() => saveTitle(value), 1000);
  }

  function handleTitleBlur() {
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    saveTitle(title).then(() => router.refresh());
  }

  async function handleDelete() {
    const res = await fetch(`/api/notes/${note.id}`, { method: "DELETE" });
    if (res.ok) router.push("/app/notes");
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center gap-2">
        <Link
          href="/app/notes"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Notes
        </Link>
        {saving && (
          <span className="ml-auto text-xs text-muted-foreground">Saving…</span>
        )}
        <ConfirmButton
          onConfirm={handleDelete}
          className={`${saving ? "" : "ml-auto"} flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:text-destructive hover:bg-muted transition-colors`}
          confirmLabel={
            <span className="text-[11px] font-bold text-destructive">Click again to delete</span>
          }
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete note
        </ConfirmButton>
      </div>

      {audioSrc && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
          <Mic className="h-4 w-4 shrink-0 text-muted-foreground" />
          <audio
            controls
            src={audioSrc}
            className="h-8 w-full"
            preload="metadata"
          />
        </div>
      )}

      <input
        type="text"
        className="w-full bg-transparent text-2xl font-semibold outline-none placeholder:text-muted-foreground"
        placeholder="Untitled"
        value={title}
        onChange={(e) => handleTitleChange(e.target.value)}
        onBlur={handleTitleBlur}
      />

      <div className="mt-4">
        <RichEditor noteId={note.id} initialContent={note.content} />
      </div>

      <NoteChatPanel noteId={note.id} noteTitle={title} />

      {backlinks.length > 0 && (
        <div className="mt-12 border-t pt-6">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Link2 className="h-4 w-4" />
            <span>Backlinks ({backlinks.length})</span>
          </div>
          <ul className="space-y-2">
            {backlinks.map((bl) => (
              <li key={bl.id}>
                <Link
                  href={`/app/notes/${bl.id}`}
                  className="text-sm text-blue-500 underline hover:text-blue-600"
                >
                  {bl.title || "Untitled"}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {mentions.length > 0 && (
        <div className="mt-8 border-t pt-6">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Link2 className="h-4 w-4" />
            <span>Suggested links ({mentions.length})</span>
          </div>
          <ul className="space-y-2">
            {mentions.map((m) => (
              <li key={m.id} className="flex items-center gap-2">
                <Link
                  href={`/app/notes/${m.id}`}
                  className="text-sm text-blue-500 underline hover:text-blue-600"
                >
                  {m.title || "Untitled"}
                </Link>
                <button
                  type="button"
                  onClick={() => handleLink(m.id)}
                  disabled={linking === m.id}
                  className="ml-auto rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {linking === m.id ? "Linking…" : "Link"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
