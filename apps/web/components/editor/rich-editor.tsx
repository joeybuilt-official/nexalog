"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { WikilinkExtension } from "./wikilink-extension";
import { BlockIdExtension } from "./block-id-extension";
import { SlashExtension } from "./slash-extension";
import { TransclusionExtension } from "./transclusion-extension";
import { useCallback, useRef, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Note = { id: string; title: string };

type WikiSuggestionItem = Note;

function buildSuggestion(noteId: string) {
  return {
    char: "[[" as const,
    items: async ({ query }: { query: string }): Promise<WikiSuggestionItem[]> => {
      try {
        const res = await fetch(
          `/api/notes/search?q=${encodeURIComponent(query)}&limit=8`
        );
        if (!res.ok) return [];
        const data = (await res.json()) as { notes: WikiSuggestionItem[] };
        return data.notes ?? [];
      } catch {
        return [];
      }
    },
    render: () => {
      let popupEl: HTMLDivElement | null = null;
      let items: WikiSuggestionItem[] = [];
      let selectedIndex = 0;
      let onSelectFn: ((item: WikiSuggestionItem) => void) | null = null;

      function renderList(
        props: { items: WikiSuggestionItem[]; command: (item: WikiSuggestionItem) => void }
      ) {
        if (!popupEl) return;
        items = props.items;
        onSelectFn = props.command;
        popupEl.innerHTML = "";

        if (!items.length) {
          popupEl.style.display = "none";
          return;
        }

        popupEl.style.display = "block";
        items.forEach((item, i) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = item.title || "Untitled";
          btn.className = [
            "w-full text-left px-3 py-1.5 text-sm truncate",
            i === selectedIndex
              ? "bg-accent text-accent-foreground"
              : "hover:bg-accent hover:text-accent-foreground",
          ].join(" ");
          btn.addEventListener("mousedown", (e) => {
            e.preventDefault();
            props.command(item);
          });
          popupEl!.appendChild(btn);
        });
      }

      return {
        onStart(props: Parameters<typeof renderList>[0] & { clientRect?: (() => DOMRect | null) | null }) {
          selectedIndex = 0;
          popupEl = document.createElement("div");
          popupEl.className =
            "fixed z-50 bg-popover border border-border rounded-md shadow-md py-1 min-w-48 max-w-64 max-h-60 overflow-y-auto";
          popupEl.style.display = "none";
          document.body.appendChild(popupEl);
          renderList(props);

          if (props.clientRect) {
            const rect = props.clientRect();
            if (rect) {
              popupEl.style.top = `${rect.bottom + 4}px`;
              popupEl.style.left = `${rect.left}px`;
            }
          }
        },
        onUpdate(props: Parameters<typeof renderList>[0] & { clientRect?: (() => DOMRect | null) | null }) {
          renderList(props);
          if (props.clientRect && popupEl) {
            const rect = props.clientRect();
            if (rect) {
              popupEl.style.top = `${rect.bottom + 4}px`;
              popupEl.style.left = `${rect.left}px`;
            }
          }
        },
        onKeyDown({ event }: { event: KeyboardEvent }) {
          if (!items.length) return false;
          if (event.key === "ArrowUp") {
            selectedIndex = (selectedIndex - 1 + items.length) % items.length;
            if (popupEl && onSelectFn) renderList({ items, command: onSelectFn });
            return true;
          }
          if (event.key === "ArrowDown") {
            selectedIndex = (selectedIndex + 1) % items.length;
            if (popupEl && onSelectFn) renderList({ items, command: onSelectFn });
            return true;
          }
          if (event.key === "Enter" && onSelectFn) {
            onSelectFn(items[selectedIndex]);
            return true;
          }
          if (event.key === "Escape") {
            if (popupEl) popupEl.style.display = "none";
            return true;
          }
          return false;
        },
        onExit() {
          if (popupEl) {
            popupEl.remove();
            popupEl = null;
          }
        },
      };
    },
    command({
      editor,
      range,
      props,
    }: {
      editor: import("@tiptap/core").Editor;
      range: { from: number; to: number };
      props: WikiSuggestionItem;
    }) {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent([
          {
            type: "wikilink",
            attrs: { id: props.id, label: props.title || "Untitled" },
          },
          { type: "text", text: " " },
        ])
        .run();

      // Persist the link relationship
      fetch(`/api/notes/${noteId}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetNoteId: props.id }),
      }).catch(() => {});
    },
  };
}

type RichEditorProps = {
  noteId: string;
  initialContent: string;
  onSave?: (content: string) => void;
};

export function RichEditor({ noteId, initialContent, onSave }: RichEditorProps) {
  const router = useRouter();
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saving, setSaving] = useState(false);

  const save = useCallback(
    async (content: string) => {
      setSaving(true);
      try {
        await fetch(`/api/notes/${noteId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });
        onSave?.(content);
      } finally {
        setSaving(false);
      }
    },
    [noteId, onSave]
  );

  const editor = useEditor({
    extensions: [
      // StarterKit v3 bundles its own Link extension; disable it so the
      // explicitly-configured Link below doesn't register a duplicate 'link'.
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: "Start writing… (type / for commands)" }),
      BlockIdExtension,
      SlashExtension,
      WikilinkExtension.configure({ suggestion: buildSuggestion(noteId) }),
      TransclusionExtension,
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm dark:prose-invert max-w-none min-h-[60vh] outline-none focus:outline-none",
      },
    },
    onUpdate({ editor }) {
      const html = editor.getHTML();
      if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
      autoSaveRef.current = setTimeout(() => save(html), 1000);
    },
    onBlur({ editor }) {
      if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
      save(editor.getHTML()).then(() => router.refresh());
    },
  });

  useEffect(() => {
    return () => {
      if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    };
  }, []);

  return (
    <div className="relative">
      {saving && (
        <span className="absolute right-0 top-0 text-xs text-muted-foreground">
          Saving…
        </span>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
