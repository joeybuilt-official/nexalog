// SPDX-License-Identifier: MIT
/**
 * Bulk-import a **Claude.ai data export** into Nexalog.
 *
 * Why this script exists
 * ----------------------
 * A Claude export has no import path into Nexalog: there is no `/api/import` route, and the two
 * precedent backfill scripts (`scripts/reimport-karakeep.ts`, `scripts/reimport-telegram.ts`) both
 * live at the repo root where their `../lib/*` imports do not resolve — and they only backfill
 * `bookmarked_at` on rows that already exist. This one *creates* the content, so it carries the
 * full idempotency ladder itself. The parsing + planning half is a pure module,
 * `apps/web/lib/import/claude.ts`, so every decision is unit-tested without a fixture, a database,
 * or a brain repo.
 *
 * What it imports (nothing else)
 * ------------------------------
 *   conversation   →  <brain-repo>/notes/<slug>.md   (one page per conversation, `type: note`)
 *
 * Plus, once per run, the ledger row in `nexalog.imports` (`kind='conversations:claude_brain_pages'`)
 * — the same table the AnyType importer writes. **No table is created and no DDL is run.**
 *
 * Why a brain page and not a database row: a conversation is durable content, and the brain repo
 * is the system of record (ADR-0019) — markdown pages are what gbrain indexes and what
 * `/api/search` returns. A new Postgres table would be invisible to both (there is no dynamic
 * table enumeration in the search route), and this repo already carries an unwired
 * `chat_messages` table as the proof. The page `type` is `note`: `PAGE_TYPES`
 * (`packages/core/src/domain/page-type.ts`) has no `conversation` member, so the closest existing
 * type is used rather than one being invented.
 *
 * Guarantees
 * ----------
 *  - `--dry-run` is the DEFAULT and performs ZERO writes: no `writeFile`, no `mkdir`, no INSERT,
 *    no `git`. It prints the resolved brain repo, the per-action plan with a reason for every
 *    conversation, and the per-message accounting; `--execute` is the explicit opt-in that
 *    actually writes.
 *  - Re-running is a no-op: the page key is the conversation `uuid`, recorded in the frontmatter
 *    as `claude_conversation_uuid`, and the rendered file is compared byte-for-byte. Identical →
 *    `SKIP-identical` (the file is not even opened for writing); our uuid but different text →
 *    `UPDATE`; a destination that is NOT this conversation's page → `SKIP-conflict`, never
 *    overwritten. Nothing in the frontmatter is a run timestamp, so the rendered bytes are stable.
 *  - **This script never shells out to git.** `FsGitBrainStore` is deliberately NOT used: its
 *    `commit()` runs `git add -A` (`fs-git-brain-store.ts:224`), which would sweep another
 *    writer's uncommitted work into this branch's commit. Pages are written and left for the
 *    operator to stage with an explicit pathspec.
 *  - A conversation with no `uuid` is REFUSED, with the reason printed. Identity is never
 *    guessed — a synthetic key would create a duplicate on the next run.
 *
 * Usage (cwd must be `apps/web`; `tsx` is an apps/web devDependency):
 *
 *   pnpm tsx scripts/reimport-claude.ts <path/to/export.zip | conversations.json | dir> \
 *     [--brain-repo=<path>] [--dry-run] [--execute] [--limit=<n>] \
 *     [--workspace=<uuid>] [--user-id=<id>] [--verbose]
 *
 *   --brain-repo  brain repo root for page writes (default $BRAIN_REPO; REQUIRED to write)
 *   --dry-run     plan only, zero writes — the DEFAULT when --execute is absent
 *   --execute     actually write the pages (the explicit opt-in)
 *   --limit=<n>   plan/import only the first <n> conversations (export array order)
 *   --workspace   run-ledger workspace; with --user-id it bypasses the tenant heuristic
 *   --user-id     run-ledger user
 *   --verbose     print every message of every conversation, not just the first few
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  buildPlan,
  CLAUDE_IMPORT_SOURCE,
  parseClaudeConversationsJson,
  type ClaudeConversation,
  type ClaudePlan,
  type PlannedConversation,
} from "@/lib/import/claude";

const IMPORT_SOURCE = CLAUDE_IMPORT_SOURCE;
const LEDGER_KIND = "conversations:claude_brain_pages";
const USAGE = `Usage:
  reimport-claude.ts <path/to/export.zip | conversations.json | extracted-dir>
    [--brain-repo=<path>] [--dry-run] [--execute] [--limit=<n>]
    [--workspace=<uuid>] [--user-id=<id>] [--verbose]`;

interface Args {
  source: string | null;
  brainRepo: string | null;
  execute: boolean;
  limit?: number;
  workspaceId?: string;
  userId?: string;
  verbose: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const value = (flag: string) =>
    argv.find((a) => a.startsWith(`${flag}=`))?.slice(flag.length + 1);

  // Value flags REQUIRE `--flag=value`. A bare `--brain-repo /path` would otherwise be parsed as
  // an unknown *value* flag plus a stray positional, and the run would silently import without a
  // destination — the worst possible failure mode for a write. Refuse it loudly instead.
  const VALUE_FLAGS = ["--workspace", "--user-id", "--limit", "--brain-repo"] as const;
  const bare = argv.filter((a) => (VALUE_FLAGS as readonly string[]).includes(a));
  if (bare.length > 0) {
    throw new Error(
      `${bare.join(", ")} needs its value attached: use ${bare
        .map((f) => `${f}=<value>`)
        .join(" / ")} (a space-separated value is not parsed)\n${USAGE}`,
    );
  }

  const limitRaw = value("--limit");
  let limit: number | undefined;
  if (limitRaw !== undefined) {
    limit = Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`--limit must be a positive integer (got "${limitRaw}")`);
    }
  }

  const unknown = argv.filter(
    (a) =>
      a.startsWith("--") &&
      ![
        "--dry-run",
        "--execute",
        "--verbose",
        "--help",
        "--workspace",
        "--user-id",
        "--limit",
        "--brain-repo",
      ].some((f) => a === f || a.startsWith(`${f}=`)),
  );
  if (unknown.length > 0) throw new Error(`unknown flag(s): ${unknown.join(", ")}\n${USAGE}`);

  return {
    source: positional[0] ?? null,
    brainRepo: value("--brain-repo") ?? null,
    // Dry run is the DEFAULT: `--execute` is the only way to write anything.
    execute: argv.includes("--execute"),
    limit,
    workspaceId: value("--workspace"),
    userId: value("--user-id"),
    verbose: argv.includes("--verbose"),
    help: argv.includes("--help"),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Minimal ZIP reader — the export arrives as an archive, and there is no unzip dependency
// ─────────────────────────────────────────────────────────────────────────────────────────────

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/**
 * Read the central directory and return every entry's metadata. Only what this importer needs:
 * STORE (0) and DEFLATE (8), which is what every real ZIP writer produces for JSON.
 *
 * ZIP64 is rejected explicitly rather than mis-parsed: a Claude export of this size will never
 * need it, and silently reading the wrong offsets would be far worse than a clear error.
 */
function readZipCentralDirectory(buf: Buffer): ZipEntry[] {
  // End of central directory: scan backwards over the (variable-length) comment.
  let eocd = -1;
  const min = Math.max(0, buf.length - 66_000);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("not a ZIP archive (no end-of-central-directory record found)");

  const entryCount = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff || entryCount === 0xffff) {
    throw new Error("ZIP64 archives are not supported — unzip the export and pass the directory instead");
  }

  const entries: ZipEntry[] = [];
  let off = cdOffset;
  for (let i = 0; i < entryCount; i += 1) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== CEN_SIG) {
      throw new Error(`corrupt ZIP central directory at offset ${off}`);
    }
    const compressionMethod = buf.readUInt16LE(off + 10);
    const compressedSize = buf.readUInt32LE(off + 20);
    const uncompressedSize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localHeaderOffset = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nameLen).toString("utf8");
    entries.push({ name, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Decompress one entry. Refuses what it cannot decode instead of returning garbage. */
function readZipEntry(buf: Buffer, entry: ZipEntry): Buffer {
  const off = entry.localHeaderOffset;
  if (off + 30 > buf.length || buf.readUInt32LE(off) !== LOC_SIG) {
    throw new Error(`corrupt local header for ZIP entry ${entry.name}`);
  }
  const nameLen = buf.readUInt16LE(off + 26);
  const extraLen = buf.readUInt16LE(off + 28);
  const dataStart = off + 30 + nameLen + extraLen;
  const payload = buf.slice(dataStart, dataStart + entry.compressedSize);

  if (entry.compressionMethod === 0) return payload;
  if (entry.compressionMethod !== 8) {
    throw new Error(
      `ZIP entry ${entry.name} uses compression method ${entry.compressionMethod}; only STORE and DEFLATE are supported`,
    );
  }
  const inflated = inflateRawSync(payload);
  if (entry.uncompressedSize > 0 && inflated.length !== entry.uncompressedSize) {
    throw new Error(
      `ZIP entry ${entry.name} inflated to ${inflated.length} bytes but the directory says ${entry.uncompressedSize} — archive is corrupt`,
    );
  }
  return inflated;
}

/** Case-insensitive lookup of a member anywhere in the archive (a nested folder is tolerated). */
function findZipMember(entries: readonly ZipEntry[], baseName: string): ZipEntry | null {
  const wanted = baseName.toLowerCase();
  const exact = entries.filter((e) => basename(e.name).toLowerCase() === wanted);
  if (exact.length === 0) return null;
  // Prefer the shallowest path: an export puts them at the root, but one nested copy is common.
  exact.sort((a, b) => a.name.split("/").length - b.name.split("/").length);
  return exact[0];
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Source loading — a ZIP, its extracted directory, or conversations.json itself
// ─────────────────────────────────────────────────────────────────────────────────────────────

interface LoadedExport {
  /** What was read: the ZIP path, the directory path, or the JSON path. */
  origin: string;
  kind: "zip" | "directory" | "json";
  conversationsText: string;
  /** Members present in the archive / directory, for the report. */
  members: string[];
  /** The four documented members and whether each was found. */
  companionFiles: Array<{ name: string; found: boolean; bytes: number | null }>;
}

const REQUIRED_MEMBER = "conversations.json";
const COMPANION_MEMBERS = ["memories.json", "projects.json", "users.json"] as const;

function loadFromZip(path: string): LoadedExport {
  const buf = readFileSync(path);
  const entries = readZipCentralDirectory(buf);
  const conversationsEntry = findZipMember(entries, REQUIRED_MEMBER);
  if (!conversationsEntry) {
    const names = entries.map((e) => e.name).slice(0, 20);
    throw new Error(
      `${path} has no ${REQUIRED_MEMBER} member — is this really a Claude export? Members: ${
        names.join(", ") || "(none)"
      }`,
    );
  }
  return {
    origin: path,
    kind: "zip",
    conversationsText: readZipEntry(buf, conversationsEntry).toString("utf8"),
    members: entries.map((e) => e.name),
    companionFiles: COMPANION_MEMBERS.map((name) => {
      const entry = findZipMember(entries, name);
      return { name, found: entry !== null, bytes: entry ? entry.uncompressedSize : null };
    }),
  };
}

function loadFromDirectory(root: string): LoadedExport {
  const conversationsPath = join(root, REQUIRED_MEMBER);
  if (!existsSync(conversationsPath)) {
    // A nested single folder is tolerated: the user unzipped one level down or up.
    const candidates = [join(root, "data"), join(root, "export")].filter((dir) =>
      existsSync(join(dir, REQUIRED_MEMBER)),
    );
    const found = candidates[0];
    if (!found) {
      throw new Error(
        `${root} has no ${REQUIRED_MEMBER} — pass the unzipped root of the export (or the .zip itself)`,
      );
    }
    return loadFromDirectory(found);
  }
  return {
    origin: root,
    kind: "directory",
    conversationsText: readFileSync(conversationsPath, "utf8"),
    members: [REQUIRED_MEMBER, ...COMPANION_MEMBERS.filter((n) => existsSync(join(root, n)))],
    companionFiles: COMPANION_MEMBERS.map((name) => {
      const p = join(root, name);
      const present = existsSync(p) && statSync(p).isFile();
      return { name, found: present, bytes: present ? statSync(p).size : null };
    }),
  };
}

function loadExport(source: string): LoadedExport {
  const path = resolve(source);
  if (!existsSync(path)) throw new Error(`export path does not exist: ${path}`);
  const stat = statSync(path);
  if (stat.isDirectory()) return loadFromDirectory(path);
  if (path.toLowerCase().endsWith(".zip")) return loadFromZip(path);
  // A bare JSON file is accepted only when it looks like conversations.json itself — the
  // operator's real exports live on disk as exactly that.
  if (path.toLowerCase().endsWith(".json")) {
    return {
      origin: path,
      kind: "json",
      conversationsText: readFileSync(path, "utf8"),
      members: [basename(path)],
      companionFiles: COMPANION_MEMBERS.map((name) => ({ name, found: false, bytes: null })),
    };
  }
  throw new Error(
    `${path} is neither a directory, a .json, nor a .zip — pass the export ZIP, its unzipped root, or conversations.json`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Tenant resolution — for the run-ledger row ONLY (the pages themselves are not tenanted) — and
// the brain repo
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
 * Flags win. Otherwise fall back to a heuristic and THROW rather than guess — writing a ledger
 * row under the wrong tenant is not recoverable by re-running.
 *
 * The ladder is the precedents' (`reimport-karakeep.ts:55-96`), minus the by-own-table rung
 * (there is no imported_conversations table any more): `capture_sources` by `import_source`,
 * then overall, then the sole workspace row.
 */
async function resolveTenant(args: Args): Promise<Tenant> {
  if (args.workspaceId && args.userId) {
    return {
      workspaceId: args.workspaceId,
      userId: args.userId,
      source: "--workspace + --user-id flags",
    };
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
      source = `heuristic: workspace/user with the most import_source='${IMPORT_SOURCE}' capture_sources rows`;
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
            "nexalog.workspaces has more than one row and nothing to break the tie — pass --workspace and --user-id explicitly",
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
    source:
      args.workspaceId || args.userId ? `${source} (one flag given, the other filled in)` : source,
  };
}

/**
 * Repo-relative page path → the raw text already at that path. `undefined` means nothing is
 * there. Reads are best-effort: an unreadable file is reported as absent so the plan says WRITE
 * (and the write itself, not a probe, is what surfaces a real permission problem).
 */
function readExistingPages(repo: string, relPaths: readonly string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const relPath of relPaths) {
    if (relPath === "") continue;
    const abs = join(repo, relPath);
    if (!existsSync(abs)) continue;
    try {
      if (!statSync(abs).isFile()) continue;
      found.set(relPath, readFileSync(abs, "utf8"));
    } catch {
      /* treated as absent — the plan then says WRITE */
    }
  }
  return found;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Plan rendering
// ─────────────────────────────────────────────────────────────────────────────────────────────

const RULE = "─".repeat(78);

function shortId(id: string | null): string {
  if (!id) return "(no uuid)";
  return id.length <= 14 ? id : `${id.slice(0, 12)}…`;
}

function preview(text: string, max = 58): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine === "") return "(empty)";
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

function messageLine(message: PlannedConversation["messages"][number]): string {
  const pieces = [
    `sender=${message.sender}`,
    message.text === "" ? null : `text(${message.text.length}c)`,
    message.thoughtText === "" ? null : `thought(${message.thoughtText.length}c)`,
    message.artifacts.length === 0 ? null : `artifacts×${message.artifacts.length}`,
    message.toolCalls.length === 0 ? null : `tool_calls×${message.toolCalls.length}`,
    message.citations.length === 0 ? null : `citations×${message.citations.length}`,
    message.fileRefs.length === 0 ? null : `files×${message.fileRefs.length}`,
    message.attachments.length === 0 ? null : `attachments×${message.attachments.length}`,
  ].filter((p): p is string => p !== null);
  return pieces.join(" ");
}

function printPlan(plan: ClaudePlan, opts: { brainRepo: string | null; verbose: boolean }): void {
  const conversations = plan.conversations;
  const rows: Array<[string, number]> = [
    ["brain page  WRITE", conversations.filter((c) => c.action === "WRITE").length],
    ["brain page  UPDATE", conversations.filter((c) => c.action === "UPDATE").length],
    ["brain page  SKIP-identical", conversations.filter((c) => c.action === "SKIP-identical").length],
    ["brain page  SKIP-conflict", conversations.filter((c) => c.action === "SKIP-conflict").length],
    [
      "brain page  SKIP-unsupported",
      conversations.filter((c) => c.action === "SKIP-unsupported").length,
    ],
  ];

  console.log("");
  console.log("Plan (per conversation)");
  for (const [label, n] of rows) console.log(`  ${label.padEnd(34)} ${n}`);

  console.log("");
  console.log(`Per-item plan (${conversations.length} conversation(s))`);
  conversations.forEach((conversation, index) => {
    const destination =
      conversation.relPath === ""
        ? "(nothing)"
        : opts.brainRepo
          ? join(opts.brainRepo, conversation.relPath)
          : `<brain-repo>/${conversation.relPath}`;
    console.log(
      `[${String(index + 1).padStart(4)}] ${conversation.action.padEnd(16)} ${
        conversation.title === "" ? "(untitled)" : conversation.title
      }`,
    );
    console.log(`        reason: ${conversation.reason}`);
    console.log(
      `        file:   ${destination}`,
    );
    console.log(
      `        source: conversation ${shortId(conversation.conversationUuid)} · ${
        conversation.createdAt?.toISOString() ?? "created_at NULL"
      } · ${conversation.messages.length} message(s) (${
        conversation.messageCounts.rendered
      } rendered, ${conversation.messageCounts.placeholder} placeholder)`,
    );

    if (!opts.verbose && conversation.messages.length > 0) {
      const shown = conversation.messages.slice(0, 3);
      for (const message of shown) {
        console.log(
          `          ↳ #${String(message.position).padStart(3)} ${messageLine(message)}`,
        );
      }
      if (conversation.messages.length > shown.length) {
        console.log(
          `          ↳ … ${conversation.messages.length - shown.length} more message(s) — pass --verbose for every one`,
        );
      }
    }
    if (!opts.verbose) return;
    console.log(
      `        frontmatter: ${Object.entries(conversation.frontmatter)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(" ")}`,
    );
    console.log(
      `        body: ${conversation.body.split("\n").length} line(s), ${conversation.body.length} char(s) — file ${conversation.fileText.length} char(s)`,
    );
    for (const message of conversation.messages) {
      console.log(
        `          ↳ #${String(message.position).padStart(3)} ${messageLine(message)}`,
      );
      console.log(`            ${message.reason}`);
      if (message.text !== "") console.log(`            text: ${preview(message.text, 90)}`);
      if (message.thoughtText !== "") {
        console.log(`            thought: ${preview(message.thoughtText, 90)}`);
      }
      for (const artifact of message.artifacts) {
        console.log(
          `            artifact: ${artifact.title ?? "(untitled)"} [${artifact.type ?? "unknown type"}${
            artifact.language ? `, ${artifact.language}` : ""
          }] ${artifact.content.length} char(s)`,
        );
      }
      for (const file of message.fileRefs) {
        console.log(
          `            attachment ref: ${file.kind} ${file.title ?? file.fileUuid ?? "(unnamed)"}`,
        );
      }
      for (const call of message.toolCalls) {
        console.log(`            tool call: ${call.name ?? "(unnamed)"}`);
      }
    }
  });
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
  if (!args.source) {
    console.error(USAGE);
    process.exit(1);
  }

  const loaded = loadExport(args.source);
  const parsed = parseClaudeConversationsJson(loaded.conversationsText);
  const allConversations: ClaudeConversation[] = parsed.conversations;
  const selected =
    args.limit === undefined ? allConversations : allConversations.slice(0, args.limit);

  const brainRepoArg = args.brainRepo ?? process.env.BRAIN_REPO ?? null;
  const brainRepo = brainRepoArg ? resolve(brainRepoArg) : null;
  const brainRepoUsable =
    brainRepo !== null && existsSync(brainRepo) && statSync(brainRepo).isDirectory();

  console.log(RULE);
  console.log(
    ` Claude.ai export → Nexalog brain pages${
      args.execute ? "   ·   EXECUTE (writes)" : "   ·   DRY RUN (no writes)"
    }`,
  );
  console.log(RULE);
  console.log(`Export source      ${loaded.origin}  (${loaded.kind})`);
  console.log(
    `Conversations      ${selected.length} parsed` +
      (args.limit !== undefined
        ? `  (--limit=${args.limit} of ${allConversations.length} in the export)`
        : ""),
  );
  console.log(
    `Companion files    ${loaded.companionFiles
      .map((f) => `${f.name}${f.found ? ` (${f.bytes ?? "?"} B)` : " — absent"}`)
      .join(" · ")}`,
  );
  console.log(
    `Brain repo         ${brainRepo ?? "(unset — pass --brain-repo or set BRAIN_REPO)"}${
      brainRepo !== null && !brainRepoUsable ? "   ← NOT a directory" : ""
    }`,
  );

  // Two passes: slug/collision decisions are deterministic and independent of what is already on
  // disk, so the first pass yields the destination paths to probe before the real plan.
  const draft = buildPlan(selected, { existingPages: new Map(), importSource: IMPORT_SOURCE });
  const existingPages = brainRepoUsable
    ? readExistingPages(
        brainRepo,
        draft.conversations.map((c) => c.relPath),
      )
    : new Map<string, string>();
  const plan = buildPlan(selected, { existingPages, importSource: IMPORT_SOURCE });

  console.log("");
  console.log("Parsed content");
  console.log(`  conversations    ${plan.stats.conversations}`);
  console.log(
    `  messages         ${plan.stats.messages}  (${plan.stats.conversationsEmpty} conversation(s) carry none)`,
  );
  console.log(
    `  by sender        ${
      plan.stats.messagesBySender.map((s) => `${s.label}=${s.count}`).join(" · ") || "(none)"
    }`,
  );
  console.log(
    `  by block kind    ${
      plan.stats.messagesByContentBlockKind.map((s) => `${s.label}=${s.count}`).join(" · ") ||
      "(none)"
    }`,
  );
  console.log(
    `  double-encoded   ${plan.stats.doubleEncodedMessages} message(s) whose \`content\` arrived as a JSON string (decoded, and warned about below)`,
  );
  console.log(
    `  attachments      ${plan.stats.attachments} record(s) preserved · ${plan.stats.referencedFiles} file(s) referenced by content blocks (bytes are not in conversations.json — nothing is copied)`,
  );
  console.log("");
  console.log(`Brain-repo check   ${
    brainRepoUsable
      ? `${existingPages.size} destination(s) already on disk`
      : "SKIPPED — no readable --brain-repo/$BRAIN_REPO (every page is planned as WRITE)"
  }`);

  printPlan(plan, { brainRepo: brainRepoUsable ? brainRepo : null, verbose: args.verbose });

  const writes = plan.conversations.filter((c) => c.action === "WRITE");
  const updates = plan.conversations.filter((c) => c.action === "UPDATE");
  const identical = plan.conversations.filter((c) => c.action === "SKIP-identical");
  const conflicts = plan.conversations.filter((c) => c.action === "SKIP-conflict");
  const unsupported = plan.conversations.filter((c) => c.action === "SKIP-unsupported");

  if (plan.warnings.length > 0) {
    console.log("");
    console.log(`Parser warnings (${plan.warnings.length})`);
    for (const w of plan.warnings.slice(0, 20)) console.log(`  ${w}`);
    if (plan.warnings.length > 20) console.log(`  … and ${plan.warnings.length - 20} more`);
  }

  const summaryRows: Array<[string, number]> = [
    ["pages to create (CREATED)", writes.length],
    ["pages to rewrite (UPDATED)", updates.length],
    ["pages already identical (SKIPPED)", identical.length],
    ["destinations refused (conflict)", conflicts.length],
    ["conversations refused (no uuid)", unsupported.length],
  ];

  console.log("");
  console.log(RULE);
  if (!args.execute) {
    console.log("Summary (DRY RUN — nothing was written; pass --execute to write)");
    for (const [label, n] of summaryRows) console.log(`  ${label.padEnd(38)} ${n}`);
    console.log(`  ${"files written".padEnd(38)} 0`);
    console.log(RULE);
    return;
  }

  // ── real run ──────────────────────────────────────────────────────────────────────────────
  const toWrite = [...writes, ...updates];
  if (toWrite.length > 0 && (brainRepo === null || !brainRepoUsable)) {
    throw new Error(
      `the brain repo path is not a readable directory (${brainRepo ?? "unset"}) and the plan writes ${toWrite.length} page(s) — pass --brain-repo or set BRAIN_REPO, or re-run without --execute`,
    );
  }
  const pageRoot = brainRepo ?? "";

  let created = 0;
  let updated = 0;
  for (const page of toWrite) {
    const abs = join(pageRoot, page.relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, page.fileText, "utf8");
    if (page.action === "WRITE") created += 1;
    else updated += 1;
  }

  // Run ledger. `nexalog.imports` has no reader in the app (grep: only schema.ts) — it is a
  // record for humans, so a failure here must not fail an otherwise complete import. The tenant
  // is only needed for this row: the pages themselves are not tenanted.
  let ledgerNote: string;
  try {
    const tenant = await resolveTenant(args);
    await db.insert(schema.imports).values({
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      kind: LEDGER_KIND,
      filename: `${basename(loaded.origin)} (${created} created, ${updated} updated, ${identical.length} identical, ${conflicts.length} conflicts)`,
      status: "done",
    });
    ledgerNote = `written (workspace ${tenant.workspaceId}, resolved from ${tenant.source})`;
  } catch (error) {
    ledgerNote = `NOT written — ${(error as Error).message}`;
  }

  console.log("Summary (real run)");
  for (const [label, n] of summaryRows) console.log(`  ${label.padEnd(38)} ${n}`);
  console.log(`  ${"files written".padEnd(38)} ${created + updated}`);
  console.log(`  ${"nexalog.imports ledger".padEnd(38)} ${ledgerNote}`);
  console.log(RULE);
  console.log("Nothing was staged or committed. The brain repo is a shared working tree —");
  console.log("commit the new pages with an explicit pathspec, never `git add -A`.");
}

main()
  .then(() => flushAndExit(0))
  .catch((error) => {
    console.error("Claude import failed:", error instanceof Error ? error.message : error);
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
