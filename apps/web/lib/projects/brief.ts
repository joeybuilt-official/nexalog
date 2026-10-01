// SPDX-License-Identifier: MIT
// NEXALOG-PROJECTS — the PURE brief assembly rules.
//
// A project BRIEF is a synthesized markdown summary of one project, built from
// what the project actually holds: its own record, the notes it references, its
// sub-projects, and the interest themes it touches. This module owns the part
// that is a RULE — what survives, the order, the truncation, the theme match,
// the prompt INPUT block, and the not-synthesized fallback — and it owns it
// with no React, no IO, no env, no clock of its own.
//
// Two properties the whole feature rests on:
//
//   1. **A note body never crosses this module.** A note can be a conversation
//      past a million characters; the input carries a title, a date, a
//      `sizeChars` NUMBER and (when present) an embedding — never `content`.
//      The store selects `length(content)` and nothing else of it.
//   2. **Every answer is deterministic in its input.** Same rows in, same
//      bytes out: every comparator is TOTAL (tie broken down to the id), the
//      truncation is code-point bounded, and the only clock is injected.
//      That is what makes the brief reproducible and the tests honest.
//
// The model leg lives behind `lib/intelligence`; nothing here knows a provider,
// a model, or a wire shape.

// ---- policy (tuning is configuration) -------------------------------------

/** How much of the living document the synthesis input may carry. */
export const BRIEF_MAX_LIVING_DOC_CHARS = 4000;
/** How many linked notes the synthesis input lists (the rest are counted). */
export const BRIEF_MAX_NOTES = 50;
/** How many sub-projects the synthesis input lists. */
export const BRIEF_MAX_SUB_PROJECTS = 20;
/** How many matched themes the synthesis input carries. */
export const BRIEF_MAX_THEMES = 6;
/** Similarity floor for "the project touches this theme" (cosine, 0..1). */
export const BRIEF_THEME_MIN_SCORE = 0.2;
/** The recency window used to report "recent activity", in days. */
export const BRIEF_RECENT_NOTE_DAYS = 30;
/** How many recent-activity notes are listed (the rest are counted). */
export const BRIEF_RECENT_NOTES_MAX = 10;
/** Hard ceiling on the model's own output before it is rendered. */
export const BRIEF_MAX_OUTPUT_CHARS = 20_000;
/** The digest shown when no model answered is not a synthesis. */
export const BRIEF_FALLBACK_LABEL = "Not synthesized";

// ---- input shapes -----------------------------------------------------------

/**
 * One linked note, as the brief reads it. `embedding` is optional and only used
 * to match themes; `contentLength` is a SIZE, never content.
 */
export type BriefNoteRow = {
  id: string;
  title?: string | null;
  /** The note's own display date (`date` in the schema), or null. */
  date?: string | null;
  updatedAt?: Date | string | null;
  /** When the note was linked to the project (the edge's own timestamp). */
  addedAt?: Date | string | null;
  /** Non-null means soft-deleted; such a row never reaches the brief. */
  deletedAt?: Date | string | null;
  /** `length(content)` as the store computed it — never the content. */
  contentLength?: number | null;
  /** A unit-ish vector for theme matching, when the note carries one. */
  embedding?: ReadonlyArray<number> | null;
};

export type BriefSubProjectRow = {
  id: string;
  name: string;
  lifecycleState?: string | null;
  deletedAt?: Date | string | null;
};

export type BriefThemeRow = {
  themeId: string;
  label: string;
  size?: number | null;
  centroid?: ReadonlyArray<number> | null;
};

export type BriefProjectRow = {
  id: string;
  name: string;
  description?: string | null;
  lifecycleState: string;
  livingDoc?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  /** Non-null means soft-deleted; a deleted project has no brief at all. */
  deletedAt?: Date | string | null;
};

/** Everything the assembler is handed. The store is the adapter that produces it. */
export type ProjectBriefSource = {
  project: BriefProjectRow;
  notes: BriefNoteRow[];
  subProjects: BriefSubProjectRow[];
  /** The workspace's candidate themes — READ, never recomputed here. */
  themes?: BriefThemeRow[];
};

// ---- assembled output -------------------------------------------------------

export type BriefNoteRef = {
  id: string;
  /** Never empty — an untitled note reads "Untitled". */
  title: string;
  date: string | null;
  updatedAt: string | null;
  addedAt: string | null;
  sizeChars: number;
};

export type BriefSubProjectRef = {
  id: string;
  name: string;
  lifecycleState: string;
};

export type BriefThemeRef = {
  themeId: string;
  label: string;
  size: number;
  /** Cosine similarity to the project centroid (0..1 for unit vectors). */
  score: number;
};

export type ProjectBriefInput = {
  projectId: string;
  name: string;
  description: string | null;
  lifecycleState: string;
  livingDoc: { text: string; chars: number; truncated: boolean };
  /** Live notes, most recently updated first, capped at `BRIEF_MAX_NOTES`. */
  notes: BriefNoteRef[];
  /** Every live linked note — the honest denominator. */
  notesTotal: number;
  /** Soft-deleted rows that were refused. */
  notesHiddenDeleted: number;
  /** Live notes beyond the listed cap. */
  notesOmitted: number;
  /** Live notes updated inside the recency window, capped. */
  recentNotes: BriefNoteRef[];
  recentCount: number;
  recentWindowDays: number;
  subProjects: BriefSubProjectRef[];
  subProjectsTotal: number;
  subProjectsOmitted: number;
  themes: BriefThemeRef[];
  themesConsidered: number;
  /** The injected instant, ISO-8601, or null when no clock was supplied. */
  asOf: string | null;
};

// ---- the result the use case produces --------------------------------------

export const BRIEF_STATES = ["synthesized", "fallback"] as const;
export type BriefState = (typeof BRIEF_STATES)[number];

export const BRIEF_FALLBACK_REASONS = ["model_unconfigured", "model_failed", "empty_output"] as const;
export type BriefFallbackReason = (typeof BRIEF_FALLBACK_REASONS)[number];

/**
 * Copy for each fallback reason. It is a RULE (what the reader is told about why
 * this is not a synthesis), so it lives here rather than in the component.
 */
export const BRIEF_FALLBACK_TEXT: Record<BriefFallbackReason, string> = {
  model_unconfigured:
    "No model is configured on this deployment, so this is a mechanical digest of the project's own data rather than a synthesis.",
  model_failed:
    "The model could not be reached at the moment this brief was assembled, so this is a mechanical digest of the project's own data.",
  empty_output:
    "The model returned nothing usable for this brief, so this is a mechanical digest of the project's own data.",
};

export type ProjectBriefSummary = {
  notesTotal: number;
  notesShown: number;
  notesHiddenDeleted: number;
  subProjectsTotal: number;
  themes: string[];
  livingDocChars: number;
};

export type ProjectBrief = {
  state: BriefState;
  markdown: string;
  /** The model that answered, or null for a fallback. */
  model: string | null;
  promptVersion: string;
  generatedAt: string | null;
  /** Non-null only for a fallback; a stable code, never upstream error text. */
  reason: BriefFallbackReason | null;
  summary: ProjectBriefSummary;
};

// ---- small helpers ----------------------------------------------------------

function isAbsent(value: unknown): value is null | undefined | "" {
  return value === null || value === undefined || value === "";
}

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

function toIso(value: Date | string | null | undefined): string | null {
  const ms = timestamp(value);
  return ms ? new Date(ms).toISOString() : null;
}

function trimmedOrNull(value: string | null | undefined): string | null {
  if (isAbsent(value)) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function titleOf(row: Pick<BriefNoteRow, "title">): string {
  const title = (row.title ?? "").trim();
  return title || "Untitled";
}

function compareStr(a: string, b: string): number {
  // Explicit "en" locale: a locale-dependent compare makes order depend on the
  // machine that ran it.
  return a.localeCompare(b, "en", { sensitivity: "base" });
}

/**
 * A bounded, deterministic excerpt. Cut on code points (a UTF-16 slice leaves
 * half an emoji), preferring a word boundary, and always reporting the ORIGINAL
 * length so a caller can say how much was withheld. A value that fits comes back
 * whole and WITHOUT an ellipsis — `…` on an untruncated string is a small lie.
 */
export function boundedText(
  source: string | null | undefined,
  max: number,
): { text: string; chars: number; truncated: boolean } {
  const full = source ?? "";
  const points = [...full];
  const chars = points.length;
  if (max <= 0) return { text: "", chars, truncated: chars > 0 };
  if (chars <= max) return { text: full.trim(), chars, truncated: false };

  const cut = points.slice(0, max).join("");
  const lastSpace = cut.search(/\s\S*$/);
  const clipped = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return { text: `${clipped.trimEnd()}…`, chars, truncated: true };
}

// ---- rows that survive ------------------------------------------------------

/** A row is live when its `deleted_at` carries no value. */
export function isLiveBriefRow(row: { deletedAt?: Date | string | null }): boolean {
  return isAbsent(row.deletedAt);
}

// ---- ordering (total comparators) ------------------------------------------

function byNoteId(a: BriefNoteRow, b: BriefNoteRow): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The brief's note order: most recently updated first, then most recently
 * linked, then id. Total on purpose — two notes with identical timestamps still
 * have one defined order, so the brief cannot reshuffle between renders.
 */
export function compareBriefNotes(a: BriefNoteRow, b: BriefNoteRow): number {
  const updated = timestamp(b.updatedAt) - timestamp(a.updatedAt);
  if (updated !== 0) return updated;
  const added = timestamp(b.addedAt) - timestamp(a.addedAt);
  if (added !== 0) return added;
  return byNoteId(a, b);
}

export function sortBriefNotes<T extends BriefNoteRow>(rows: T[]): T[] {
  return [...rows].sort(compareBriefNotes);
}

function bySubId(a: BriefSubProjectRow, b: BriefSubProjectRow): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Sub-projects read alphabetically, then by id — total, like every comparator here. */
export function compareBriefSubProjects(a: BriefSubProjectRow, b: BriefSubProjectRow): number {
  const byName = compareStr((a.name ?? "").trim() || "Untitled", (b.name ?? "").trim() || "Untitled");
  return byName !== 0 ? byName : bySubId(a, b);
}

// ---- theme matching (pure; reads themes, never recomputes them) -------------

function normalize(vector: ReadonlyArray<number>): number[] | null {
  let sumSquares = 0;
  for (const x of vector) {
    if (!Number.isFinite(x)) return null;
    sumSquares += x * x;
  }
  const norm = Math.sqrt(sumSquares);
  // A norm that underflows float precision has no direction; refusing it beats
  // ranking arbitrary themes against noise.
  if (!Number.isFinite(norm) || norm < 1e-9) return null;
  return vector.map((x) => x / norm);
}

/** Mean-then-normalize a set of vectors into ONE unit direction, or null. */
export function briefCentroid(vectors: ReadonlyArray<ReadonlyArray<number>>): number[] | null {
  if (vectors.length === 0) return null;
  const dim = vectors[0].length;
  if (dim === 0) return null;
  for (const v of vectors) if (v.length !== dim) return null;

  const mean = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) {
      const x = v[i];
      if (!Number.isFinite(x)) return null;
      mean[i] += x;
    }
  }
  for (let i = 0; i < dim; i++) mean[i] /= vectors.length;
  return normalize(mean);
}

function cosine(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number | null {
  if (a.length !== b.length || a.length === 0) return null;
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return null;
  let dot = 0;
  for (let i = 0; i < na.length; i++) dot += na[i] * nb[i];
  return dot;
}

/**
 * Which themes the project TOUCHES: the linked notes' embeddings become one
 * project centroid, and each theme's own centroid is scored against it by
 * cosine. A theme with no usable centroid is skipped (it cannot be substantiated
 * — the same honesty rule the rest of the app uses); a degenerate centroid is
 * refused rather than ranked. Order is score desc, then theme size, then id.
 *
 * `themes` are READ from `nexalog.memory_themes` upstream. Nothing here
 * recomputes them.
 */
export function matchProjectThemes(
  notes: ReadonlyArray<Pick<BriefNoteRow, "embedding">>,
  themes: ReadonlyArray<BriefThemeRow>,
  options: { minScore?: number; max?: number } = {},
): BriefThemeRef[] {
  const minScore = options.minScore ?? BRIEF_THEME_MIN_SCORE;
  const max = options.max ?? BRIEF_MAX_THEMES;
  if (max <= 0) return [];

  const vectors: number[][] = [];
  for (const note of notes) {
    const vector = note.embedding;
    if (Array.isArray(vector) && vector.length > 0) vectors.push([...vector]);
  }
  const centroid = briefCentroid(vectors);
  if (!centroid) return [];

  const matched: BriefThemeRef[] = [];
  for (const theme of themes) {
    const vector = theme.centroid;
    if (!vector || vector.length === 0) continue;
    const score = cosine(centroid, vector);
    if (score === null || score < minScore) continue;
    matched.push({
      themeId: theme.themeId,
      label: theme.label,
      size: Math.max(0, Math.trunc(theme.size ?? 0)),
      score,
    });
  }

  matched.sort(
    (a, b) =>
      b.score - a.score ||
      b.size - a.size ||
      (a.themeId < b.themeId ? -1 : a.themeId > b.themeId ? 1 : 0),
  );
  return matched.slice(0, max);
}

// ---- assembly ---------------------------------------------------------------

function toNoteRef(row: BriefNoteRow): BriefNoteRef {
  const size = typeof row.contentLength === "number" && Number.isFinite(row.contentLength) ? row.contentLength : 0;
  return {
    id: row.id,
    title: titleOf(row),
    date: trimmedOrNull(row.date),
    updatedAt: toIso(row.updatedAt),
    addedAt: toIso(row.addedAt),
    sizeChars: Math.max(0, Math.trunc(size)),
  };
}

/**
 * Assemble the deterministic synthesis input for one project.
 *
 * Returns `null` when the project itself is soft-deleted — there is no brief for
 * a deleted project, and saying so here keeps every caller (route, page, job)
 * agreeing on that without repeating the check.
 */
export function assembleProjectBriefInput(
  source: ProjectBriefSource,
  options: { now?: Date | string | null } = {},
): ProjectBriefInput | null {
  if (!isLiveBriefRow(source.project)) return null;

  const nowMs = options.now == null ? null : timestamp(options.now);

  const liveNotes = source.notes.filter(isLiveBriefRow);
  const orderedNotes = sortBriefNotes(liveNotes);
  const notes = orderedNotes.slice(0, BRIEF_MAX_NOTES).map(toNoteRef);

  const recentWindowMs = BRIEF_RECENT_NOTE_DAYS * 24 * 60 * 60 * 1000;
  const recent =
    nowMs === null
      ? []
      : orderedNotes.filter((row) => {
          const at = timestamp(row.updatedAt) || timestamp(row.addedAt) || timestamp(row.date);
          return at > 0 && nowMs - at <= recentWindowMs;
        });

  const liveSubProjects = source.subProjects.filter(isLiveBriefRow);
  const orderedSubProjects = [...liveSubProjects].sort(compareBriefSubProjects);

  const themes = matchProjectThemes(liveNotes, source.themes ?? []);

  return {
    projectId: source.project.id,
    name: trimmedOrNull(source.project.name) ?? "Untitled",
    description: trimmedOrNull(source.project.description),
    lifecycleState: trimmedOrNull(source.project.lifecycleState) ?? "unknown",
    livingDoc: boundedText(source.project.livingDoc, BRIEF_MAX_LIVING_DOC_CHARS),
    notes,
    notesTotal: liveNotes.length,
    notesHiddenDeleted: source.notes.length - liveNotes.length,
    notesOmitted: Math.max(0, liveNotes.length - notes.length),
    recentNotes: recent.slice(0, BRIEF_RECENT_NOTES_MAX).map(toNoteRef),
    recentCount: recent.length,
    recentWindowDays: BRIEF_RECENT_NOTE_DAYS,
    subProjects: orderedSubProjects.slice(0, BRIEF_MAX_SUB_PROJECTS).map((sub) => ({
      id: sub.id,
      name: trimmedOrNull(sub.name) ?? "Untitled",
      lifecycleState: trimmedOrNull(sub.lifecycleState) ?? "unknown",
    })),
    subProjectsTotal: liveSubProjects.length,
    subProjectsOmitted: Math.max(0, liveSubProjects.length - BRIEF_MAX_SUB_PROJECTS),
    themes,
    themesConsidered: (source.themes ?? []).length,
    asOf: nowMs === null ? null : new Date(nowMs).toISOString(),
  };
}

// ---- the prompt input block -------------------------------------------------

function noteLine(note: BriefNoteRef): string {
  const date = note.date ?? "no date";
  const updated = note.updatedAt ?? "unknown";
  return `- [${date}] ${note.title} (${note.sizeChars} chars; updated ${updated})`;
}

/**
 * The deterministic text block handed to the model as DATA. It is built from the
 * assembled input only — no note body, no clock read — so two calls over the
 * same project produce byte-identical blocks and a prompt diff is meaningful.
 */
export function renderBriefSynthesisInput(input: ProjectBriefInput): string {
  const lines: string[] = [
    "PROJECT DATA (structured; deterministic; no note bodies)",
    `Project: ${input.name}`,
    `Lifecycle: ${input.lifecycleState}`,
    `As of: ${input.asOf ?? "unknown"}`,
    `Description: ${input.description ?? "(none)"}`,
    `Living document: ${input.livingDoc.chars} chars${input.livingDoc.truncated ? " (truncated)" : ""}`,
    input.livingDoc.text || "(empty)",
    "",
    `Linked notes: ${input.notesTotal} live; ${input.notesHiddenDeleted} soft-deleted (withheld)`,
    `Notes (most recently updated first; showing ${input.notes.length} of ${input.notesTotal}):`,
  ];

  if (input.notes.length === 0) {
    lines.push("- (none)");
  } else {
    for (const note of input.notes) lines.push(noteLine(note));
    if (input.notesOmitted > 0) lines.push(`- (+${input.notesOmitted} more not listed)`);
  }

  lines.push("", `Recent activity (updated within ${input.recentWindowDays} days): ${input.recentCount}`);
  if (input.recentNotes.length === 0) {
    lines.push("- (none)");
  } else {
    for (const note of input.recentNotes) lines.push(noteLine(note));
  }

  lines.push(
    "",
    `Sub-projects: ${input.subProjectsTotal} live (showing ${input.subProjects.length})`,
  );
  if (input.subProjects.length === 0) {
    lines.push("- (none)");
  } else {
    for (const sub of input.subProjects) lines.push(`- ${sub.name} (${sub.lifecycleState})`);
    if (input.subProjectsOmitted > 0) lines.push(`- (+${input.subProjectsOmitted} more not listed)`);
  }

  lines.push(
    "",
    `Themes matched by embedding similarity: ${input.themes.length} of ${input.themesConsidered}`,
  );
  if (input.themes.length === 0) {
    lines.push("- (none)");
  } else {
    for (const theme of input.themes) {
      lines.push(`- ${theme.label} (size ${theme.size}; similarity ${theme.score.toFixed(3)})`);
    }
  }

  return lines.join("\n");
}

// ---- the not-synthesized fallback ------------------------------------------

function bullet(lines: string[], condition: boolean, text: string): void {
  if (condition) lines.push(text);
}

/**
 * The render shown when no model answered. It is clearly LABELLED as not
 * synthesized (the reader must never mistake a mechanical digest for a model's
 * summary) and it is built from the same deterministic input, so an empty
 * project renders a designed digest rather than a blank region.
 */
export function renderFallbackBrief(
  input: ProjectBriefInput,
  reason: BriefFallbackReason,
): string {
  const lines: string[] = [
    `# ${input.name} — project brief`,
    "",
    `> **${BRIEF_FALLBACK_LABEL}.** ${BRIEF_FALLBACK_TEXT[reason]}`,
    "",
    "## What this project is",
  ];

  if (input.description) lines.push(input.description);
  if (input.livingDoc.text) {
    lines.push(
      "",
      `_Living document (${input.livingDoc.chars} chars${input.livingDoc.truncated ? ", excerpt shown" : ""}):_`,
      "",
      input.livingDoc.text,
    );
  }
  if (!input.description && !input.livingDoc.text) {
    lines.push("No description and no living document content yet.");
  }

  lines.push("", "## Current state");
  lines.push(`- Lifecycle: ${input.lifecycleState}`);
  lines.push(
    `- Linked notes: ${input.notesTotal}` +
      (input.notesHiddenDeleted > 0 ? ` (${input.notesHiddenDeleted} soft-deleted, withheld)` : ""),
  );
  lines.push(`- Sub-projects: ${input.subProjectsTotal}`);
  bullet(lines, input.themes.length > 0, `- Themes: ${input.themes.map((t) => t.label).join(", ")}`);

  lines.push("", "## Active threads");
  if (input.notes.length === 0) {
    lines.push("No linked notes yet — this project groups nothing so far.");
  } else {
    for (const note of input.notes.slice(0, 10)) {
      lines.push(`- ${note.title}${note.date ? ` (${note.date})` : ""}`);
    }
    if (input.notesTotal > 10) lines.push(`- (+${input.notesTotal - 10} more linked notes)`);
  }

  lines.push("", "## Recent activity");
  if (input.recentCount === 0) {
    lines.push(`Nothing updated in the last ${input.recentWindowDays} days.`);
  } else {
    for (const note of input.recentNotes) {
      lines.push(`- ${note.title}${note.updatedAt ? ` — updated ${note.updatedAt}` : ""}`);
    }
  }

  lines.push(
    "",
    "## Open questions",
    "_Not synthesized — open questions require a model. Set `LLM_BASE_URL` and `LLM_API_KEY` to generate them._",
  );

  return lines.join("\n");
}

// ---- model output guardrails -----------------------------------------------

/**
 * Constrain model output before it is displayed: it must be a non-empty string,
 * a single surrounding code fence is unwrapped (models add one reflexively), and
 * the result is capped at a hard ceiling so a runaway response cannot be
 * rendered whole. `null` means "nothing usable" — the caller renders the
 * fallback rather than an empty section.
 */
export function sanitizeBriefMarkdown(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let text = raw.replace(/\r\n/g, "\n").trim();
  const fenced = /^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/.exec(text);
  if (fenced) text = fenced[1].trim();
  if (!text) return null;

  const points = [...text];
  if (points.length > BRIEF_MAX_OUTPUT_CHARS) {
    text = `${points.slice(0, BRIEF_MAX_OUTPUT_CHARS).join("")}\n\n…`;
  }
  return text;
}

/** The compact counts the API returns alongside the markdown. */
export function briefSummary(input: ProjectBriefInput): ProjectBriefSummary {
  return {
    notesTotal: input.notesTotal,
    notesShown: input.notes.length,
    notesHiddenDeleted: input.notesHiddenDeleted,
    subProjectsTotal: input.subProjectsTotal,
    themes: input.themes.map((theme) => theme.label),
    livingDocChars: input.livingDoc.chars,
  };
}
