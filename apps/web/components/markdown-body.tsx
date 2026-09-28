// SPDX-License-Identifier: MIT
"use client";

/**
 * MarkdownBody — the repo's dependency-free markdown renderer for stored
 * markdown, extracted from the Journal's `MarkdownPreview` (which stays the
 * editor's preview pane) so the brain reader renders pages the same way the
 * journal renders entries instead of adding a markdown dependency.
 *
 * Supported, deliberately small: ATX headings (#/##/###), bold, italic, inline
 * code, `-`/`*` bullet lists (including simple `- [ ]`/`- [x]` checkboxes),
 * fenced code blocks, blockquotes, and `[[wiki links]]` rewritten to real
 * in-app anchors when the page they name exists.
 *
 * NOT a parser, and it never claims to be: anything it does not understand is
 * rendered as text, which is the honest outcome for a fallback renderer. Brain
 * pages are the operator's own repository markdown, so the shapes above cover
 * what the repo actually contains.
 *
 * Wikilinks: a target is resolved against the set of page slugs the caller
 * supplies, using the same alias rules as the garden's local walk (full slug,
 * last segment, title). A target that does not resolve stays literal text —
 * the reader never invents a link to a page that does not exist.
 */

import Link from "next/link";
import { type ReactNode } from "react";

import { brainPageHref } from "@/lib/search/result-href";

export interface MarkdownLinkTarget {
  slug: string;
  title?: string | null;
}

const FENCE_RE = /^```/;

/** Normalize a `[[…]]` body to a lookup key (alias + anchor stripped). */
function wikilinkKey(raw: string): string {
  return (raw.split("|")[0] ?? "")
    .split("#")[0]
    .trim()
    .toLowerCase();
}

/**
 * Build the lookup a body's `[[wiki links]]` resolve against. Keys are lower
 * cased so `[[Example Person]]` finds `people/example-person` through its
 * title, and `[[people/example-person]]` finds it directly.
 */
export function resolveTargets(
  targets: readonly MarkdownLinkTarget[],
): Map<string, string> {
  const map = new Map<string, string>();
  const add = (key: string | null | undefined, slug: string) => {
    const k = (key ?? "").trim().toLowerCase();
    if (!k || map.has(k)) return;
    map.set(k, slug);
  };
  for (const t of targets) {
    add(t.slug, t.slug);
    add(t.slug.split("/").pop(), t.slug);
    add(t.title, t.slug);
  }
  return map;
}

/**
 * Inline tokens: wikilinks, bold, inline code, italic. Non-overlapping by
 * construction (one pass, alternatives ordered longest-first), so a `**bold**`
 * inside a link label cannot swallow the link.
 */
function inline(
  text: string,
  targets: Map<string, string> | null,
  keyPrefix: string,
): ReactNode[] {
  const tokens: ReactNode[] = [];
  const re =
    /(\[\[[^\]\n]{1,200}\]\]|\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|_[^_]+_)/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  const keyOf = () => `${keyPrefix}-i${key++}`;

  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) tokens.push(text.slice(lastIdx, m.index));
    const tok = m[0];
    if (tok.startsWith("[[")) {
      const raw = tok.slice(2, -2);
      const target = targets?.get(wikilinkKey(raw)) ?? null;
      if (target) {
        tokens.push(
          <Link
            key={keyOf()}
            href={brainPageHref(target)}
            className="text-copper underline decoration-copper/40 underline-offset-2 hover:decoration-copper"
          >
            {raw.split("|").pop()?.split("#")[0] ?? raw}
          </Link>,
        );
      } else {
        // Unresolved target: keep the literal text, never a dead link.
        tokens.push(
          <span key={keyOf()} className="text-muted-foreground">
            {raw}
          </span>,
        );
      }
    } else if (tok.startsWith("**")) {
      tokens.push(<strong key={keyOf()}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      tokens.push(
        <code key={keyOf()} className="rounded bg-muted px-1 py-0.5 text-[12px]">
          {tok.slice(1, -1)}
        </code>,
      );
    } else {
      tokens.push(<em key={keyOf()}>{tok.slice(1, -1)}</em>);
    }
    lastIdx = m.index + tok.length;
  }
  if (lastIdx < text.length) tokens.push(text.slice(lastIdx));
  return tokens.length ? tokens : [text];
}

/** `- [ ]` / `- [x]` — rendered as a disabled checkbox, the same as any other list item. */
function listItemBody(line: string): { checkbox: boolean | null; text: string } {
  const m = line.match(/^[-*]\s+\[([ xX])\]\s*(.*)$/);
  if (m) return { checkbox: m[1].toLowerCase() === "x", text: m[2] };
  return { checkbox: null, text: line.replace(/^[-*]\s+/, "") };
}

export function MarkdownBody({
  text,
  targets,
  className,
}: {
  text: string;
  /** Pages a `[[wiki link]]` may resolve to. Omit to render them literally. */
  targets?: readonly MarkdownLinkTarget[];
  className?: string;
}) {
  const lookup = targets ? resolveTargets(targets) : null;
  const blocks = text.split(/\n{2,}/);

  return (
    <div className={`prose prose-sm dark:prose-invert max-w-none space-y-3 text-sm ${className ?? ""}`}>
      {blocks.map((block, bi) => {
        const lines = block.split("\n");

        // Fenced code — kept verbatim, never inline-rendered.
        if (FENCE_RE.test(lines[0] ?? "")) {
          const body = lines.slice(1); // strip the opening fence line
          const trimmed =
            body[body.length - 1]?.trim() === "```" ? body.slice(0, -1) : body;
          return (
            <pre
              key={bi}
              className="overflow-x-auto rounded-md border border-border bg-muted/40 p-3 text-[12px] leading-relaxed"
            >
              <code>{trimmed.join("\n")}</code>
            </pre>
          );
        }

        const h1 = lines[0].match(/^#\s+(.*)$/);
        if (h1) {
          return (
            <h1 key={bi} className="text-lg font-semibold">
              {inline(h1[1], lookup, `b${bi}`)}
            </h1>
          );
        }
        const h2 = lines[0].match(/^##\s+(.*)$/);
        if (h2) {
          return (
            <h2 key={bi} className="text-base font-semibold">
              {inline(h2[1], lookup, `b${bi}`)}
            </h2>
          );
        }
        const h3 = lines[0].match(/^###\s+(.*)$/);
        if (h3) {
          return (
            <h3 key={bi} className="text-sm font-semibold">
              {inline(h3[1], lookup, `b${bi}`)}
            </h3>
          );
        }

        // Blockquote — every line of the block starts with `>`.
        if (lines.every((l) => /^>\s?/.test(l))) {
          return (
            <blockquote
              key={bi}
              className="border-l-2 border-border pl-3 text-muted-foreground italic"
            >
              {inline(lines.map((l) => l.replace(/^>\s?/, "")).join("\n"), lookup, `b${bi}`)}
            </blockquote>
          );
        }

        if (lines.every((l) => /^[-*]\s+/.test(l))) {
          return (
            <ul key={bi} className="list-disc space-y-1 pl-5">
              {lines.map((l, li) => {
                const { checkbox, text: itemText } = listItemBody(l);
                return (
                  <li key={li} className={checkbox !== null ? "list-none" : undefined}>
                    {checkbox !== null && (
                      <input
                        type="checkbox"
                        checked={checkbox}
                        readOnly
                        disabled
                        aria-label={checkbox ? "done" : "open"}
                        className="mr-1.5 align-middle"
                      />
                    )}
                    {inline(itemText, lookup, `b${bi}-l${li}`)}
                  </li>
                );
              })}
            </ul>
          );
        }

        return (
          <p key={bi} className="whitespace-pre-wrap leading-relaxed">
            {inline(block, lookup, `b${bi}`)}
          </p>
        );
      })}
    </div>
  );
}
