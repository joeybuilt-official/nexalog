/**
 * FsGitBrainStore — the BrainStore adapter that reads/writes the brain git repo.
 *
 * Layout assumed (per plan §1.4):
 *   ${BRAIN_REPO}/inbox/<ulid>.md        (captures)
 *   ${BRAIN_REPO}/attachments/YYYY/MM/…  (media)
 *   ${BRAIN_REPO}/<type>/<slug>.md       (pages)
 *
 * Concurrency contract: every mutation goes through a single-writer commit
 * queue guarded by a lockfile. Commits are the unit of atomicity. This honors
 * pre-mortem #1 (git corruption from concurrent writers): Nexalog + Hermes +
 * human all serialize behind the same lock.
 *
 * This module uses child_process (git) and fs — allowed here because adapters
 * MAY depend on Node; `core` is the package that must stay pure.
 */

import { promises as fs } from "node:fs";
import * as fsSync from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { load, dump } from "js-yaml";

import {
  BrainStore,
  Capture,
  CaptureState,
  Ulid,
  Slug,
  serializeCapture,
  parseCapture,
  type AttachmentKind,
} from "@nexalog/core";

const execFileP = promisify(execFile);

/**
 * The extension an attachment is STORED under.
 *
 * Audio is the one case that must not inherit the upload's extension: the bytes
 * have already been normalized to opus (D4), so naming the file `.m4a`/`.wav`
 * would make every reader mis-detect the format. Everything else keeps its own
 * extension (sanitized), and anything unrecognised falls back to `.bin`.
 */
function storedExtension(kind: AttachmentKind, name: string): string {
  if (kind === "audio") return ".opus";
  const raw = path.extname(name).toLowerCase();
  // Keep the extension filename-safe: only [a-z0-9] and at most 8 chars, so a
  // hostile upload name cannot escape the attachments dir or smuggle in a path.
  return /^\.[a-z0-9]{1,8}$/.test(raw) ? raw : ".bin";
}

export interface FsGitBrainStoreOptions {
  /** Absolute path to the brain repo root. */
  repoPath: string;
  /** Path to the lockfile (defaults to <repoPath>/.nexalog/write.lock). */
  lockfilePath?: string;
}

export class FsGitBrainStore implements BrainStore {
  private readonly repo: string;
  private readonly lockfile: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(opts: FsGitBrainStoreOptions) {
    this.repo = path.resolve(opts.repoPath);
    this.lockfile = opts.lockfilePath ?? path.join(this.repo, ".nexalog", "write.lock");
    // Ensure the lockfile is git-ignored (local exclude, never committed).
    this.ensureLockExcluded();
  }

  private ensureLockExcluded(): void {
    const rel = path.relative(this.repo, this.lockfile).split(path.sep).join("/");
    try {
      const excludePath = path.join(this.repo, ".git", "info", "exclude");
      const current = fsSync.readFileSync(excludePath, "utf8");
      if (!current.split("\n").includes(rel)) {
        fsSync.mkdirSync(path.dirname(excludePath), { recursive: true });
        fsSync.appendFileSync(excludePath, `\n${rel}\n`, "utf8");
      }
    } catch {
      // best-effort: if this fails, the lockfile may dirty the tree but writes still work
    }
  }

  // ── BrainStore ──────────────────────────────────────────────────────────

  async saveCapture(capture: Capture): Promise<void> {
    const text = serializeCapture(capture.state);
    const filePath = path.join(this.repo, "inbox", `${capture.id.value}.md`);
    await this.enqueue(async () => {
      await this.withLock(async () => {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, text, "utf8");
        await this.commit(`capture ${capture.id.value}`);
      });
    });
  }

  async getCapture(id: Ulid): Promise<CaptureState | null> {
    const filePath = path.join(this.repo, "inbox", `${id.value}.md`);
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch {
      return null;
    }
    return this.parseCaptureFile(id, raw);
  }

  async listCaptures(filter?: { status?: CaptureState["status"] }): Promise<CaptureState[]> {
    const inboxDir = path.join(this.repo, "inbox");
    let names: string[];
    try {
      names = await fs.readdir(inboxDir);
    } catch {
      return [];
    }
    const out: CaptureState[] = [];
    for (const name of names) {
      if (!name.endsWith(".md")) continue;
      const id = Ulid.of(name.replace(/\.md$/, ""));
      const raw = await fs.readFile(path.join(inboxDir, name), "utf8");
      const state = this.parseCaptureFile(id, raw);
      if (filter?.status && state.status !== filter.status) continue;
      out.push(state);
    }
    return out;
  }

  async updateCapture(capture: Capture): Promise<void> {
    const text = serializeCapture(capture.state);
    const filePath = path.join(this.repo, "inbox", `${capture.id.value}.md`);
    await this.enqueue(async () => {
      await this.withLock(async () => {
        await fs.writeFile(filePath, text, "utf8");
        await this.commit(`update capture ${capture.id.value}`);
      });
    });
  }

  async getPage(slug: Slug): Promise<{ slug: Slug; frontmatter: Record<string, unknown>; body: string } | null> {
    const filePath = path.join(this.repo, slug.toFilePath());
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch {
      return null;
    }
    const { frontmatter, body } = this.splitFrontmatter(raw);
    return { slug, frontmatter, body };
  }

  async savePage(slug: Slug, frontmatter: Record<string, unknown>, body: string): Promise<void> {
    const filePath = path.join(this.repo, slug.toFilePath());
    await this.enqueue(async () => {
      await this.withLock(async () => {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        const text = ["---", dump(frontmatter).trim(), "---", body.trimEnd()].join("\n") + "\n";
        await fs.writeFile(filePath, text, "utf8");
        await this.commit(`save page ${slug.value}`);
      });
    });
  }

  async saveAttachment(input: {
    name: string;
    kind: AttachmentKind;
    bytes: Uint8Array;
  }): Promise<{ path: string }> {
    const now = new Date();
    const ym = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const ext = storedExtension(input.kind, input.name);
    const base = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const rel = `attachments/${ym}/${base}${ext}`;
    const abs = path.join(this.repo, rel);
    await this.enqueue(async () => {
      await this.withLock(async () => {
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, Buffer.from(input.bytes));
        await this.commit(`attachment ${rel}`);
      });
    });
    return { path: rel };
  }

  // ── concurrency: single-writer queue + lockfile ────────────────────────

  /** Serialize mutations through a FIFO queue (process-local). */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  /** Cross-process exclusion via a lockfile (Nexalog vs Hermes vs human). */
  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await fs.mkdir(path.dirname(this.lockfile), { recursive: true });
    // Spin-acquire with a bounded wait (single-writer window is tiny).
    const deadline = Date.now() + 10_000;
    for (;;) {
      try {
        const handle = await fs.open(this.lockfile, "wx");
        await handle.writeFile(`${process.pid}\n`);
        await handle.close();
        break;
      } catch {
        if (Date.now() > deadline) {
          throw new Error("Timed out waiting for brain-repo write lock");
        }
        await new Promise((r) => setTimeout(r, 25));
      }
    }
    try {
      return await fn();
    } finally {
      await fs.unlink(this.lockfile).catch(() => undefined);
    }
  }

  private async commit(message: string): Promise<void> {
    // git status check before write (pre-mortem #1); commit is the atomic unit.
    await execFileP("git", ["add", "-A"], { cwd: this.repo });
    // Only commit if there is something staged.
    const diff = await execFileP("git", ["diff", "--cached", "--quiet"], { cwd: this.repo })
      .then(() => false)
      .catch(() => true);
    if (diff) {
      await execFileP("git", ["commit", "-m", message], { cwd: this.repo });
    }
  }

  private parseCaptureFile(id: Ulid, raw: string): CaptureState {
    const { frontmatter, body } = this.splitFrontmatter(raw);
    return parseCapture(id, frontmatter, body);
  }

  /** Minimal gray-matter split: frontmatter delimited by leading `---`. */
  private splitFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string } {
    if (!raw.startsWith("---\n")) {
      return { frontmatter: {}, body: raw };
    }
    const end = raw.indexOf("\n---", 4);
    if (end === -1) {
      return { frontmatter: {}, body: raw };
    }
    const fmText = raw.slice(4, end);
    const body = raw.slice(end + 4).replace(/^\n/, "");
    const frontmatter = (load(fmText) as Record<string, unknown>) ?? {};
    return { frontmatter, body };
  }
}
