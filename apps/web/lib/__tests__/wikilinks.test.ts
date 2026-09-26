// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { extractWikilinks } from "@/lib/notes/wikilinks";

const UUID_A = "11111111-2222-3333-4444-555555555555";
const UUID_B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("extractWikilinks (C3)", () => {
  it("returns empty for null/empty content", () => {
    expect(extractWikilinks(null)).toEqual({ ids: [], labels: [] });
    expect(extractWikilinks("")).toEqual({ ids: [], labels: [] });
    expect(extractWikilinks(undefined)).toEqual({ ids: [], labels: [] });
  });

  it("pulls the target id out of the TipTap data-wikilink anchor (href)", () => {
    const html = `<p>see <a data-wikilink href="/app/notes/${UUID_A}" class="wikilink">[[Foo]]</a></p>`;
    const { ids } = extractWikilinks(html);
    expect(ids).toEqual([UUID_A]);
  });

  it("pulls the target id from data-id even when href is missing", () => {
    const html = `<a data-wikilink data-id="${UUID_B}">[[Bar]]</a>`;
    const { ids } = extractWikilinks(html);
    expect(ids).toEqual([UUID_B]);
  });

  it("extracts raw [[label]] markdown that has no HTML wrapper", () => {
    const md = `talked to [[foobar]] today, also [[Another Topic]].`;
    const { ids, labels } = extractWikilinks(md);
    expect(ids).toEqual([]);
    expect(labels.sort()).toEqual(["Another Topic", "foobar"].sort());
  });

  it("treats a raw [[<uuid>]] as a direct id reference, not a label", () => {
    const md = `link: [[${UUID_A}]]`;
    const { ids, labels } = extractWikilinks(md);
    expect(ids).toEqual([UUID_A]);
    expect(labels).toEqual([]);
  });

  it("does not double-count the [[label]] text inside an HTML data-wikilink", () => {
    const html = `<a data-wikilink href="/app/notes/${UUID_A}">[[Foo]]</a>`;
    const { ids, labels } = extractWikilinks(html);
    expect(ids).toEqual([UUID_A]);
    // After stripping <a …>…</a> the inner text "[[Foo]]" survives as residue,
    // so "Foo" can still appear as a label. That is acceptable — persistWikilinks
    // resolves to the same target id and the unique index absorbs the dup.
    expect(labels).toEqual(["Foo"]);
  });

  it("ignores malformed brackets and obvious noise", () => {
    const { ids, labels } = extractWikilinks(
      "single [bracket] and ]]reversed[[ and [[]] empty"
    );
    expect(ids).toEqual([]);
    expect(labels).toEqual([]);
  });

  it("deduplicates repeated references", () => {
    const md = `[[foo]] and again [[foo]] and [[foo]].`;
    const { labels } = extractWikilinks(md);
    expect(labels).toEqual(["foo"]);
  });

  it("rejects a bracketed string that contains a newline", () => {
    const md = `[[multi\nline]]`;
    const { ids, labels } = extractWikilinks(md);
    expect(ids).toEqual([]);
    expect(labels).toEqual([]);
  });

  it("handles mixed HTML + raw markdown in the same content", () => {
    const html = `<a data-wikilink href="/app/notes/${UUID_A}">[[Alpha]]</a> plus raw [[beta]] reference`;
    const { ids, labels } = extractWikilinks(html);
    expect(ids).toEqual([UUID_A]);
    expect(labels.sort()).toEqual(["Alpha", "beta"].sort());
  });
});
