// SPDX-License-Identifier: MIT
// NEXALOG-PROJECTS — the pure list-view rules for a project's linked NOTES.
//
// A note is the one member kind whose body can be enormous: many of them are
// whole conversations and some run past a million characters. The project page
// therefore can never load content into its list, and the store selects a
// BOUNDED PREFIX of the body instead (`left(content, NOTE_EXCERPT_SOURCE_CHARS)`)
// — what arrives here is a prefix, never a body.
//
// Every rule that decides what a reader sees lives in this file, so none of it is
// re-derived in a React component (clean-architecture: a conditional that encodes
// a business rule does not live in the UI):
//
//   - which linked rows survive to render (a soft-deleted note is never shown);
//   - the order they render in (three sort keys, each a TOTAL comparator so equal
//     keys can never leave the row order to chance);
//   - what the row's single excerpt line is (markdown/HTML flattened, then cut on
//     a word boundary);
//   - what the empty and partially-hidden states SAY (the copy is a rule too, and
//     it is what makes an empty project render sensibly instead of blank).
//
// Nothing here reads a clock, an env var, a database, or a framework: the input is
// plain rows, the output is a plain view model, and that is what makes all of it
// testable in-process. The store is the adapter that produces these rows; the
// detail page reuses `classifyNoteBody` for the on-demand full body.

/** A note row joined to its `project_items` edge, as the list query returns it. */
export type LinkedNoteRow = {
  id: string;
  title: string;
  /**
   * A BOUNDED PREFIX of the note body — deliberately not the body. The type name
   * is the guard: a caller that passes the whole `content` still gets a bounded
   * excerpt, because `projectNoteExcerpt` never inspects more than
   * `NOTE_EXCERPT_SOURCE_CHARS` characters.
   */
  excerptSource?: string | null;
  /** The note's own `date` (a display string in the schema), or `null`. */
  date?: string | null;
  updatedAt?: Date | string | null;
  /** When the note was linked to the project — the edge's own timestamp. */
  addedAt?: Date | string | null;
  /** Non-null means soft-deleted. Such a row is never rendered. */
  deletedAt?: Date | string | null;
};

/** One rendered row: plain strings, no `Date`s, nothing that needs a framework. */
export type ProjectNoteListItem = {
  id: string;
  /** Never empty — an untitled note reads "Untitled". */
  title: string;
  /** One flattened line, at most `NOTE_EXCERPT_MAX_CHARS` + an ellipsis. */
  excerpt: string;
  /** The note's own date, trimmed; `null` when absent or blank. */
  date: string | null;
  updatedAt: string;
  addedAt: string | null;
};

/**
 * The projection the page renders. `totalLinked` and `hiddenDeleted` are carried
 * so the copy can be honest about what is NOT on screen — a list that silently
 * drops rows reads as a bug the moment someone knows the row exists.
 */
export type ProjectNotesView = {
  notes: ProjectNoteListItem[];
  /** Every row handed in, live or withheld — the honest denominator. */
  totalLinked: number;
  /** Soft-deleted rows that were refused. */
  hiddenDeleted: number;
};

/**
 * How much of a body the excerpt is allowed to INSPECT. The work is bounded here
 * deliberately: flattening a million-character note to build a 160-character line
 * would be a page-load regression for every row in the list. The excerpt is a
 * summary, so a summary-sized window is the whole requirement.
 */
export const NOTE_EXCERPT_SOURCE_CHARS = 400;

/** How many characters the rendered excerpt line may carry (plus the ellipsis). */
export const NOTE_EXCERPT_MAX_CHARS = 160;

/**
 * How much of a body `classifyNoteBody` sniffs. A tag near the start is the
 * signal; scanning a megabyte to answer "is this HTML" is the same mistake as
 * scanning it to build an excerpt.
 */
export const NOTE_BODY_SNIFF_CHARS = 2000;

/**
 * The sort keys the list offers. `updated` is the default: on a project page the
 * question a reader has is "what moved last". `added` is the project's own order
 * (the order the notes were linked, which is what the unit lists beside it use),
 * and `title` is the only one that gets more useful as the list gets longer.
 */
export const PROJECT_NOTE_SORTS = ["updated", "added", "title"] as const;
export type ProjectNoteSort = (typeof PROJECT_NOTE_SORTS)[number];

export const DEFAULT_PROJECT_NOTE_SORT: ProjectNoteSort = "updated";

export const PROJECT_NOTE_SORT_LABELS: Record<ProjectNoteSort, string> = {
  updated: "Recently updated",
  added: "Recently linked",
  title: "Title A–Z",
};

/** The body shapes the on-demand detail view can meet. */
export const NOTE_BODY_KINDS = ["empty", "html", "markdown"] as const;
export type NoteBodyKind = (typeof NOTE_BODY_KINDS)[number];

// ---- rows that survive ----------------------------------------------------

/** `null`, `undefined` and blank all mean "no value" — absent is not deleted. */
function isAbsent(value: unknown): value is null | undefined | "" {
  return value === null || value === undefined || value === "";
}

/**
 * A note is soft-deleted when `deleted_at` carries a value. The store's query
 * already filters those out; this is the second, independent refusal, so a future
 * change that loses that WHERE clause still cannot render a deleted note. Both
 * halves are asserted (the pure rule here, the query in the store's test).
 */
export function isLiveLinkedNote(row: Pick<LinkedNoteRow, "deletedAt">): boolean {
  return isAbsent(row.deletedAt);
}

// ---- excerpt --------------------------------------------------------------

const ENTITIES: ReadonlyArray<[RegExp, string]> = [
  [/&nbsp;/gi, " "],
  [/&amp;/gi, "&"],
  [/&lt;/gi, "<"],
  [/&gt;/gi, ">"],
  [/&quot;/gi, '"'],
  [/&#39;/gi, "'"],
  [/&apos;/gi, "'"],
];

/**
 * Reduce a body fragment to one line of prose. Notes arrive in two shapes — the
 * editor stores HTML (`<p>…</p>`), an import can store markdown — so both are
 * flattened to the same thing.
 *
 * Order matters: HTML tags are stripped BEFORE entities are decoded, because
 * decoding first would turn a literal `&lt;script&gt;` into a tag and eat the
 * text the reader wanted to see. The output is plain text: it is rendered as a
 * React text node, never as markup, so no escaping is needed and none is added.
 */
function flattenToProse(fragment: string): string {
  let text = fragment
    // fenced code markers and per-line heading hashes
    .replace(/^[ \t]{0,3}(?:```|~~~).*$/gm, " ")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    // blockquote arrows
    .replace(/^[ \t]{0,3}>[ \t]?/gm, "")
    // links keep their label: [label](target) -> label
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Tag handling, in two passes and in this order. A tag that ENDS a block is a
    // word boundary (`</p><p>` must not weld two words together), so it becomes a
    // space; every other tag is REMOVED with no whitespace, because substituting a
    // space for an inline tag turns "there</strong>, world" into "there , world".
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote|tr|td|th|ul|ol|table|pre|section|article)>/gi, " ")
    .replace(/<(?:br|hr)\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    // emphasis / inline-code markers
    .replace(/[*_`~]+/g, "");

  for (const [pattern, replacement] of ENTITIES) text = text.replace(pattern, replacement);

  return text.replace(/\s+/g, " ").trim();
}

/**
 * The row's single excerpt line. `max` characters at most, plus one ellipsis —
 * never a mid-word cut, and never a scan of the whole body.
 *
 * A body that fits returns whole and WITHOUT an ellipsis: `…` on a line that was
 * not truncated is a small lie, and it is the kind that makes a reader distrust
 * every other indicator on the page.
 */
export function projectNoteExcerpt(
  source: string | null | undefined,
  max: number = NOTE_EXCERPT_MAX_CHARS,
): string {
  if (isAbsent(source) || max <= 0) return "";

  // BOUNDED WORK — see NOTE_EXCERPT_SOURCE_CHARS. Everything below runs over at
  // most this many characters, however large the body the caller handed over.
  const window =
    source.length > NOTE_EXCERPT_SOURCE_CHARS ? source.slice(0, NOTE_EXCERPT_SOURCE_CHARS) : source;

  const prose = flattenToProse(window);
  if (!prose) return "";

  // Code points, not UTF-16 units: slicing a surrogate pair yields a replacement
  // character, which is how an emoji at the cut point becomes "�".
  const points = [...prose];
  if (points.length <= max) return prose;

  const cut = points.slice(0, max).join("");
  // Cut at the last space so the line ends on a word, unless the line is one long
  // token — then an honest hard cut beats an empty excerpt.
  const lastSpace = cut.search(/\s\S*$/);
  const clipped = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return `${clipped.trimEnd()}…`;
}

// ---- ordering -------------------------------------------------------------

/** Epoch 0 for absent or unparseable input — never `NaN`, which poisons a compare. */
function timestamp(value: Date | string | null | undefined): number {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? 0 : ms;
  }
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? 0 : ms;
  }
  return 0;
}

function byId(a: LinkedNoteRow, b: LinkedNoteRow): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function titleOf(row: Pick<LinkedNoteRow, "title">): string {
  const title = (row.title ?? "").trim();
  return title || "Untitled";
}

function byTitle(a: LinkedNoteRow, b: LinkedNoteRow): number {
  // Explicit `"en"` locale, matching `lib/projects/browse` — a locale-dependent
  // compare makes the order depend on the machine that ran it.
  return titleOf(a).localeCompare(titleOf(b), "en", { sensitivity: "base" });
}

/**
 * A comparator for one sort key. **Total**, like `compareProjects`: every branch
 * ends on the id, so two rows with identical keys still have one defined order and
 * the list cannot reshuffle itself between renders.
 */
export function compareProjectNotes(
  sort: ProjectNoteSort = DEFAULT_PROJECT_NOTE_SORT,
): (a: LinkedNoteRow, b: LinkedNoteRow) => number {
  return (a, b) => {
    let delta: number;
    switch (sort) {
      case "added":
        delta = timestamp(a.addedAt) - timestamp(b.addedAt);
        break;
      case "title":
        delta = byTitle(a, b);
        break;
      case "updated":
      default:
        delta = timestamp(b.updatedAt) - timestamp(a.updatedAt);
        if (delta === 0) delta = timestamp(b.addedAt) - timestamp(a.addedAt);
        break;
    }
    return delta !== 0 ? delta : byId(a, b);
  };
}

/** Sort a copy — the caller's array is never mutated. */
export function sortProjectNotes<T extends LinkedNoteRow>(
  rows: T[],
  sort: ProjectNoteSort = DEFAULT_PROJECT_NOTE_SORT,
): T[] {
  return [...rows].sort(compareProjectNotes(sort));
}

// ---- the view model -------------------------------------------------------

function toIso(value: Date | string | null | undefined): string | null {
  const ms = timestamp(value);
  if (!ms) return null;
  return new Date(ms).toISOString();
}

/** A present, non-blank display string — else `null`. `"  "` is not a date. */
function trimmedOrNull(value: string | null | undefined): string | null {
  if (isAbsent(value)) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Turn the linked note rows into what the page renders. Soft-deleted rows are
 * dropped; the rest are ordered, excerpted and title-normalised. The counts of
 * what was dropped come back with the list rather than being recomputed by the
 * component, so there is one place that knows how many rows were withheld.
 */
export function buildProjectNotesView(
  rows: readonly LinkedNoteRow[],
  options: { sort?: ProjectNoteSort; excerptChars?: number } = {},
): ProjectNotesView {
  const sort = options.sort ?? DEFAULT_PROJECT_NOTE_SORT;
  const excerptChars = options.excerptChars ?? NOTE_EXCERPT_MAX_CHARS;

  const live = rows.filter(isLiveLinkedNote);

  return {
    notes: sortProjectNotes(live, sort).map((row) => ({
      id: row.id,
      title: titleOf(row),
      excerpt: projectNoteExcerpt(row.excerptSource, excerptChars),
      date: trimmedOrNull(row.date),
      updatedAt: toIso(row.updatedAt) ?? "",
      addedAt: toIso(row.addedAt),
    })),
    totalLinked: rows.length,
    hiddenDeleted: rows.length - live.length,
  };
}

// ---- the empty states -----------------------------------------------------

/**
 * What an empty section says. `null` when there is something to render — the
 * caller renders the list and never this copy.
 *
 * Two genuinely different empties, and conflating them hides information: a
 * project with nothing linked needs an action, while a project whose notes are
 * ALL deleted needs the reason its list is empty.
 */
export function projectNotesEmptyMessage(view: ProjectNotesView): string | null {
  if (view.notes.length > 0) return null;

  if (view.hiddenDeleted > 0) {
    const note = view.hiddenDeleted === 1 ? "note" : "notes";
    return `No notes to show. All ${view.hiddenDeleted} linked ${note} ${
      view.hiddenDeleted === 1 ? "is" : "are"
    } deleted, and a deleted note never appears here.`;
  }

  return "No notes linked yet. Add one below — a project references notes, it never copies them.";
}

/**
 * The line under a list that IS rendering something while also withholding rows.
 * `null` when nothing was withheld, so the honest case renders no notice at all.
 */
export function projectNotesHiddenNotice(view: ProjectNotesView): string | null {
  if (view.hiddenDeleted <= 0) return null;
  if (view.notes.length === 0) return null; // the empty message already says it
  const note = view.hiddenDeleted === 1 ? "note is" : "notes are";
  return `${view.hiddenDeleted} deleted ${note} not shown.`;
}

// ---- the on-demand body ---------------------------------------------------

/**
 * Which body shape the detail view is about to render. The decision lives here
 * because it is a rule about the DATA, not about the markup: the editor stores
 * HTML, an import can store markdown, and rendering the wrong one shows a reader
 * either a wall of raw tags or a page of unparsed `##` markers.
 *
 * A tag-like `<x>` in running prose is not HTML — `<` must be followed by a letter
 * and the later `>` is required — so "3 < 4 and 5 > 2" classifies as markdown.
 */
export function classifyNoteBody(content: string | null | undefined): NoteBodyKind {
  const text = (content ?? "").trim();
  if (!text) return "empty";
  const window =
    text.length > NOTE_BODY_SNIFF_CHARS ? text.slice(0, NOTE_BODY_SNIFF_CHARS) : text;
  return /<([a-z][a-z0-9]*)\b[^>]*>/i.test(window) ? "html" : "markdown";
}
