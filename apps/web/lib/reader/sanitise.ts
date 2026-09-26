// SPDX-License-Identifier: MIT
import sanitizeHtml from "sanitize-html";

/**
 * Sanitise HTML produced by the Readability enrichment pipeline before
 * it's injected into the reader page via dangerouslySetInnerHTML.
 * Whitelist is purpose-built for readable prose — no scripts, no inline
 * styles, but ALL the prose semantics (headings, lists, code, blockquote,
 * tables, figures, images, links) stay.
 */
export function sanitiseReaderHtml(html: string): string {
  if (!html) return "";
  return sanitizeHtml(html, {
    allowedTags: [
      "p", "br", "hr",
      "h1", "h2", "h3", "h4", "h5", "h6",
      "strong", "em", "b", "i", "u", "s", "del", "ins", "mark", "sup", "sub",
      "a",
      "ul", "ol", "li",
      "blockquote",
      "pre", "code", "kbd", "samp",
      "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
      "img", "figure", "figcaption",
      "span", "div",
    ],
    allowedAttributes: {
      a: ["href", "title", "name"],
      img: ["src", "alt", "title", "width", "height", "loading"],
      "*": ["id"],
      code: ["class"], // hljs / shiki language class
      pre: ["class"],
      th: ["scope", "colspan", "rowspan"],
      td: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto", "data"],
    allowedSchemesByTag: {
      img: ["http", "https", "data"],
    },
    transformTags: {
      // Force external links to safe-open in a new tab.
      a: (tagName, attribs) => {
        const href = attribs.href || "";
        const isExternal = /^https?:\/\//i.test(href);
        return {
          tagName: "a",
          attribs: {
            ...attribs,
            ...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {}),
          },
        };
      },
      // Always lazy-load reader images.
      img: (tagName, attribs) => ({
        tagName: "img",
        attribs: { ...attribs, loading: "lazy", decoding: "async" },
      }),
    },
    // Drop empty paragraphs the Readability output sometimes leaves behind.
    exclusiveFilter: (frame) =>
      frame.tag === "p" && !frame.text.trim() && !/<img/i.test(frame.text),
  });
}

/**
 * Convenience: estimate reading time from sanitised HTML.
 * 220 wpm = the well-cited average for adult readers of mixed-difficulty
 * prose. Round up so a 30-second blurb still reads "1 min".
 */
export function estimateReadingMinutes(html: string): number {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const words = text ? text.split(" ").length : 0;
  return Math.max(1, Math.ceil(words / 220));
}
