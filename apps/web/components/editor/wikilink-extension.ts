import { mergeAttributes, Node, type Editor } from "@tiptap/core";
import Suggestion, { type SuggestionOptions, type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { PluginKey, type EditorState } from "@tiptap/pm/state";

export type WikilinkOptions = {
  HTMLAttributes: Record<string, unknown>;
  suggestion: Partial<SuggestionOptions>;
};

export const WikilinkExtension = Node.create<WikilinkOptions>({
  name: "wikilink",
  group: "inline",
  inline: true,
  selectable: false,
  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      suggestion: {
        char: "[[",
        command({
          editor,
          range,
          props,
        }: {
          editor: Editor;
          range: { from: number; to: number };
          props: { id: string; label: string };
        }) {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([
              {
                type: "wikilink",
                attrs: { id: props.id, label: props.label },
              },
              { type: "text", text: " " },
            ])
            .run();
        },
        allow({ state, range }: { state: EditorState; range: { from: number; to: number } }) {
          const $from = state.doc.resolve(range.from);
          const type = state.schema.nodes["wikilink"];
          if (!type) return false;
          return !!$from.parent.type.contentMatch.matchType(type);
        },
      },
    };
  },

  addAttributes() {
    return {
      id: { default: null },
      label: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "a[data-wikilink]" }];
  },

  renderHTML({ node, HTMLAttributes }: { node: { attrs: Record<string, unknown> }; HTMLAttributes: Record<string, unknown> }) {
    return [
      "a",
      mergeAttributes(
        this.options.HTMLAttributes,
        {
          "data-wikilink": "",
          href: `/app/notes/${node.attrs["id"] as string}`,
          class: "wikilink text-blue-500 underline cursor-pointer",
        },
        HTMLAttributes
      ),
      `[[${(node.attrs["label"] as string | null) ?? (node.attrs["id"] as string)}]]`,
    ];
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: new PluginKey("wikilinkSuggestion"),
        ...this.options.suggestion,
      }),
    ];
  },
});
