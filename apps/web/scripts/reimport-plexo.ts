// SPDX-License-Identifier: MIT
/**
 * reimport-plexo.ts — the frozen Plexo link export → `nexalog.capture_sources`.
 *
 * One-shot, additive, idempotent. The export (`plexo-links.jsonl`, one JSON object per line:
 * `{url, text, seen}` — the url field carries a stray title fragment after a newline, `text` is
 * a title/url/blurb blob, `seen` is the day he saved it) becomes one `kind='url'` row per link in
 * `capture_sources` — the only table carrying the import-provenance columns (`bookmarked_at` =
 * the upstream save date, `imported_at` = this run, `import_source` = 'plexo', `source_payload` =
 * the raw record) and a live surface (`GET /api/bookmarks`, the `/api/search` captures branch).
 * Bulk content is deliberately NOT written as `inbox/<ULID>.md` captures: a capture is intake
 * work queued for an operator, and one bad enum member breaks the entire inbox read.
 *
 * Guarantees
 *  - `--dry-run` performs ZERO writes: it prints the resolved tenant, the counts and a per-item
 *    plan, then `return`s before the first INSERT.
 *  - Re-running is a no-op: URLs are normalized, deduped within the file, and checked against the
 *    workspace's existing rows. `capture_sources` has NO unique constraint on `url`, so in-code
 *    dedupe is the only guarantee there is; the insert still carries `onConflictDoNothing()`.
 *  - `kind_classified` is set with the app's own offline classifier (`@/lib/classify-url`, no
 *    network, no LLM), which is what makes a row visible to `/api/search`.
 *  - `--enrichment skipped` (the default) keeps a bulk import out of the six enrichment queues;
 *    `--enrichment pending` pre-loads them, exactly like an in-app bookmark save.
 *
 * Run from a clone on HIVE, cwd `apps/web`, on a network that reaches the app database:
 *   DATABASE_URL=… npx tsx scripts/reimport-plexo.ts <plexo-links.jsonl> \
 *     --workspace <uuid> --user-id <uuid> [--dry-run] [--enrichment skipped|pending] [--limit N]
 */
import { readFileSync } from "node:fs";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { classifyUrl } from "@/lib/classify-url";

const IMPORT_SOURCE = "plexo";
/** The upstream export dates are days; anchor them at noon UTC so no US timezone shifts the date. */
const SEEN_ANCHOR_HOUR = 12;

/** One line of the export (`{url, text, seen}`), stored verbatim as `source_payload` (jsonb). */
type RawRecord = Record<string, unknown> & { url?: unknown; text?: unknown; seen?: unknown };

interface Planned {
  url: string;
  title: string | null;
  description: string | null;
  bookmarkedAt: Date | null;
  kindClassified: string;
  urlHost: string | null;
  urlPath: string | null;
  payload: RawRecord;
}

interface Skipped {
  raw: RawRecord;
  reason: string;
}

interface Args {
  file: string;
  workspaceId: string;
  userId: string;
  dryRun: boolean;
  enrichment: "skipped" | "pending";
  limit: number | undefined;
  verbose: boolean;
}

function usage(): never {
  console.error(
    "usage: npx tsx scripts/reimport-plexo.ts <plexo-links.jsonl> --workspace <uuid> --user-id <uuid> " +
      "[--dry-run] [--enrichment skipped|pending] [--limit N] [--verbose]",
  );
  process.exit(2);
}

function parseArgs(argv: readonly string[]): Args {
  const out: Partial<Args> = { dryRun: false, enrichment: "skipped", verbose: false };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--verbose") out.verbose = true;
    else if (a === "--workspace") out.workspaceId = argv[++i];
    else if (a === "--user-id") out.userId = argv[++i];
    else if (a === "--limit") out.limit = Number.parseInt(argv[++i] ?? "", 10);
    else if (a === "--enrichment") {
      const v = argv[++i];
      if (v !== "skipped" && v !== "pending") usage();
      out.enrichment = v;
    } else if (a.startsWith("--")) usage();
    else rest.push(a);
  }
  const file = rest[0];
  if (rest.length !== 1 || !file || !out.workspaceId || !out.userId) usage();
  out.file = file;
  if (out.limit !== undefined && (!Number.isFinite(out.limit) || out.limit < 1)) usage();
  return out as Args;
}

/** The url field carries a title fragment after a newline (or space); keep the URL, drop the tail. */
export function cleanUrl(raw: string): string | null {
  const first = raw.split(/[\s\n]/, 1)[0]?.trim() ?? "";
  if (!/^https?:\/\//i.test(first)) return null;
  return normalizeUrl(first);
}

/** One canonical form for comparison and storage: lowercase host, no fragment, no bare trailing slash. */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    let s = u.toString();
    if (u.pathname === "/" && s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return url.trim();
  }
}

/** `text` is "<title> <url> <blurb>" — split on the URL we already have, best effort, never invent. */
export function splitText(text: string, url: string): { title: string | null; description: string | null } {
  const at = text.indexOf(url);
  const title = (at === -1 ? text : text.slice(0, at)).trim();
  const rest = at === -1 ? "" : text.slice(at + url.length).trim();
  // Many upstream records carry no title and echo a URL as their own description; a description
  // that is just another URL is not information, so it is stored as NULL rather than as noise.
  const description = rest && !/^https?:\/\//i.test(rest) ? rest.slice(0, 2000) : null;
  return { title: title ? title.slice(0, 300) : null, description };
}

function readRecords(file: string): { records: RawRecord[]; malformed: number } {
  const lines = readFileSync(file, "utf8").split("\n");
  const records: RawRecord[] = [];
  let malformed = 0;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try {
      const parsed = JSON.parse(t) as unknown;
      if (parsed && typeof parsed === "object") records.push(parsed as RawRecord);
      else malformed += 1;
    } catch {
      malformed += 1;
    }
  }
  return { records, malformed };
}

function planRecord(raw: RawRecord): Planned | Skipped {
  const url = typeof raw.url === "string" ? cleanUrl(raw.url) : null;
  if (!url) return { raw, reason: "no parseable http(s) url" };
  const text = typeof raw.text === "string" ? raw.text : "";
  const { title, description } = splitText(text, url);
  const seen = typeof raw.seen === "string" ? raw.seen : null;
  const bookmarkedAt = seen && /^\d{4}-\d{2}-\d{2}$/.test(seen) ? new Date(`${seen}T00:00:00Z`) : null;
  if (bookmarkedAt) bookmarkedAt.setUTCHours(SEEN_ANCHOR_HOUR);
  let urlHost: string | null = null;
  let urlPath: string | null = null;
  try {
    const u = new URL(url);
    urlHost = u.hostname;
    urlPath = u.pathname;
  } catch {
    /* cleanUrl already proved it parses */
  }
  const classified = classifyUrl({ url, ogTitle: title, ogDescription: description });
  return {
    url,
    title,
    description,
    bookmarkedAt,
    kindClassified: classified.kind,
    urlHost,
    urlPath,
    payload: raw,
  };
}

function isSkip(v: Planned | Skipped): v is Skipped {
  return (v as Skipped).reason !== undefined;
}

/** Drizzle wraps the driver error; the cause chain is where the real code and detail live. */
function describeError(error: unknown): string {
  const parts: string[] = [];
  let cur: unknown = error;
  for (let depth = 0; cur && depth < 3; depth += 1) {
    if (cur instanceof Error) {
      const extra = cur as Error & { code?: string; detail?: string; hint?: string };
      parts.push(
        `${extra.message}${extra.code ? ` [code=${extra.code}]` : ""}${extra.detail ? ` [detail=${extra.detail}]` : ""}`,
      );
      cur = extra.cause;
    } else {
      parts.push(String(cur));
      break;
    }
  }
  return parts.join("  ←  ");
}

async function loadExistingUrls(workspaceId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ url: schema.captureSources.url })
    .from(schema.captureSources)
    .where(and(eq(schema.captureSources.workspaceId, workspaceId), isNotNull(schema.captureSources.url)));
  const map = new Map<string, string>();
  for (const row of rows) if (row.url) map.set(normalizeUrl(row.url), row.url);
  return map;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const importedAt = new Date();

  const { records, malformed } = readRecords(args.file);
  const capped = args.limit !== undefined ? records.slice(0, args.limit) : records;

  const skipped: Skipped[] = [];
  const planned: Planned[] = [];
  const seenInFile = new Map<string, number>();
  for (const raw of capped) {
    const item = planRecord(raw);
    if (isSkip(item)) {
      skipped.push(item);
      continue;
    }
    if (seenInFile.has(item.url)) {
      skipped.push({ raw, reason: `duplicate of an earlier record in this file` });
      continue;
    }
    seenInFile.set(item.url, planned.length + skipped.length + 1);
    planned.push(item);
  }

  console.log("The frozen Plexo link export → nexalog.capture_sources");
  console.log(`  file            ${args.file}`);
  console.log(`  records         ${records.length}${malformed ? ` (${malformed} malformed line(s))` : ""}`);
  console.log(`  workspace_id    ${args.workspaceId}`);
  console.log(`  user_id         ${args.userId}`);
  console.log(`  import_source   ${IMPORT_SOURCE}`);
  console.log(`  enrichment      ${args.enrichment}`);
  console.log(`  imported_at     ${importedAt.toISOString()}`);
  console.log(`  planned         ${planned.length}`);
  console.log(`  skipped         ${skipped.length}`);

  // The duplicate probe is a read; in a dry run a missing database downgrades to a warning rather
  // than pretending every row is new.
  let existing = new Map<string, string>();
  let note: string;
  if (!process.env.DATABASE_URL) {
    note = "SKIPPED — DATABASE_URL is not set (every row is planned as INSERT)";
  } else {
    try {
      existing = await loadExistingUrls(args.workspaceId);
      note = `${existing.size} existing URL(s) in this workspace`;
    } catch (error) {
      if (!args.dryRun) throw error;
      note = `UNAVAILABLE (${describeError(error)}) — every row is planned as INSERT`;
    }
  }
  console.log(`  existing rows   ${note}`);

  const inserts: Planned[] = [];
  const dupes: Planned[] = [];
  for (const item of planned) {
    if (existing.has(item.url)) dupes.push(item);
    else inserts.push(item);
  }
  console.log("");
  console.log(`  INSERT          ${inserts.length}`);
  console.log(`  SKIP-duplicate  ${dupes.length}`);
  console.log(`  SKIP-invalid    ${skipped.length}`);
  for (const d of dupes.slice(0, 5)) console.log(`    duplicate: ${d.url}`);
  for (const s of skipped.slice(0, 5)) console.log(`    invalid:   ${s.reason}`);
  if (args.verbose) {
    for (const item of inserts.slice(0, 40)) {
      console.log(
        `    ${item.kindClassified.padEnd(9)} ${item.bookmarkedAt?.toISOString().slice(0, 10) ?? "----------"}  ${item.url}`,
      );
    }
    if (inserts.length > 40) console.log(`    … ${inserts.length - 40} more`);
  }

  if (args.dryRun) {
    console.log("");
    console.log("DRY RUN — nothing was written.");
    return;
  }
  if (inserts.length === 0) {
    console.log("");
    console.log("Nothing to insert — re-run is a no-op.");
    return;
  }

  // `--enrichment skipped` keeps a bulk import out of the six enrichment queues; the default
  // (`pending`) reproduces exactly what an in-app bookmark save leaves behind — the same shape
  // the AnyType importer uses, literal values and all, because the row type here is strict.
  const enrichmentColumns =
    args.enrichment === "skipped"
      ? {
          summaryState: "skipped",
          metadataState: "skipped",
          readerState: "skipped",
          transcriptState: "skipped",
          longSummaryState: "skipped",
          embeddingState: "skipped",
        }
      : {};

  // One insert per row rather than one multi-row insert: a bulk `values([...])` needs every
  // element to unify under a single strict row type, and the exemplar importer in this repo
  // (reimport-anytype.ts) does exactly this. ~4k rows is seconds.
  let inserted = 0;
  for (const [i, item] of inserts.entries()) {
    if ((i + 1) % 200 === 0) console.log(`  progress ${i + 1}/${inserts.length}`);
    await db
      .insert(schema.captureSources)
      .values({
        workspaceId: args.workspaceId,
        userId: args.userId,
        kind: "url",
        content: item.url,
        url: item.url,
        state: "raw",
        ogTitle: item.title,
        ogDescription: item.description,
        kindClassified: item.kindClassified,
        classifiedAt: importedAt,
        urlHost: item.urlHost,
        urlPath: item.urlPath,
        bookmarkedAt: item.bookmarkedAt,
        importedAt,
        importSource: IMPORT_SOURCE,
        sourcePayload: item.payload,
        ...enrichmentColumns,
      })
      .onConflictDoNothing();
    inserted += 1;
  }

  const counts = new Map<string, number>();
  for (const item of inserts) counts.set(item.kindClassified, (counts.get(item.kindClassified) ?? 0) + 1);

  // Run ledger. `nexalog.imports` has no reader in the app — it is a record for humans, so a
  // failure here must not fail an otherwise complete import.
  try {
    await db.insert(schema.imports).values({
      workspaceId: args.workspaceId,
      userId: args.userId,
      kind: "links:plexo_jsonl",
      filename: `plexo-links.jsonl (${inserted} inserted, ${dupes.length} duplicates, ${skipped.length} invalid)`,
      status: "done",
    });
  } catch (error) {
    console.log(`  warning: could not write the nexalog.imports ledger row — ${(error as Error).message}`);
  }

  console.log("");
  console.log("Summary (real run)");
  console.log(`  records read          ${records.length}`);
  console.log(`  rows inserted         ${inserted}`);
  console.log(`  duplicates skipped    ${dupes.length}`);
  console.log(`  invalid skipped       ${skipped.length}`);
  for (const [kind, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`  classified            ${kind.padEnd(9)} ${n}`);
  }
}

// tsx compiles this file as CJS (the workspace package.json has no `"type": "module"`), so a
// top-level `await` is a transform error — run it and surface the failure instead.
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
