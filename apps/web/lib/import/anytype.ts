// SPDX-License-Identifier: MIT
/**
 * AnyType Markdown-export parser + import planner — pure functions only.
 *
 * No `fs`, no database, no git here: the caller (`apps/web/scripts/reimport-anytype.ts`)
 * does the I/O and the writes. That split is what makes every decision below unit-testable
 * without a fixture directory, a Postgres connection, or a brain repo on disk.
 *
 * ── The export format this reads (anyproto/anytype-heart, Markdown export) ────────────────
 *
 *   Anytype.<YYYYMMDD>.<HHMMSS>.<nn>/       uniqName() in core/block/export/writer.go
 *   ├── <slug-of-title>.md                  FLAT — one file per exported object, no type dirs
 *   ├── files/<slug>.<ext>                  raw attachments (referenced as files/x.png)
 *   └── schemas/<type>.schema.json          only when properties+schema is on
 *
 * Each `.md` starts with a YAML frontmatter block whose FIRST line is a comment naming the
 * type schema — `# yaml-language-server: $schema=schemas/note.schema.json`:
 *
 *   ---
 *   # yaml-language-server: $schema=schemas/task.schema.json
 *   Object type: Task
 *   Tags:
 *       - errands
 *   Due date: "2026-09-25"
 *   id: bafyrei…                            ALWAYS the last key
 *   ---
 *
 * Three consequences the code below is built around, all from the recon report:
 *
 *  1. **Identity is the frontmatter `id`, never the filename.** The filename is
 *     `slug.Make(title)` truncated to 48 chars with a `_<random>` collision suffix, so it is
 *     neither unique nor stable. An object with no `id` is NOT imported (SKIP, with a reason).
 *  2. **Property display names are user-defined** (relation `Name`), so nothing may hardcode
 *     `Tags` / `Source` / `Due date`. Values are found structurally: a URL is a URL, a date-
 *     shaped value under a `created*` label is the created date.
 *  3. **Only the body's H1 is the object title.** The exporter writes the object name as the
 *     first heading of the body; the frontmatter carries no title.
 *
 * Deliberate limits (see the script's report): the YAML subset parser below covers what the
 * exporter emits — flat scalars, quoted scalars, numbers/booleans, and block sequences of
 * scalars — not full YAML (no anchors, no flow collections, no nested maps, no multi-document).
 * Anything it cannot parse is kept as a raw string plus a `warnings[]` entry rather than
 * throwing, so one odd property cannot abort a whole migration.
 */

import { Slug } from "@nexalog/core";
import type { PageType } from "@nexalog/core";
import { classifyUrl } from "@/lib/capture/classifier";
import type { ClassifiedKind } from "@/lib/capture/classifier";
import { normalizeUrl } from "@/lib/url-normalize";

/** One parsed AnyType object (one `.md` file in the export root). */
export interface AnytypeObject {
  /** `id:` from the frontmatter — the object's real identity. `null` ⇒ do not import. */
  id: string | null;
  /** Export filename (e.g. `buy-milk.md`). Provenance and diagnostics only — never identity. */
  sourceFileName: string;
  /** AnyType type: the `Object type` label, else the schema-ref hint, else `null`. */
  rawType: string | null;
  /** `schemas/<x>.schema.json` from the language-server comment line, or `null`. */
  schemaRef: string | null;
  /** Object name: body H1 → a `name`/`title` property → first markdown link text → filename stem. */
  title: string;
  /** Markdown body, verbatim except the leading H1 and trailing whitespace. */
  body: string;
  /** Every http(s) URL found in frontmatter values, in key order. */
  frontmatterUrls: string[];
  /** Every http(s) URL found in the body (markdown link targets included). */
  bodyUrls: string[];
  /** Parsed frontmatter, verbatim (property display name → value). */
  frontmatter: Record<string, unknown>;
  /** True when the file had a well-formed `---` … `---` block. */
  frontmatterFound: boolean;
  /** Non-fatal parse problems (raw text kept, value degraded). */
  warnings: string[];
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// YAML subset parser
// ─────────────────────────────────────────────────────────────────────────────────────────────

const OPEN_DELIMITER_RE = /^---[ \t]*\r?\n/;

/**
 * Split an AnyType Markdown export file into frontmatter + body. Mirrors the brain store's
 * `splitFrontmatter` (leading `---\n`, block ends at the next `\n---`) but tolerates a missing
 * block instead of throwing.
 */
export function splitAnytypeFrontmatter(text: string): {
  frontmatterText: string | null;
  body: string;
} {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!OPEN_DELIMITER_RE.test(normalized)) {
    return { frontmatterText: null, body: normalized };
  }
  const rest = normalized.slice(normalized.indexOf("\n") + 1);
  const closeMatch = /^---[ \t]*$/m.exec(rest);
  if (!closeMatch) {
    return { frontmatterText: null, body: normalized };
  }
  const frontmatterText = rest.slice(0, closeMatch.index);
  const bodyStart = closeMatch.index + closeMatch[0].length;
  const body = rest.slice(bodyStart).replace(/^\n/, "");
  return { frontmatterText, body };
}

interface FrontmatterParse {
  frontmatter: Record<string, unknown>;
  schemaRef: string | null;
  warnings: string[];
}

const SCHEMA_REF_RE = /\$schema=(\S+)/;
const KEY_LINE_RE = /^([^:]+):(?:[ \t]+(.*))?$/;
const SEQUENCE_ITEM_RE = /^[ \t]*-[ \t]+(.*)$/;
const INT_OR_FLOAT_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Parse the exporter's flat property map. Never throws — unparseable lines become warnings. */
export function parseAnytypeFrontmatter(frontmatterText: string): FrontmatterParse {
  const frontmatter: Record<string, unknown> = {};
  const warnings: string[] = [];
  let schemaRef: string | null = null;
  const lines = frontmatterText.split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "") continue;

    const schemaMatch = SCHEMA_REF_RE.exec(line);
    if (line.trimStart().startsWith("#")) {
      if (schemaMatch && schemaRef === null) schemaRef = schemaMatch[1];
      continue;
    }

    if (/^[ \t]/.test(line)) {
      // An indented line with no owning key: the exporter never writes one.
      warnings.push(`orphan indented line ignored: ${line.trim()}`);
      continue;
    }

    const keyMatch = KEY_LINE_RE.exec(line);
    if (!keyMatch) {
      warnings.push(`unparsed frontmatter line ignored: ${line.trim()}`);
      continue;
    }
    const key = keyMatch[1].trim();
    const inlineValue = keyMatch[2]?.trim() ?? "";

    // Collect the indented block belonging to this key.
    const block: string[] = [];
    while (i + 1 < lines.length && /^[ \t]/.test(lines[i + 1])) {
      block.push(lines[i + 1]);
      i += 1;
    }

    let value: unknown;
    if (block.length > 0 && /^[ \t]*-[ \t]+/.test(block[0])) {
      value = block
        .filter((l) => l.trim() !== "")
        .map((l) => {
          const item = SEQUENCE_ITEM_RE.exec(l);
          if (!item) {
            warnings.push(`unparsed sequence item in "${key}": ${l.trim()}`);
            return l.trim();
          }
          return parseScalar(item[1]);
        });
    } else if (block.length > 0) {
      // yaml.v3 wraps long plain scalars onto indented continuation lines; fold them back.
      value = parseScalar([inlineValue, ...block.map((l) => l.trim())].filter(Boolean).join(" "));
    } else if (inlineValue === "") {
      value = null;
    } else {
      value = parseScalar(inlineValue);
    }

    if (Object.prototype.hasOwnProperty.call(frontmatter, key)) {
      warnings.push(`duplicate property name "${key}" — later value wins`);
    }
    frontmatter[key] = value;
  }

  return { frontmatter, schemaRef, warnings };
}

/** Scalar only: quoted string, boolean, number, null, or plain string (dates stay strings). */
function parseScalar(raw: string): unknown {
  const value = raw.trim();
  if (value === "") return null;
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === "true";
  if (/^(null|~)$/i.test(value)) return null;
  if (INT_OR_FLOAT_RE.test(value)) return Number(value);
  return value;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Value extraction
// ─────────────────────────────────────────────────────────────────────────────────────────────

const URL_RE = /^https?:\/\/\S+$/i;
const BODY_URL_RE = /https?:\/\/[^\s)\]>"'`]+/g;
const MARKDOWN_LINK_RE = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/;
const H1_RE = /^#[ \t]+(\S.*)$/;

/** The object title lives in the body H1; the filename is only the last resort. */
function headingsAndLinks(body: string): { h1: string | null; rest: string; linkText: string | null } {
  const lines = body.split("\n");
  let firstContentLine = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() !== "") {
      firstContentLine = i;
      break;
    }
  }
  let h1: string | null = null;
  const kept = [...lines];
  if (firstContentLine !== -1) {
    const m = H1_RE.exec(lines[firstContentLine]);
    if (m) {
      h1 = m[1].trim();
      kept.splice(firstContentLine, 1);
    }
  }
  const rest = kept.join("\n").replace(/^\n+/, "");
  const link = MARKDOWN_LINK_RE.exec(rest);
  const linkText = link && link[1].trim() !== "" ? link[1].trim() : null;
  return { h1, rest, linkText };
}

function nameFromFrontmatter(frontmatter: Record<string, unknown>): string | null {
  for (const key of Object.keys(frontmatter)) {
    if (!/^(name|title)$/i.test(key.trim())) continue;
    const value = frontmatter[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

function collectUrls(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (URL_RE.test(trimmed)) out.push(trimmed);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, out);
  }
}

/** Parse one export file. Total: never throws, degrades to warnings. */
export function parseAnytypeExportFile(text: string, sourceFileName: string): AnytypeObject {
  const { frontmatterText, body: rawBody } = splitAnytypeFrontmatter(text);
  const parsed: FrontmatterParse =
    frontmatterText === null
      ? {
          frontmatter: {},
          schemaRef: null,
          warnings:
            frontmatterText === null && !OPEN_DELIMITER_RE.test(text.replace(/\r\n/g, "\n"))
              ? ["no frontmatter block (file does not start with ---)"]
              : ["unterminated frontmatter block (no closing ---)"],
        }
      : parseAnytypeFrontmatter(frontmatterText);

  const { h1, rest, linkText } = headingsAndLinks(rawBody);
  const stem = sourceFileName.replace(/\.md$/i, "");

  const idValue = parsed.frontmatter.id;
  const id =
    typeof idValue === "string" && idValue.trim() !== ""
      ? idValue.trim()
      : typeof idValue === "number"
        ? String(idValue)
        : null;

  const rawType = deriveRawType(parsed.frontmatter, parsed.schemaRef);
  const title = h1 ?? nameFromFrontmatter(parsed.frontmatter) ?? linkText ?? stem;

  const frontmatterUrls: string[] = [];
  for (const value of Object.values(parsed.frontmatter)) collectUrls(value, frontmatterUrls);
  const bodyUrls = rest.match(BODY_URL_RE) ?? [];

  return {
    id,
    sourceFileName,
    rawType,
    schemaRef: parsed.schemaRef,
    title,
    body: rest.trimEnd(),
    frontmatterUrls,
    bodyUrls,
    frontmatter: parsed.frontmatter,
    frontmatterFound: frontmatterText !== null,
    warnings: parsed.warnings,
  };
}

/**
 * AnyType writes the object type as the `Object type` system relation (whose label is
 * version-dependent), and the language-server comment carries the schema file name. Prefer the
 * explicit property; fall back to the schema ref (`note.schema.json` → `note`).
 */
function deriveRawType(frontmatter: Record<string, unknown>, schemaRef: string | null): string | null {
  for (const key of Object.keys(frontmatter)) {
    if (!/^(object[ _-]?type|type)$/i.test(key.trim())) continue;
    const value = frontmatter[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  if (schemaRef) {
    const base = schemaRef.split("/").pop() ?? "";
    const name = base.replace(/\.schema\.json$/i, "").trim();
    if (name !== "") return name.replace(/_/g, " ");
  }
  return null;
}

/** Human display name for any type: the schema ref is snake-cased, so undo that for matching. */
export function normalizeTypeLabel(rawType: string | null): string | null {
  if (!rawType) return null;
  return rawType.trim().toLowerCase().replace(/[\s_]+/g, " ");
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Type mapping — AnyType type → Nexalog destination
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Type → directory is a CONVENTION, not code-enforced (`savePage` writes wherever the slug
 * points); `person → people/` etc. mirrors the live brain tree and gbrain's page list.
 * AnyType's generic `Page` has no Nexalog `PageType` member, so it lands as `note` in `notes/`.
 */
const PAGE_TYPE_MAP: Record<string, { pageType: PageType; dir: string }> = {
  note: { pageType: "note", dir: "notes" },
  page: { pageType: "note", dir: "notes" },
  concept: { pageType: "concept", dir: "concepts" },
  person: { pageType: "person", dir: "people" },
  company: { pageType: "company", dir: "companies" },
  project: { pageType: "project", dir: "projects" },
};

/** AnyType object types that are a saved URL rather than prose. */
const BOOKMARK_TYPES = new Set(["bookmark", "link", "url"]);

export type AnytypeDisposition =
  | { disposition: "capture" }
  | { disposition: "page"; pageType: PageType; dir: string }
  | { disposition: "unsupported" };

export function mapAnytypeType(rawType: string | null): AnytypeDisposition {
  const label = normalizeTypeLabel(rawType);
  if (label === null) return { disposition: "unsupported" };
  if (BOOKMARK_TYPES.has(label)) return { disposition: "capture" };
  const mapped = PAGE_TYPE_MAP[label];
  if (mapped) return { disposition: "page", pageType: mapped.pageType, dir: mapped.dir };
  return { disposition: "unsupported" };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Slugs — validated against the app's own Slug.of, never sanitized silently
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Mirrors AnyType's own namer (`slug.Make(title)` truncated to 48 chars). */
export const SLUG_MAX_LENGTH = 48;

/**
 * ASCII-fold, lowercase, and collapse every run of non-`[a-z0-9]` into a single `-`.
 * The result is always a legal slug segment or the empty string — it never contains a `/`,
 * a leading `.`/`-`, or a non-ASCII byte, so it cannot escape its `<type>/` directory.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, "");
}

/**
 * A slug is valid iff the app's own `Slug.of` accepts it — the same rule the inbox walk
 * enforces (`packages/core/src/domain/slug.ts`), so a planned path can never be the invalid
 * filename that turns a brain-repo read into an outage.
 */
export function isValidSlugPath(path: string): boolean {
  try {
    Slug.of(path);
    return true;
  } catch {
    return false;
  }
}

/** Title → slug, falling back to the object id (ids are base32-ish lowercase alphanumerics). */
export function deriveSlug(title: string, id: string): string | null {
  const fromTitle = slugify(title);
  if (fromTitle !== "") return fromTitle;
  const fromId = slugify(id);
  return fromId === "" ? null : `anytype-${fromId.slice(0, 16)}`;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Dates
// ─────────────────────────────────────────────────────────────────────────────────────────────

const CREATED_LABEL_RES = [
  /^created$/,
  /^created[ _-]?(date|at|time)$/,
  /^date[ _-]?created$/,
  /^creation[ _-]?(date|time)$/,
  /^createddate$/,
];

const UPDATED_LABEL_RES = [
  /^last[ _-]?modified$/,
  /^last[ _-]?modified[ _-]?(date|at|time)$/,
  /^modified$/,
  /^updated$/,
  /^updated[ _-]?(at|date)$/,
];

/**
 * Parse an AnyType date value. The exporter writes date-only relations as quoted
 * `"2026-09-25"` and date+time as `"2026-09-24T14:05:00Z"`. Values outside
 * 1970–2100 are rejected: a malformed date would silently reorder the whole bookmarks list.
 */
export function toDate(value: unknown): Date | null {
  let date: Date;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "number") {
    date = new Date(value);
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(trimmed)) return null;
    date = new Date(trimmed);
  } else {
    return null;
  }
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  if (year < 1970 || year > 2100) return null;
  return date;
}

/** First frontmatter value whose label looks like a creation timestamp, in label order. */
export function pickCreatedAt(frontmatter: Record<string, unknown>): Date | null {
  return pickDateByLabels(frontmatter, CREATED_LABEL_RES);
}

/** First frontmatter value whose label looks like a modification timestamp. */
export function pickUpdatedAt(frontmatter: Record<string, unknown>): Date | null {
  return pickDateByLabels(frontmatter, UPDATED_LABEL_RES);
}

function pickDateByLabels(
  frontmatter: Record<string, unknown>,
  labelRes: readonly RegExp[],
): Date | null {
  const keys = Object.keys(frontmatter);
  for (const re of labelRes) {
    for (const key of keys) {
      if (!re.test(key.trim().toLowerCase())) continue;
      const date = toDate(frontmatter[key]);
      if (date) return date;
    }
  }
  return null;
}

/** The bookmark URL: first frontmatter URL, else the first URL in the body. */
export function pickUrl(object: AnytypeObject): string | null {
  return object.frontmatterUrls[0] ?? object.bodyUrls[0] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Plan
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type CaptureAction = "INSERT" | "SKIP-duplicate";
export type PageAction = "WRITE" | "SKIP-duplicate";
export type SkipAction = "SKIP-unsupported";

export interface PlannedCapture {
  target: "capture_sources";
  action: CaptureAction;
  reason: string;
  sourceFileName: string;
  anytypeId: string;
  rawType: string | null;
  url: string;
  title: string | null;
  bookmarkedAt: Date | null;
  kindClassified: ClassifiedKind;
  urlHost: string;
  urlPath: string;
  payload: Record<string, unknown>;
  destination: string;
}

export interface PlannedPage {
  target: string;
  action: PageAction;
  reason: string;
  sourceFileName: string;
  anytypeId: string;
  rawType: string | null;
  slug: string;
  relPath: string;
  pageType: PageType;
  title: string;
  body: string;
  frontmatter: Record<string, string>;
  destination: string;
}

export interface PlannedSkip {
  target: "—";
  action: SkipAction;
  reason: string;
  sourceFileName: string;
  anytypeId: string | null;
  rawType: string | null;
  destination: string;
}

export interface AnytypePlan {
  captures: PlannedCapture[];
  pages: PlannedPage[];
  skips: PlannedSkip[];
  /** Parsed objects per AnyType type label (unsupported ones included). */
  typeCounts: Array<{ rawType: string; count: number }>;
  warnings: string[];
}

export interface PlanContext {
  /** Normalized URLs already present in `nexalog.capture_sources` for the target workspace. */
  existingCaptureUrls: ReadonlySet<string>;
  /** Repo-relative page path → the `anytype_id` in that file (`null` when it has none). */
  existingPages: ReadonlyMap<string, string | null>;
  /** Timestamp written to `imported_at` and to page frontmatter. */
  importedAt: Date;
  /** Import source string recorded in the provenance columns. */
  importSource: string;
}

/** Turn parsed objects into an explicit, per-item action plan. Pure — no I/O, no writes. */
export function buildPlan(
  objects: readonly AnytypeObject[],
  ctx: PlanContext,
): AnytypePlan {
  const captures: PlannedCapture[] = [];
  const pages: PlannedPage[] = [];
  const skips: PlannedSkip[] = [];
  const warnings: string[] = [];
  const counts = new Map<string, number>();

  // URL dedupe within the export: earliest bookmarkedAt wins (precedent convention).
  const urlOwner = new Map<string, { file: string; bookmarkedAt: Date | null }>();
  // Slug collisions within the export: first object wins the bare slug, later ones get a suffix.
  const pageSlugOwner = new Map<string, string>();

  for (const object of objects) {
    const typeLabel = object.rawType ?? "(unknown)";
    counts.set(typeLabel, (counts.get(typeLabel) ?? 0) + 1);
    for (const warning of object.warnings) {
      warnings.push(`${object.sourceFileName}: ${warning}`);
    }

    if (!object.frontmatterFound) {
      skips.push(
        skip(object, "no frontmatter block found (not an AnyType export object)", "—"),
      );
      continue;
    }
    if (!object.id) {
      skips.push(
        skip(
          object,
          'frontmatter has no "id" — object identity is unrecoverable (the filename is never identity)',
          "—",
        ),
      );
      continue;
    }

    const mapped = mapAnytypeType(object.rawType);
    if (mapped.disposition === "capture") {
      planCapture(object, object.id, ctx, captures, skips, urlOwner);
      continue;
    }
    if (mapped.disposition === "page") {
      planPage(
        object,
        object.id,
        mapped.pageType,
        mapped.dir,
        ctx,
        pages,
        skips,
        pageSlugOwner,
      );
      continue;
    }
    skips.push(
      skip(
        object,
        `unsupported AnyType type "${object.rawType ?? "(none)"}" — no mapping to a capture_sources row or a Nexalog PageType`,
        "—",
      ),
    );
  }

  return {
    captures,
    pages,
    skips,
    typeCounts: [...counts.entries()]
      .map(([rawType, count]) => ({ rawType, count }))
      .sort((a, b) => (a.rawType < b.rawType ? -1 : a.rawType > b.rawType ? 1 : 0)),
    warnings,
  };
}

function skip(object: AnytypeObject, reason: string, destination: string): PlannedSkip {
  return {
    target: "—",
    action: "SKIP-unsupported",
    reason,
    sourceFileName: object.sourceFileName,
    anytypeId: object.id,
    rawType: object.rawType,
    destination,
  };
}

function planCapture(
  object: AnytypeObject,
  id: string,
  ctx: PlanContext,
  captures: PlannedCapture[],
  skips: PlannedSkip[],
  urlOwner: Map<string, { file: string; bookmarkedAt: Date | null }>,
): void {
  const raw = pickUrl(object);
  if (!raw) {
    skips.push(
      skip(object, "Bookmark object with no http(s) URL in its properties or body", "—"),
    );
    return;
  }
  const url = normalizeUrl(raw);
  if (!url) {
    skips.push(skip(object, `"${raw}" is not a usable http(s) URL after normalization`, "—"));
    return;
  }

  const bookmarkedAt = pickCreatedAt(object.frontmatter);
  const payload: Record<string, unknown> = {
    anytype: {
      id,
      type: object.rawType,
      schemaRef: object.schemaRef,
      sourceFileName: object.sourceFileName,
      rawUrl: raw,
    },
    frontmatter: object.frontmatter,
    body: object.body,
  };
  const classified = classifyUrl({ url });
  const base: Omit<PlannedCapture, "action" | "reason"> = {
    target: "capture_sources",
    sourceFileName: object.sourceFileName,
    anytypeId: id,
    rawType: object.rawType,
    url,
    title: object.title.trim() === "" ? null : object.title.trim(),
    bookmarkedAt,
    kindClassified: classified.kind,
    urlHost: classified.host,
    urlPath: classified.path,
    payload,
    destination: `nexalog.capture_sources (workspace-scoped) url=${url}`,
  };

  const owner = urlOwner.get(url);
  const insertReason =
    bookmarkedAt === null
      ? "new URL — no created date found, bookmarked_at stays NULL (display falls back to created_at)"
      : "new URL — bookmarked_at preserved from the AnyType created date";
  const duplicateOf = (
    item: Omit<PlannedCapture, "action" | "reason">,
    keptFrom: string,
  ): PlannedCapture => ({
    ...item,
    action: "SKIP-duplicate",
    reason: `duplicate URL within this export — earliest bookmarked_at kept (from ${keptFrom})`,
  });

  if (!ctx.existingCaptureUrls.has(url)) {
    if (!owner) {
      urlOwner.set(url, { file: object.sourceFileName, bookmarkedAt });
      captures.push({ ...base, action: "INSERT", reason: insertReason });
      return;
    }
    // Later duplicate within the export: keep the earliest bookmarkedAt, drop the rest.
    const winner = owner.bookmarkedAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const candidate = bookmarkedAt?.getTime() ?? Number.POSITIVE_INFINITY;
    if (candidate < winner) {
      const dropped = captures.findIndex(
        (c) => c.action === "INSERT" && c.url === url && c.sourceFileName === owner.file,
      );
      if (dropped !== -1) {
        const [replaced] = captures.splice(dropped, 1);
        // The displaced object keeps its own identity in the plan — it is a duplicate, not
        // "unsupported", and never a reason to lose the object from the accounting.
        captures.push(duplicateOf(replaced, object.sourceFileName));
        captures.push({ ...base, action: "INSERT", reason: insertReason });
        urlOwner.set(url, { file: object.sourceFileName, bookmarkedAt });
        return;
      }
    }
    captures.push(duplicateOf(base, owner.file));
    return;
  }

  captures.push({
    ...base,
    action: "SKIP-duplicate",
    reason: "capture_sources already has this URL in the target workspace",
  });
}

function planPage(
  object: AnytypeObject,
  id: string,
  pageType: PageType,
  dir: string,
  ctx: PlanContext,
  pages: PlannedPage[],
  skips: PlannedSkip[],
  pageSlugOwner: Map<string, string>,
): void {
  let slug = deriveSlug(object.title, id);
  if (slug === null) {
    skips.push(
      skip(object, "title and object id both produced an empty slug — no valid filename", "—"),
    );
    return;
  }

  let relPath = `${dir}/${slug}.md`;
  let collisionNote = "";
  const owner = pageSlugOwner.get(relPath);
  if (owner !== undefined && owner !== id) {
    const suffix = slugify(id).slice(-6) || "dup";
    slug = `${slug}-${suffix}`;
    relPath = `${dir}/${slug}.md`;
    collisionNote = ` (slug collision with ${owner} within this export — suffixed to avoid clobbering)`;
    let n = 2;
    while (pageSlugOwner.has(relPath)) {
      slug = `${slugify(object.title) || "page"}-${suffix}-${n}`;
      relPath = `${dir}/${slug}.md`;
      n += 1;
    }
  }

  // The app's own validator is the gate — a path it rejects must never be planned.
  if (!isValidSlugPath(relPath)) {
    skips.push(
      skip(object, `derived path "${relPath}" is rejected by Slug.of — refusing to write it`, "—"),
    );
    return;
  }
  pageSlugOwner.set(relPath, id);

  const createdAt = pickCreatedAt(object.frontmatter);
  const updatedAt = pickUpdatedAt(object.frontmatter);
  const frontmatter: Record<string, string> = {
    type: pageType,
    title: object.title,
    anytype_id: id,
    import_source: ctx.importSource,
    imported_at: ctx.importedAt.toISOString(),
  };
  if (object.rawType) frontmatter.anytype_type = object.rawType;
  if (createdAt) frontmatter.anytype_created_at = createdAt.toISOString();
  if (updatedAt) frontmatter.anytype_updated_at = updatedAt.toISOString();

  const base = {
    target: relPath,
    sourceFileName: object.sourceFileName,
    anytypeId: id,
    rawType: object.rawType,
    slug,
    relPath,
    pageType,
    title: object.title,
    body: object.body,
    frontmatter,
    destination: relPath,
  };

  const existingId = ctx.existingPages.get(relPath);
  if (existingId === undefined) {
    pages.push({
      ...base,
      action: "WRITE",
      reason: `new brain page (type=${pageType})${collisionNote}`,
    });
    return;
  }
  if (existingId === id) {
    pages.push({
      ...base,
      action: "SKIP-duplicate",
      reason: "brain page already imported from this AnyType object (anytype_id matches)",
    });
    return;
  }
  pages.push({
    ...base,
    action: "SKIP-duplicate",
    reason: `destination exists and was not written by this importer (anytype_id: ${
      existingId ?? "absent"
    }) — refusing to overwrite${collisionNote}`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Page serialization — must survive the brain store's `splitFrontmatter` + js-yaml `load`
// ─────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Serialize a page file exactly the way `FsGitBrainStore.savePage` does
 * (`["---", dump(frontmatter).trim(), "---", body.trimEnd()].join("\n") + "\n"`), with a
 * hand-rolled emitter because `js-yaml` is not a declared dependency of `apps/web`.
 *
 * Values are JSON-quoted: a JSON string is a valid YAML double-quoted scalar, and quoting
 * removes every way a title containing `:`, `#`, or a leading `-` could corrupt the block.
 * A body whose first line is `---` is rejected upstream by the parser (frontmatter split).
 */
export function serializePageFile(frontmatter: Record<string, string>, body: string): string {
  const lines = Object.entries(frontmatter).map(
    ([key, value]) => `${key}: ${JSON.stringify(value)}`,
  );
  return ["---", lines.join("\n"), "---", body.trimEnd()].join("\n") + "\n";
}
