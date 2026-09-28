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
// Email addresses in a title — a person's address must never become a filename
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Operator decision (2026-09-27): **keep the content, but no email address may become a filename.**
 * A slug is searchable and it is in the URL, so an address that lands in one is published.
 *
 * AnyType's own namer is what makes this concrete: `slug.Make` DELETES `@` and turns `.` into `-`,
 * so an address typed into an object's name reaches this importer in one of two shapes —
 *
 *   name@example.com                  the literal address (when the object name survives verbatim)
 *   nameatexample-com                 the collapsed form (what the export FILENAME carries)
 *
 * Both are detected here and replaced by a neutral token derived from the address itself,
 * `sender-<hash>`, so:
 *
 *   • two different senders can never collapse onto one slug (the token is per-address),
 *   • re-running the import derives byte-identical slugs (the hash is stable), and
 *   • the filename no longer contains the address.
 *
 * Detection is deliberately asymmetric: the literal form matches anywhere and on any TLD (an
 * address is unambiguous), while the collapsed form requires a recognized public suffix so ordinary
 * prose cannot be mangled. Over-matching costs an ugly slug; under-matching publishes an address.
 *
 * Honest limit: the token is a *pseudonym*, not removal — the address is still in the page's content
 * (the operator chose `keep the content`), and a short hash of a well-known address is guessable.
 * This stops the address becoming a filename; it does not un-publish the text.
 */

/** A literal address, anywhere in a title. */
const EMAIL_LITERAL_RE =
  /[a-z0-9._%+'-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}/gi;

/** Public suffixes that make `<local>at<domain>-<suffix>` decisively email-shaped, not prose. */
const PUBLIC_SUFFIXES = [
  "com", "net", "org", "edu", "gov", "mil", "int", "info", "biz", "name", "pro", "mobi",
  "io", "co", "us", "uk", "ca", "au", "nz", "de", "fr", "nl", "be", "ch", "at", "it", "es",
  "se", "no", "fi", "dk", "pl", "ru", "cn", "jp", "kr", "in", "br", "mx", "ar", "za",
  "dev", "app", "xyz", "online", "site", "tech", "store", "email", "cloud", "me", "tv", "cc",
];

/**
 * The collapsed form: `<local>` + `at` + `<domain labels>` + `-` + `<suffix>`.
 *
 * The local part deliberately excludes `-`: AnyType writes a collapsed address straight into the
 * FILENAME and the filename can end up embedded in a longer title, so allowing `-` in the local
 * part would let the match swallow a leading word (`re-<address>` → one token hashed over `re-…`).
 * Excluding it keeps the token a function of the address alone, and the local part stays greedy so
 * the engine binds the LAST `at` — the right one for `natalieatgmail-com`.
 */
const EMAIL_COLLAPSED_RE = new RegExp(
  `\\b[a-z0-9][a-z0-9._%+]{0,63}at[a-z0-9][a-z0-9-]{0,62}-(?:${PUBLIC_SUFFIXES.join("|")})\\b`,
  "gi",
);

/** The neutral token prefix. Deliberately not the address, not `redacted`, and not a domain word. */
export const SENDER_TOKEN_PREFIX = "sender";

/**
 * Undo `slug.Make`'s collapse so a collapse followed by its own re-read is stable:
 * `quinntaltyatexample-com` → `quinntalty@example.com`.
 *
 * The collapse is lossy (a `.` in the local part became a `-`, and a `-` looks the same as a `.`),
 * so the literal and collapsed spellings of one address can hash differently when the local part
 * has a dot. That is the export format's information loss, not something a sanitizer can undo; what
 * this guarantees is that each spelling is STABLE, so a re-run derives the same slug.
 */
export function uncollapseAddress(span: string): string {
  const at = span.toLowerCase().lastIndexOf("at");
  if (at <= 0) return span.toLowerCase();
  const local = span.slice(0, at).toLowerCase();
  const domain = span.slice(at + 2).replace(/-/g, ".").toLowerCase();
  return domain === "" ? span.toLowerCase() : `${local}@${domain}`;
}

/**
 * 64-bit FNV-1a over UTF-8 bytes, hex, truncated to 12 chars. Hand-rolled on purpose: this module
 * is dependency-free and imports nothing from `node:` (it is unit-tested and must stay bundle-neutral),
 * and a name-shortening token needs stability and dispersion, not a security property.
 */
export function shortHash(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of new TextEncoder().encode(input)) {
    hash = ((hash ^ BigInt(byte)) * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0").slice(0, 12);
}

/** The stable, collision-free stand-in for one address. */
export function senderToken(address: string): string {
  return `${SENDER_TOKEN_PREFIX}-${shortHash(address.trim().toLowerCase())}`;
}

/** Replace every email-shaped token in a title. Total: returns the input unchanged when none match. */
export function redactEmailTokens(title: string): string {
  const literalRedacted = title.replace(EMAIL_LITERAL_RE, (match) => senderToken(match));
  return literalRedacted.replace(EMAIL_COLLAPSED_RE, (match) => senderToken(uncollapseAddress(match)));
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
 * Title → slug segment, **with every email-shaped token neutralized first**.
 *
 * This is the only sanctioned way to turn a title into a filename: `slugify` alone will happily
 * publish `nameatexample-com` (see the email section above). Nothing that plans a path may call
 * `slugify` on a raw title directly.
 */
export function slugifyTitle(title: string): string {
  return slugify(redactEmailTokens(title));
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

/** Titles slugify to nothing often enough (an emoji-only or non-Latin name) to need a stand-in. */
function deriveIdSlug(id: string): string | null {
  const fromId = slugify(id);
  return fromId === "" ? null : `anytype-${fromId.slice(0, 16)}`;
}

/** Title → slug, falling back to the object id (ids are base32-ish lowercase alphanumerics). */
export function deriveSlug(title: string, id: string): string | null {
  const fromTitle = slugifyTitle(title);
  return fromTitle !== "" ? fromTitle : deriveIdSlug(id);
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
// Attachments — the export's `files/` tree
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * An AnyType attachment reference exactly as the exporter writes it: a path under `files/`.
 * The exporter does NOT always give a file an extension (`files/daily-journal` is a PNG), so
 * nothing here may branch on the extension — a ref is a ref.
 */
const FILE_REF_RE = /^files\/[^\s/]+$/;

/** `![Title](files/x.png)` and `[Title](files/x.pdf)`, with an optional markdown link title. */
const BODY_FILE_REF_RE = /\]\(\s*(files\/[^\s)]+)(?:\s+["'][^"']*["'])?\s*\)/g;

/** Every whole-value `files/…` reference in the parsed frontmatter (relation links), deduped. */
export function collectFrontmatterFileRefs(frontmatter: Record<string, unknown>): string[] {
  const found: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (FILE_REF_RE.test(trimmed)) found.push(trimmed);
      return;
    }
    if (Array.isArray(value)) for (const item of value) walk(item);
  };
  for (const value of Object.values(frontmatter)) walk(value);
  return [...new Set(found)];
}

/** Every `](files/…)` reference in a body, in document order, deduped. */
export function collectBodyFileRefs(body: string): string[] {
  const found: string[] = [];
  for (const match of body.matchAll(BODY_FILE_REF_RE)) found.push(match[1]);
  return [...new Set(found)];
}

/** The exporter's own namer is already slug-safe, but a ref must never be able to escape the dir. */
function sanitizeAttachmentName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "");
  return cleaned === "" ? "attachment" : cleaned;
}

/** `attachments/YYYY/MM` — the brain repo's own media convention (`FsGitBrainStore.saveAttachment`). */
export function attachmentShard(date: Date | null, fallback: Date): string {
  const shardDate = date ?? fallback;
  const month = String(shardDate.getUTCMonth() + 1).padStart(2, "0");
  return `${shardDate.getUTCFullYear()}/${month}`;
}

/**
 * `<brain-repo>/attachments/YYYY/MM/<page slug>-<original file name>`.
 *
 * The page slug is part of the name because `attachments/` is FLAT per month: two pages that both
 * embed `files/image.png` must not overwrite each other's copy, and the same page re-imported must
 * compute the same path (that is what makes a second run a no-op rather than a second copy).
 */
export function attachmentPath(shard: string, slug: string, ref: string): string {
  const name = sanitizeAttachmentName(ref.replace(/^files\//, ""));
  return `attachments/${shard}/${slug}-${name}`;
}

/** Rewrite `](files/…)` targets to their copied location; refs with no destination are left alone. */
export function rewriteBodyFileRefs(body: string, destByRef: ReadonlyMap<string, string>): string {
  return body.replace(BODY_FILE_REF_RE, (whole, ref: string) => {
    const dest = destByRef.get(ref);
    return dest === undefined ? whole : whole.replace(ref, dest);
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Plan
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type CaptureAction = "INSERT" | "SKIP-duplicate";
export type PageAction = "WRITE" | "SKIP-duplicate";
export type SkipAction = "SKIP-unsupported";
export type MediaAction = "COPY" | "SKIP-present" | "MISSING" | "SKIP-no-destination";
/** Where the object referenced the file: the two are not mutually exclusive. */
export type MediaRefKind = "body" | "frontmatter" | "body+frontmatter";

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
  /** The body as it will be written — every `files/…` ref already pointing at its copied location. */
  body: string;
  /** Page frontmatter; `attachments` is a list of repo-relative copied media paths when present. */
  frontmatter: Record<string, string | string[]>;
  /** Repo-relative copied media paths this page references, in first-reference order. */
  attachments: string[];
  /** How many refs this run would rewrite. Always 0 for a SKIP-duplicate page — nothing is written. */
  refsRewritten: number;
  destination: string;
}

/** One attachment reference and what the import does about it. */
export interface PlannedMedia {
  /** The copied path, or `—` when there is nothing to copy to. */
  target: string;
  action: MediaAction;
  reason: string;
  sourceFileName: string;
  anytypeId: string | null;
  /** The reference exactly as the export spells it, e.g. `files/daily-journal`. */
  ref: string;
  refKind: MediaRefKind;
  /** The brain page that references it, or `null` when the object has no page destination. */
  ownerRelPath: string | null;
  /** Repo-relative destination, or `null` when there is none. */
  destRelPath: string | null;
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
  /**
   * Every attachment reference in the export and its disposition. Built for ALL objects, including
   * the ones with no page destination, so the report accounts for every byte in `files/` instead of
   * quietly dropping the ones a Bookmark or a skipped Task was holding.
   */
  media: PlannedMedia[];
  /** Parsed objects per AnyType type label (unsupported ones included). */
  typeCounts: Array<{ rawType: string; count: number }>;
  warnings: string[];
}

export interface PlanContext {
  /** Normalized URLs already present in `nexalog.capture_sources` for the target workspace. */
  existingCaptureUrls: ReadonlySet<string>;
  /** Repo-relative page path → the `anytype_id` in that file (`null` when it has none). */
  existingPages: ReadonlyMap<string, string | null>;
  /** Refs (`files/…`) that actually exist in the export's `files/` directory. */
  availableAttachments: ReadonlySet<string>;
  /** Repo-relative attachment paths already on disk in the brain repo. */
  existingAttachments: ReadonlySet<string>;
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
  const media: PlannedMedia[] = [];
  const warnings: string[] = [];
  const counts = new Map<string, number>();

  // URL dedupe within the export: earliest bookmarkedAt wins (precedent convention).
  const urlOwner = new Map<string, { file: string; bookmarkedAt: Date | null }>();
  // Slug collisions within the export: first object wins the bare slug, later ones get a suffix.
  const pageSlugOwner = new Map<string, string>();
  // Objects that became a brain page. Their attachment refs are planned by planPage, which is the
  // only place that knows the final slug; everything else is planned by the detached pass below.
  const pageObjects = new Set<AnytypeObject>();

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
        media,
        pageObjects,
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

  // Attachments held by objects that produced no brain page (bookmarks → capture_sources rows,
  // unsupported types, unusable files). Their binaries are reported rather than copied: there is no
  // page file to rewrite a reference in, and inventing one would be a third destination.
  for (const object of objects) {
    if (pageObjects.has(object)) continue;
    planDetachedMedia(object, ctx, media);
  }

  return {
    captures,
    pages,
    skips,
    media,
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
  media: PlannedMedia[],
  pageObjects: Set<AnytypeObject>,
  pageSlugOwner: Map<string, string>,
): void {
  // `deriveSlug` runs the email sanitizer: a sender's address in the object name must not become
  // the filename, and the same title must yield the same slug on every run.
  const titleSlug = slugifyTitle(object.title);
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
      slug = `${titleSlug || "page"}-${suffix}-${n}`;
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
  pageObjects.add(object);

  // ── attachments ─────────────────────────────────────────────────────────────────────────────
  // Only now is the slug final, so `attachments/YYYY/MM/<slug>-<name>` is stable. The shard comes
  // from the object's own date so it does not slide between runs.
  const bodyRefs = collectBodyFileRefs(object.body);
  const frontmatterRefs = collectFrontmatterFileRefs(object.frontmatter);
  const refs = [...new Set([...frontmatterRefs, ...bodyRefs])];
  const shard = attachmentShard(
    pickCreatedAt(object.frontmatter) ?? pickUpdatedAt(object.frontmatter),
    ctx.importedAt,
  );
  const destByRef = new Map<string, string>();
  const attachments: string[] = [];
  for (const ref of refs) {
    const dest = attachmentPath(shard, slug, ref);
    const inBody = bodyRefs.includes(ref);
    const inFrontmatter = frontmatterRefs.includes(ref);
    const decision = decidePageMedia(ref, dest, ctx);
    media.push({
      ...decision,
      sourceFileName: object.sourceFileName,
      anytypeId: id,
      ref,
      refKind:
        inBody && inFrontmatter ? "body+frontmatter" : inBody ? "body" : "frontmatter",
      ownerRelPath: relPath,
      destRelPath: dest,
    });
    if (decision.action === "COPY" || decision.action === "SKIP-present") {
      destByRef.set(ref, dest);
      attachments.push(dest);
    }
  }
  const rewrittenBody = rewriteBodyFileRefs(object.body, destByRef);

  const createdAt = pickCreatedAt(object.frontmatter);
  const updatedAt = pickUpdatedAt(object.frontmatter);
  const frontmatter: Record<string, string | string[]> = {
    type: pageType,
    title: object.title,
    anytype_id: id,
    import_source: ctx.importSource,
    imported_at: ctx.importedAt.toISOString(),
  };
  if (object.rawType) frontmatter.anytype_type = object.rawType;
  if (createdAt) frontmatter.anytype_created_at = createdAt.toISOString();
  if (updatedAt) frontmatter.anytype_updated_at = updatedAt.toISOString();
  // AnyType's `Image:` / `Picture:` / `Outgoing links:` properties are not part of the page
  // contract, so a frontmatter-only reference would otherwise be lost entirely. The rewritten
  // paths are carried as one additive `attachments:` list (the same key a capture uses).
  if (attachments.length > 0) frontmatter.attachments = attachments;

  const base = {
    target: relPath,
    sourceFileName: object.sourceFileName,
    anytypeId: id,
    rawType: object.rawType,
    slug,
    relPath,
    pageType,
    title: object.title,
    body: rewrittenBody,
    frontmatter,
    attachments,
    destination: relPath,
  };
  const attachmentNote =
    attachments.length > 0 ? ` · ${attachments.length} attachment(s) under attachments/` : "";

  const existingId = ctx.existingPages.get(relPath);
  if (existingId === undefined) {
    pages.push({
      ...base,
      action: "WRITE",
      reason: `new brain page (type=${pageType})${collisionNote}${attachmentNote}`,
      refsRewritten: attachments.length,
    });
    return;
  }
  if (existingId === id) {
    pages.push({
      ...base,
      action: "SKIP-duplicate",
      reason:
        "brain page already imported from this AnyType object (anytype_id matches)" +
        (attachments.length > 0
          ? ` — ${attachments.length} attachment(s) left untouched (nothing is rewritten)`
          : ""),
      refsRewritten: 0,
    });
    return;
  }
  pages.push({
    ...base,
    action: "SKIP-duplicate",
    reason: `destination exists and was not written by this importer (anytype_id: ${
      existingId ?? "absent"
    }) — refusing to overwrite${collisionNote}`,
    refsRewritten: 0,
  });
}

/**
 * What to do about one attachment reference on an object that becomes a brain page.
 * `MISSING` is checked first: a dangling reference must be REPORTED, never invented, and that is
 * true whichever destination the object has.
 */
function decidePageMedia(
  ref: string,
  dest: string,
  ctx: PlanContext,
): { target: string; action: MediaAction; reason: string } {
  if (!ctx.availableAttachments.has(ref)) {
    return {
      target: "—",
      action: "MISSING",
      reason: `no "${ref}" in the export's files/ directory — reported, not invented`,
    };
  }
  if (ctx.existingAttachments.has(dest)) {
    return {
      target: dest,
      action: "SKIP-present",
      reason: `already copied to ${dest} — not copied again (idempotent re-run)`,
    };
  }
  return {
    target: dest,
    action: "COPY",
    reason: `copy ${ref} → ${dest}`,
  };
}

/** Attachments on an object that has no brain page: report them, do not copy them. */
function planDetachedMedia(
  object: AnytypeObject,
  ctx: PlanContext,
  media: PlannedMedia[],
): void {
  const bodyRefs = collectBodyFileRefs(object.body);
  const frontmatterRefs = collectFrontmatterFileRefs(object.frontmatter);
  for (const ref of [...new Set([...frontmatterRefs, ...bodyRefs])]) {
    const inBody = bodyRefs.includes(ref);
    const inFrontmatter = frontmatterRefs.includes(ref);
    const missing = !ctx.availableAttachments.has(ref);
    media.push({
      target: "—",
      action: missing ? "MISSING" : "SKIP-no-destination",
      reason: missing
        ? `no "${ref}" in the export's files/ directory — reported, not invented`
        : `${dispositionLabel(object)} — no brain page to rewrite, so the binary is not copied`,
      sourceFileName: object.sourceFileName,
      anytypeId: object.id,
      ref,
      refKind:
        inBody && inFrontmatter ? "body+frontmatter" : inBody ? "body" : "frontmatter",
      ownerRelPath: null,
      destRelPath: null,
    });
  }
}

/** Why an object produced no page — the attachment report says this instead of inventing a path. */
function dispositionLabel(object: AnytypeObject): string {
  if (!object.frontmatterFound) return "file has no AnyType frontmatter block (skipped)";
  if (!object.id) return "frontmatter has no id (skipped)";
  const mapped = mapAnytypeType(object.rawType);
  if (mapped.disposition === "capture") return "imports as a capture_sources row";
  return `unsupported AnyType type "${object.rawType ?? "(none)"}" (skipped)`;
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
export function serializePageFile(
  frontmatter: Record<string, string | string[]>,
  body: string,
): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      // Block sequence, not a JSON flow list: the repo's own frontmatter reader (js-yaml in the
      // adapters, the subset parser here) both read it, and a human reading the file can too.
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${JSON.stringify(item)}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  return ["---", lines.join("\n"), "---", body.trimEnd()].join("\n") + "\n";
}
