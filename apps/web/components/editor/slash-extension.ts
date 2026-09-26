// SPDX-License-Identifier: MIT
import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/core";

type SlashItem = {
  label: string;
  description: string;
  command: (editor: Editor) => void;
};

const ITEMS: SlashItem[] = [
  {
    label: "Heading 1",
    description: "Large section heading",
    command: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    label: "Heading 2",
    description: "Medium section heading",
    command: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    label: "Heading 3",
    description: "Small section heading",
    command: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    label: "Bullet list",
    description: "Unordered list",
    command: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    label: "Numbered list",
    description: "Ordered list",
    command: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    label: "Blockquote",
    description: "Callout or quote",
    command: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    label: "Code block",
    description: "Monospace code block",
    command: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
  {
    label: "Divider",
    description: "Horizontal rule",
    command: (e) => e.chain().focus().setHorizontalRule().run(),
  },
  ...makeAiItems(),
];

const AI_PLACEHOLDER = "⏳";

function swapPlaceholder(e: Editor, replacement: string) {
  let found = -1;
  e.state.doc.descendants((node, pos) => {
    if (found === -1 && node.isText && node.text?.includes(AI_PLACEHOLDER)) {
      found = pos + node.text!.indexOf(AI_PLACEHOLDER);
    }
  });
  if (found === -1) return;
  e.chain()
    .focus()
    .setTextSelection({ from: found, to: found + AI_PLACEHOLDER.length })
    .insertContent(replacement)
    .run();
}

function aiPost(cmd: string, blockText: string) {
  return fetch("/api/ai/inline", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command: cmd, blockText }),
  }).then((r) => r.json() as Promise<{ result?: string; error?: string }>);
}

function makeAiItems(): SlashItem[] {
  const replace = (cmd: string, label: string, desc: string): SlashItem => ({
    label,
    description: desc,
    command: (e) => {
      const { from } = e.state.selection;
      const $from = e.state.doc.resolve(from);
      const blockStart = $from.start();
      const blockText = e.state.doc.textBetween(blockStart, from);
      e.chain().focus().setTextSelection({ from: blockStart, to: from }).insertContent(AI_PLACEHOLDER).run();
      void aiPost(cmd, blockText)
        .then(({ result }) => swapPlaceholder(e, result ?? blockText))
        .catch(() => swapPlaceholder(e, blockText));
    },
  });

  return [
    replace("summarize", "AI: Summarize", "Condense this block with AI"),
    {
      label: "AI: Related",
      description: "Insert related ideas below",
      command: (e) => {
        const { from } = e.state.selection;
        const $from = e.state.doc.resolve(from);
        const blockText = e.state.doc.textBetween($from.start(), from);
        e.chain().focus().splitBlock().insertContent(AI_PLACEHOLDER).run();
        void aiPost("related", blockText)
          .then(({ result }) => swapPlaceholder(e, result ?? ""))
          .catch(() => swapPlaceholder(e, ""));
      },
    },
    replace("checklist", "AI: Checklist", "Convert to checklist with AI"),
    replace("expand", "AI: Expand", "Expand this block with AI"),
    replace("shorten", "AI: Shorten", "Shorten this block with AI"),
    replace("rephrase", "AI: Rephrase", "Rephrase this block with AI"),
  ];
}

export const SlashExtension = Extension.create({
  name: "slash",

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: new PluginKey("slashSuggestion"),
        char: "/",
        startOfLine: false,
        allowSpaces: false,
        items: ({ query }: { query: string }) => {
          const q = query.toLowerCase();
          return ITEMS.filter(
            (item) =>
              item.label.toLowerCase().includes(q) ||
              item.description.toLowerCase().includes(q)
          );
        },
        render: () => {
          let popupEl: HTMLDivElement | null = null;
          let items: SlashItem[] = [];
          let selectedIndex = 0;
          let cmdFn: ((item: SlashItem) => void) | null = null;

          function renderList(props: {
            items: SlashItem[];
            command: (item: SlashItem) => void;
          }) {
            if (!popupEl) return;
            items = props.items;
            cmdFn = props.command;
            popupEl.innerHTML = "";

            if (!items.length) {
              popupEl.style.display = "none";
              return;
            }

            popupEl.style.display = "block";
            items.forEach((item, i) => {
              const btn = document.createElement("button");
              btn.type = "button";
              btn.className = [
                "w-full text-left px-3 py-2 flex flex-col gap-0.5",
                i === selectedIndex
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent hover:text-accent-foreground",
              ].join(" ");

              const labelEl = document.createElement("span");
              labelEl.className = "text-sm font-medium";
              labelEl.textContent = item.label;

              const descEl = document.createElement("span");
              descEl.className = "text-xs text-muted-foreground";
              descEl.textContent = item.description;

              btn.appendChild(labelEl);
              btn.appendChild(descEl);

              btn.addEventListener("mousedown", (e) => {
                e.preventDefault();
                props.command(item);
              });
              popupEl!.appendChild(btn);
            });
          }

          return {
            onStart(
              props: Parameters<typeof renderList>[0] & {
                clientRect?: (() => DOMRect | null) | null;
              }
            ) {
              selectedIndex = 0;
              popupEl = document.createElement("div");
              popupEl.className =
                "fixed z-50 bg-popover border border-border rounded-md shadow-md py-1 min-w-52 max-w-72 max-h-72 overflow-y-auto";
              popupEl.style.display = "none";
              document.body.appendChild(popupEl);
              renderList(props);
              if (props.clientRect) {
                const rect = props.clientRect();
                if (rect && popupEl) {
                  popupEl.style.top = `${rect.bottom + 4}px`;
                  popupEl.style.left = `${rect.left}px`;
                }
              }
            },
            onUpdate(
              props: Parameters<typeof renderList>[0] & {
                clientRect?: (() => DOMRect | null) | null;
              }
            ) {
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
                selectedIndex =
                  (selectedIndex - 1 + items.length) % items.length;
                if (popupEl && cmdFn) renderList({ items, command: cmdFn });
                return true;
              }
              if (event.key === "ArrowDown") {
                selectedIndex = (selectedIndex + 1) % items.length;
                if (popupEl && cmdFn) renderList({ items, command: cmdFn });
                return true;
              }
              if (event.key === "Enter" && cmdFn) {
                cmdFn(items[selectedIndex]);
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
          editor: Editor;
          range: { from: number; to: number };
          props: SlashItem;
        }) {
          editor.chain().focus().deleteRange(range).run();
          props.command(editor);
        },
      }),
    ];
  },
});
