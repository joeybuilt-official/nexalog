// SPDX-License-Identifier: MIT
import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

const BLOCK_TYPES = [
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
  "bulletList",
  "orderedList",
  "listItem",
];

export const BlockIdExtension = Extension.create({
  name: "blockId",

  addGlobalAttributes() {
    return [
      {
        types: BLOCK_TYPES,
        attributes: {
          blockId: {
            default: null,
            rendered: true,
            keepOnSplit: false,
            parseHTML: (element) => element.getAttribute("data-block-id") ?? null,
            renderHTML: (attrs) => {
              if (!attrs.blockId) return {};
              return { "data-block-id": attrs.blockId };
            },
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(_transactions, _oldState, newState) {
          const tr = newState.tr;
          let modified = false;

          newState.doc.descendants((node, pos) => {
            if (
              BLOCK_TYPES.includes(node.type.name) &&
              node.attrs &&
              !node.attrs.blockId
            ) {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                blockId: crypto.randomUUID(),
              });
              modified = true;
            }
          });

          return modified ? tr : null;
        },
      }),
    ];
  },
});
