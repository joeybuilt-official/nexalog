// SPDX-License-Identifier: MIT
/**
 * Bulk-import an **AnyType Markdown export** into Nexalog.
 *
 * Why this script exists
 * ----------------------
 * AnyType data has no import path into Nexalog: there is no `/api/import` route, and the two
 * precedent backfill scripts (`scripts/reimport-karakeep.ts`, `scripts/reimport-telegram.ts`)
 * both (a) live at the repo root, where their `../lib/db` imports do not resolve, and (b) only
 * backfill `bookmarked_at` on rows that already exist. This one *creates* rows, so it carries
 * the full idempotency ladder itself.
 *
 * What it imports (nothing else — see the plan for unsupported types)
 * ------------------------------------------------------------------
 *   AnyType object type     →  Nexalog destination
 *   Bookmark / Link / URL   →  nexalog.capture_sources row (kind='url'), one per saved URL
 *   Note, Page              →  <brain-repo>/notes/<slug>.md      (type: note)
 *   Concept                 →  <brain-repo>/concepts/<slug>.md  (type: concept)
 *   Person                  →  <brain-repo>/people/<slug>.md    (type: person)
 *   Company                 →  <brain-repo>/companies/<slug>.md (type: company)
 *   Project                 →  <brain-repo>/projects/<slug>.md  (type: project)
 *   anything else           →  SKIP, with the reason printed. No third path is invented.
 *
 * Why those two shapes: `capture_sources` is the only table carrying the import-provenance
 * columns (`bookmarked_at` / `imported_at` / `import_source` / `source_payload` — schema.ts:147)
 * and it is a live surface (`GET /api/bookmarks`, the `/api/search` captures branch); long-form
 * prose belongs in the brain repo as `<type>/<slug>.md`, which is the system of record
 * (ADR-0019). Bulk-imported content is deliberately NOT written as `inbox/<ulid>.md` captures:
 * a capture is work queued for an operator, and one bad enum member breaks the entire inbox read.
 *
 * Guarantees
 * ----------
 *  - `--dry-run` performs ZERO writes: no INSERT, no `writeFile`, no `git`. It prints the
 *    resolved tenant, per-type counts, and a per-item plan with the exact destination and reason.
 *  - Re-running is a no-op: URLs are normalized + deduped, checked against the workspace's
 *    existing rows before insert, and pages are keyed on the frontmatter `anytype_id` already
 *    present in the destination file (`capture_sources` has NO unique constraint on `url`, so
 *    in-code dedupe is the only guarantee there is).
 *  - **This script never shells out to git.** It writes files into the brain repo and stops.
 *    `FsGitBrainStore` is deliberately NOT used: its `commit()` runs `git add -A`
 *    (`fs-git-brain-store.ts:224`), which would sweep another writer's uncommitted work into
 *    this commit. Staging is the operator's call, with an explicit pathspec.
 *
 * Usage (cwd must be `apps/web`; `tsx` is an apps/web devDependency):
 *
 *   pnpm tsx scripts/reimport-anytype.ts <path/to/Anytype.YYYYMMDD.HHMMSS.nn | parent dir> \
 *     [--workspace=<uuid>] [--user-id=<id>] [--dry-run] [--limit=<n>] \
 *     [--brain-repo=<path>] [--enrichment=pending|skipped] [--verbose]
 *
 *   --dry-run     plan only, zero writes (run this first, always)
 *   --limit=<n>   plan/import only the first <n> objects (deterministic file-name order)
 *   --workspace   target workspace; with --user-id it bypasses the tenant heuristic
 *   --user-id     target user
 *   --brain-repo  brain repo root for page writes (default $BRAIN_REPO)
 *   --enrichment  new-row enrichment states: `pending` (default — identical to an in-app
 *                 bookmark capture, and it pre-loads every enrichment queue) or `skipped`
 *                 (keeps a bulk import out of those queues entirely)
 *   --verbose     print each item's full column/file detail, not just the one-line plan
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  buildPlan,
  parseAnytypeExportFile,
  parseAnytypeFrontmatter,
  serializePageFile,
  splitAnytypeFrontmatter,
  type AnytypeObject,
  type AnytypePlan,
  type PlannedCapture,
  type PlannedPage,
  type PlannedSkip,
} from "@/lib/import/anytype";

const IMPORT_SOURCE = "anytype";
const USAGE = `Usage:
  reimport-anytype.ts <path/to/Anytype.YYYYMMDD.HHMMSS.nn>
    [--workspace=<uuid>] [--user-id=<id>] [--dry-run] [--limit=<n>]
    [--brain-repo=<path>] [--enrichment=pending|skipped] [--verbose]`;

interface Args {
  exportDir: string | null;
  workspaceId?: string;
  userId?: string;
  dryRun: boolean;
  limit?: number;
  brainRepo: string | null;
  enrichment: "pending" | "skipped";
  verbose: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const value = (flag: string) =>
    argv.find((a) => a.startsWith(`${flag}=`))?.slice(flag.length + 1);

  const limitRaw = value("--limit");
  let limit: number | undefined;
  if (limitRaw !== undefined) {
    limit = Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`--limit must be a positive integer (got "${limitRaw}")`);
    }
  }

  const enrichmentRaw = value("--enrichment");
  if (enrichmentRaw !== undefined && enrichmentRaw !== "pending" && enrichmentRaw !== "skipped") {
    throw new Error(`--enrichment must be "pending" or "skipped" (got "${enrichmentRaw}")`);
  }

  const unknown = argv.filter(
    (a) =>
      a.startsWith("--") &&
      ![
        "--dry-run",
        "--verbose",
        "--help",
        "--workspace",
        "--user-id",
        "--limit",
        "--brain-repo",
        "--enrichment",
      ].some((f) => a === f || a.startsWith(`${f}=`)),
  );
  if (unknown.length > 0) throw new Error(`unknown flag(s): ${unknown.join(", ")}\n${USAGE}`);

  return {
    exportDir: positional[0] ?? null,
    workspaceId: value("--workspace"),
    userId: value("--user-id"),
    dryRun: argv.includes("--dry-run"),
    limit,
    brainRepo: value("--brain-repo") ?? null,
    enrichment: enrichmentRaw === "skipped" ? "skipped" : "pending",
    verbose: argv.includes("--verbose"),
    help: argv.includes("--help"),
  };
}

/**
 * Resolve the export root. The exporter never writes into the chosen folder: it creates a
 * child directory named `Anytype.<YYYYMMDD>.<HHMMSS>.<nn>` (`uniqName()` in writer.go). Accept
 * either that directory or its parent, and say which was chosen.
 */
function resolveExportRoot(input: string): string {
  const dir = resolve(input);
  if (!existsSync(dir)) throw new Error(`export path does not exist: ${dir}`);
  if (!statSync(dir).isDirectory()) {
    throw new Error(
      `${dir} is a file. A .zip archive must be unzipped first — this script reads directories.`,
    );
  }
  const entries = readdirSync(dir);
  // An `Anytype.<YYYYMMDD>.<HHMMSS>.<nn>` child wins over anything else in the folder: the
  // exporter always creates one, and a sibling README / screenshot must not be mistaken for it.
  const anytypeDirs = entries
    .filter((e) => /^Anytype\.\d{8}\.\d{6}\.\d{2}$/.test(e))
    .filter((e) => statSync(join(dir, e)).isDirectory());
  const withMarkdown = anytypeDirs.filter((e) =>
    readdirSync(join(dir, e)).some((f) => f.toLowerCase().endsWith(".md")),
  );
  if (withMarkdown.length === 1) return join(dir, withMarkdown[0]);
  if (withMarkdown.length > 1) {
    throw new Error(
      `${dir} contains ${withMarkdown.length} Anytype.* export directories — pass the one you want explicitly`,
    );
  }
  if (entries.some((e) => e.toLowerCase().endsWith(".md") && statSync(join(dir, e)).isFile())) {
    return dir;
  }
  const subdirs = entries.filter((e) => statSync(join(dir, e)).isDirectory());
  if (subdirs.length === 1) return join(dir, subdirs[0]);
  throw new Error(
    `no .md files and no single export directory found in ${dir} — pass the unzipped root of the export`,
  );
}

interface LoadedExport {
  root: string;
  objects: AnytypeObject[];
  attachmentCount: number;
  schemaCount: number;
  /** Object references to `files/…` that this importer does not copy (reported, not imported). */
  attachmentRefs: string[];
}

function loadExport(root: string, limit?: number): LoadedExport {
  const entries = readdirSync(root);
  const mdFiles = entries
    .filter((e) => e.toLowerCase().endsWith(".md"))
    .filter((e) => statSync(join(root, e)).isFile())
    .sort();

  const selected = limit === undefined ? mdFiles : mdFiles.slice(0, limit);
  const objects = selected.map((file) =>
    parseAnytypeExportFile(readFileSync(join(root, file), "utf8"), file),
  );

  const countDir = (name: string) => {
    const dir = join(root, name);
    return existsSync(dir) && statSync(dir).isDirectory() ? readdirSync(dir).length : 0;
  };
  const attachmentRefs = objects
    .flatMap((o) => [...o.body.matchAll(/\]\((files\/[^)\s]+)\)/g)].map((m) => m[1]))
    .sort();

  return {
    root,
    objects,
    attachmentCount: countDir("files"),
    schemaCount: countDir("schemas"),
    attachmentRefs,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Tenant resolution
// ─────────────────────────────────────────────────────────────────────────────────────────────

interface Tenant {
  workspaceId: string;
  userId: string;
  source: string;
}

interface TenantPair {
  workspace_id: string;
  user_id: string;
}

/**
 * Flags win. Otherwise fall back to a heuristic and THROW rather than guess — writing a bulk
 * import into the wrong tenant is not recoverable by re-running.
 */
async function resolveTenant(args: Args): Promise<Tenant> {
  if (args.workspaceId && args.userId) {
    return { workspaceId: args.workspaceId, userId: args.userId, source: "--workspace + --user-id flags" };
  }
  if (!process.env.DATABASE_URL) {
    throw new Error(
      `DATABASE_URL is not set, so the tenant heuristic cannot run — pass --workspace and --user-id explicitly.\n${USAGE}`,
    );
  }

  let heuristic: TenantPair | null = null;
  let source = "";
  if (!args.workspaceId || !args.userId) {
    const byImportSource = (await db.execute(sql`
      SELECT workspace_id, user_id, COUNT(*)::int AS n
      FROM nexalog.capture_sources
      WHERE import_source = ${IMPORT_SOURCE}
      GROUP BY workspace_id, user_id
      ORDER BY n DESC
      LIMIT 1
    `)) as unknown as TenantPair[];
    if (byImportSource[0]) {
      heuristic = byImportSource[0];
      source = `heuristic: workspace/user with the most import_source='${IMPORT_SOURCE}' rows`;
    } else {
      const anyRows = (await db.execute(sql`
        SELECT workspace_id, user_id, COUNT(*)::int AS n
        FROM nexalog.capture_sources
        GROUP BY workspace_id, user_id
        ORDER BY n DESC
        LIMIT 1
      `)) as unknown as TenantPair[];
      if (anyRows[0]) {
        heuristic = anyRows[0];
        source = "heuristic: workspace/user with the most capture_sources rows overall";
      } else {
        const spaces = (await db.execute(sql`
          SELECT id AS workspace_id, user_id FROM nexalog.workspaces ORDER BY created_at ASC LIMIT 2
        `)) as unknown as TenantPair[];
        if (spaces.length === 1) {
          heuristic = spaces[0];
          source = "heuristic: the only row in nexalog.workspaces";
        } else if (spaces.length > 1) {
          throw new Error(
            "nexalog.workspaces has more than one row and no capture_sources rows to break the tie — pass --workspace and --user-id explicitly",
          );
        }
      }
    }
  }

  const workspaceId = args.workspaceId ?? heuristic?.workspace_id;
  const userId = args.userId ?? heuristic?.user_id;
  if (!workspaceId || !userId) {
    throw new Error(
      `could not determine a tenant (workspace=${workspaceId ?? "?"} user=${userId ?? "?"}) — pass --workspace and --user-id explicitly.\n${USAGE}`,
    );
  }
  return {
    workspaceId,
    userId,
    source: args.workspaceId || args.userId ? `${source} (one flag given, the other filled in)` : source,
  };
}

/** Every URL already stored for the workspace — the in-code dedupe `capture_sources` cannot do. */
async function loadExistingCaptureUrls(workspaceId: string): Promise<Set<string>> {
  const rows = await db
    .select({ url: schema.captureSources.url })
    .from(schema.captureSources)
    .where(
      and(
        eq(schema.captureSources.workspaceId, workspaceId),
        isNotNull(schema.captureSources.url),
      ),
    );
  const urls = new Set<string>();
  for (const row of rows) if (row.url) urls.add(row.url);
  return urls;
}

/** Repo-relative page path → the `anytype_id` already in that file (null when it has none). */
function readExistingPages(brainRepo: string, relPaths: readonly string[]): Map<string, string | null> {
  const found = new Map<string, string | null>();
  for (const relPath of relPaths) {
    const abs = join(brainRepo, relPath);
    if (!existsSync(abs)) continue;
    try {
      const raw = readFileSync(abs, "utf8");
      const { frontmatterText } = splitAnytypeFrontmatter(raw);
      if (frontmatterText === null) {
        found.set(relPath, null);
        continue;
      }
      const { frontmatter } = parseAnytypeFrontmatter(frontmatterText);
      const id = frontmatter["anytype_id"];
      found.set(relPath, typeof id === "string" ? id : null);
    } catch {
      found.set(relPath, null);
    }
  }
  return found;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Plan rendering
// ─────────────────────────────────────────────────────────────────────────────────────────────

const RULE = "─".repeat(78);

function actionLine(item: PlannedCapture | PlannedPage | PlannedSkip): string {
  const action = item.action.padEnd(17);
  if (item.target === "capture_sources") {
    const c = item as PlannedCapture;
    return `  ${action} nexalog.capture_sources · url=${c.url}`;
  }
  if (item.target === "—") {
    return `  ${action} (nothing)`;
  }
  return `  ${action} ${item.target}`;
}

function identityLine(item: PlannedCapture | PlannedPage | PlannedSkip): string {
  const id = item.anytypeId ?? "(no id)";
  const type = item.rawType ?? "(unknown type)";
  return `        source: ${item.sourceFileName} (${type}, id ${id})`;
}

function shortId(id: string | null): string {
  if (!id) return "(no id)";
  return id.length <= 14 ? id : `${id.slice(0, 12)}…`;
}

function printPlan(plan: AnytypePlan, opts: { brainRepo: string | null; verbose: boolean }): void {
  // Printed in export-filename order (not action order) so the plan can be diffed against `ls`
  // of the export root — the per-action totals are in the Plan block above.
  const items: Array<PlannedCapture | PlannedPage | PlannedSkip> = [
    ...plan.captures,
    ...plan.pages,
    ...plan.skips,
  ].sort((a, b) => (a.sourceFileName < b.sourceFileName ? -1 : a.sourceFileName > b.sourceFileName ? 1 : 0));

  console.log("");
  console.log("Plan");
  const rows: Array<[string, number]> = [
    ["capture_sources  INSERT", plan.captures.filter((c) => c.action === "INSERT").length],
    ["capture_sources  SKIP-duplicate", plan.captures.filter((c) => c.action === "SKIP-duplicate").length],
    ["brain page       WRITE", plan.pages.filter((p) => p.action === "WRITE").length],
    ["brain page       SKIP-duplicate", plan.pages.filter((p) => p.action === "SKIP-duplicate").length],
    ["(nothing)        SKIP-unsupported", plan.skips.length],
  ];
  for (const [label, n] of rows) console.log(`  ${label.padEnd(34)} ${n}`);

  console.log("");
  console.log(`Per-item plan (${items.length})`);
  items.forEach((item, index) => {
    console.log(`[${String(index + 1).padStart(3)}] ${actionLine(item).trimStart()}`);
    console.log(`        reason: ${item.reason}`);
    console.log(`        ${identityLine(item).trimStart()}`);

    if (!opts.verbose) return;
    if (item.target === "capture_sources") {
      const c = item as PlannedCapture;
      console.log(`        columns: kind='url' state='raw' content=<url>`);
      console.log(
        `                 kind_classified='${c.kindClassified}' url_host='${c.urlHost}' url_path='${c.urlPath}'`,
      );
      console.log(`                 og_title=${c.title === null ? "NULL" : JSON.stringify(c.title)}`);
      console.log(
        `                 bookmarked_at=${c.bookmarkedAt?.toISOString() ?? "NULL"} imported_at=<run time> import_source='${IMPORT_SOURCE}'`,
      );
      console.log(
        `                 source_payload=<jsonb: anytype{id,type,schemaRef,sourceFileName,rawUrl} + ${Object.keys(c.payload.frontmatter as Record<string, unknown>).length} frontmatter keys + body>`,
      );
      console.log(`        title: ${c.title ?? "(none)"}  (AnyType id ${shortId(c.anytypeId)})`);
    } else if (item.target !== "—") {
      const p = item as PlannedPage;
      console.log(
        `        file: ${opts.brainRepo ? join(opts.brainRepo, p.relPath) : `<brain-repo>/${p.relPath}`}`,
      );
      console.log(
        `        frontmatter: ${Object.entries(p.frontmatter)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(" ")}`,
      );
      console.log(
        `        body: ${p.body.split("\n").length} line(s), ${p.body.length} char(s) — written verbatim below the frontmatter`,
      );
    }
  });
}

function countByType(objects: readonly AnytypeObject[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const o of objects) {
    const label = o.rawType ?? "(unknown)";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  if (!args.exportDir) {
    console.error(USAGE);
    process.exit(1);
  }

  const loaded = loadExport(resolveExportRoot(args.exportDir), args.limit);
  const importedAt = new Date();
  const brainRepoArg = args.brainRepo ?? process.env.BRAIN_REPO ?? null;
  const brainRepo = brainRepoArg ? resolve(brainRepoArg) : null;
  const brainRepoUsable =
    brainRepo !== null && existsSync(brainRepo) && statSync(brainRepo).isDirectory();
  const allMdCount = readdirSync(loaded.root).filter((e) => e.toLowerCase().endsWith(".md")).length;

  // A folder that resolves but holds no objects is a wrong-directory mistake, not an empty
  // import: refuse loudly rather than printing a plan full of zeroes. The classic cause is an
  // ALL-SPACES export, which nests everything one level deeper under `spaces/<spaceId>/`.
  if (allMdCount === 0) {
    throw new Error(
      `${loaded.root} contains no .md objects — wrong directory? An export of *all* spaces nests every object under spaces/<spaceId>/, which this script does not walk (pass the single space's own Anytype.* directory)`,
    );
  }

  console.log(RULE);
  console.log(` AnyType Markdown export → Nexalog${args.dryRun ? "   ·   DRY RUN (no writes)" : ""}`);
  console.log(RULE);
  console.log(`Export root        ${loaded.root}`);
  console.log(
    `Objects parsed     ${loaded.objects.length} of ${allMdCount} .md file(s)` +
      (args.limit !== undefined ? `  (--limit=${args.limit})` : ""),
  );
  console.log(
    `Sidecars           files/ ${loaded.attachmentCount} entry(ies) · schemas/ ${loaded.schemaCount} entry(ies)`,
  );

  const tenant = await resolveTenant(args);
  console.log("");
  console.log("Target tenant");
  console.log(`  workspace_id     ${tenant.workspaceId}`);
  console.log(`  user_id          ${tenant.userId}`);
  console.log(`  resolved from    ${tenant.source}`);
  console.log(`  import_source    ${IMPORT_SOURCE}`);
  console.log(`  enrichment       ${args.enrichment}`);
  console.log(`  brain repo       ${brainRepo || "(unset)"}${brainRepoUsable ? "" : "  ← NOT a directory"}`);

  // Existing state. In the dry run a missing/unreachable database is not fatal: the plan is
  // then honestly reported as "duplicate check skipped" instead of silently claiming INSERTs.
  let existingCaptureUrls = new Set<string>();
  let duplicateCheckNote: string;
  if (!process.env.DATABASE_URL) {
    duplicateCheckNote = "SKIPPED — DATABASE_URL is not set (every capture is planned as INSERT)";
  } else {
    try {
      existingCaptureUrls = await loadExistingCaptureUrls(tenant.workspaceId);
      duplicateCheckNote = `${existingCaptureUrls.size} existing URL(s) in this workspace`;
    } catch (error) {
      if (!args.dryRun) throw error;
      duplicateCheckNote = `UNAVAILABLE (${(error as Error).message}) — every capture is planned as INSERT`;
    }
  }

  const planCtx = {
    existingCaptureUrls,
    importedAt,
    importSource: IMPORT_SOURCE,
  };
  // Two passes: slug/collision decisions are deterministic and independent of what is already
  // on disk, so the first pass yields the destination paths to probe before the real plan.
  const draft = buildPlan(loaded.objects, { ...planCtx, existingPages: new Map() });
  const existingPages = brainRepoUsable
    ? readExistingPages(
        brainRepo,
        draft.pages.map((p) => p.relPath),
      )
    : new Map<string, string | null>();
  const plan = buildPlan(loaded.objects, { ...planCtx, existingPages });

  console.log("");
  console.log("Objects by AnyType type");
  for (const [label, n] of countByType(loaded.objects)) console.log(`  ${label.padEnd(24)} ${n}`);
  console.log("");
  console.log(`Duplicate check    ${duplicateCheckNote}`);
  console.log(`Brain-repo check   ${
    brainRepoUsable
      ? `${existingPages.size} destination(s) already on disk`
      : "SKIPPED — no readable --brain-repo/$BRAIN_REPO (every page is planned as WRITE)"
  }`);

  printPlan(plan, { brainRepo: brainRepoUsable ? brainRepo : null, verbose: args.verbose });

  const inserts = plan.captures.filter((c) => c.action === "INSERT");
  const writes = plan.pages.filter((p) => p.action === "WRITE");
  const dupes =
    plan.captures.filter((c) => c.action === "SKIP-duplicate").length +
    plan.pages.filter((p) => p.action === "SKIP-duplicate").length;

  if (plan.warnings.length > 0) {
    console.log("");
    console.log(`Parser warnings (${plan.warnings.length})`);
    for (const w of plan.warnings.slice(0, 20)) console.log(`  ${w}`);
    if (plan.warnings.length > 20) console.log(`  … and ${plan.warnings.length - 20} more`);
  }
  if (loaded.attachmentRefs.length > 0) {
    console.log("");
    console.log(
      `Attachment references NOT imported (${loaded.attachmentRefs.length}): ${[
        ...new Set(loaded.attachmentRefs),
      ].join(", ")}`,
    );
    console.log(
      `  files/ holds ${loaded.attachmentCount} file(s); this importer does not copy binaries into attachments/YYYY/MM/.`,
    );
  }
  if (args.enrichment === "pending" && inserts.length > 0) {
    console.log("");
    console.log(
      `NOTE  ${inserts.length} new row(s) default to the enrichment states 'pending' — the same as an in-app`,
    );
    console.log(
      "      bookmark capture — which places them in the summary / metadata / reader / transcript /",
    );
    console.log("      long_summary / embedding queues. Use --enrichment=skipped to avoid that.");
  }

  const summaryRows: Array<[string, number]> = [
    ["capture_sources rows to insert", inserts.length],
    ["brain pages to write", writes.length],
    ["duplicates skipped (already imported)", dupes],
    ["objects skipped (unsupported / unusable)", plan.skips.length],
  ];

  console.log("");
  console.log(RULE);
  if (args.dryRun) {
    console.log("Summary (DRY RUN — nothing was written)");
    for (const [label, n] of summaryRows) console.log(`  ${label.padEnd(42)} ${n}`);
    console.log(`  ${"rows written / files written".padEnd(42)} 0 / 0`);
    console.log(RULE);
    return;
  }

  // ── real run ──────────────────────────────────────────────────────────────────────────────
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL environment variable is not set");
  if (writes.length > 0 && (brainRepo === null || !brainRepoUsable)) {
    throw new Error(
      `the brain repo path is not a readable directory (${brainRepo ?? "unset"}) and the plan writes ${writes.length} page(s) — pass --brain-repo or set BRAIN_REPO, or re-run with --dry-run`,
    );
  }
  const pageRoot = brainRepo ?? "";

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

  let inserted = 0;
  let written = 0;
  for (const [i, capture] of inserts.entries()) {
    if ((i + 1) % 200 === 0) {
      console.log(`  progress ${i + 1}/${inserts.length}  inserted=${inserted}`);
    }
    await db
      .insert(schema.captureSources)
      .values({
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        kind: "url",
        content: capture.url,
        url: capture.url,
        state: "raw",
        ogTitle: capture.title,
        kindClassified: capture.kindClassified,
        urlHost: capture.urlHost || null,
        urlPath: capture.urlPath || null,
        bookmarkedAt: capture.bookmarkedAt,
        importedAt,
        importSource: IMPORT_SOURCE,
        sourcePayload: capture.payload,
        ...enrichmentColumns,
      })
      .onConflictDoNothing();
    inserted += 1;
  }

  for (const page of writes) {
    const abs = join(pageRoot, page.relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, serializePageFile(page.frontmatter, page.body), "utf8");
    written += 1;
  }

  // Run ledger. `nexalog.imports` has no reader in the app (grep: only schema.ts) — it is a
  // record for humans, so a failure here must not fail an otherwise complete import.
  try {
    await db.insert(schema.imports).values({
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      kind: "bookmarks:anytype_markdown",
      filename: `${basename(loaded.root)} (${inserted} inserted, ${dupes} duplicates, ${written} pages)`,
      status: "done",
    });
  } catch (error) {
    console.log(`  warning: could not write the nexalog.imports ledger row — ${(error as Error).message}`);
  }

  console.log("Summary (real run)");
  for (const [label, n] of summaryRows) console.log(`  ${label.padEnd(42)} ${n}`);
  console.log(`  ${"rows written / files written".padEnd(42)} ${inserted} / ${written}`);
  console.log(RULE);
  console.log("Nothing was staged or committed. The brain repo is a shared working tree —");
  console.log("commit the new pages with an explicit pathspec, never `git add -A`.");
}

main()
  .then(() => flushAndExit(0))
  .catch((error) => {
    console.error("AnyType import failed:", error instanceof Error ? error.message : error);
    return flushAndExit(1);
  });

/**
 * postgres-js keeps its socket open, so the event loop never drains on its own and the process
 * would hang after the work is done — exit explicitly, like the precedent scripts. The
 * `write("")` callbacks are a flush barrier: they fire after the already-queued chunks, so a
 * piped run is not truncated by the immediate `process.exit` (Node's stdout is async on a pipe).
 */
async function flushAndExit(code: number): Promise<never> {
  await new Promise<void>((done) => process.stdout.write("", () => done()));
  await new Promise<void>((done) => process.stderr.write("", () => done()));
  process.exit(code);
}
