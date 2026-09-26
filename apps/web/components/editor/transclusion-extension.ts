import { Node, mergeAttributes, nodeInputRule } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { TransclusionNodeView } from "./transclusion-node-view";

export type TransclusionOptions = {
  HTMLAttributes: Record<string, unknown>;
};

// Matches ![[ref]] at input time (typed inline)
const TRANSCLUSION_INPUT_RULE = /!\[\[([^\[\]\n]{1,200})\]\]$/;

export const TransclusionExtension = Node.create<TransclusionOptions>({
  name: "transclusion",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      ref: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-transclusion]" }];
  },

  renderHTML({ node, HTMLAttributes }: { node: { attrs: Record<string, unknown> }; HTMLAttributes: Record<string, unknown> }) {
    const ref = (node.attrs["ref"] as string | null) ?? "";
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, { "data-transclusion": ref, class: "transclusion-block not-prose" }, HTMLAttributes),
      `![[${ref}]]`,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TransclusionNodeView);
  },

  addInputRules() {
    return [
      nodeInputRule({
        find: TRANSCLUSION_INPUT_RULE,
        type: this.type,
        getAttributes: (match) => ({ ref: match[1] }),
      }),
    ];
  },
});
