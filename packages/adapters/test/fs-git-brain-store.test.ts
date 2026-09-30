import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { FsGitBrainStore } from "../src/brain-fs-git/fs-git-brain-store";
import { Capture, Ulid, Slug } from "@nexalog/core";

const execFileP = promisify(execFile);

let repo: string;
let store: FsGitBrainStore;

beforeAll(async () => {
  repo = await fs.mkdtemp(path.join(os.tmpdir(), "nexalog-brain-"));
  await execFileP("git", ["init", "-q"], { cwd: repo });
  await execFileP("git", ["config", "user.email", "test@test"], { cwd: repo });
  await execFileP("git", ["config", "user.name", "test"], { cwd: repo });
  store = new FsGitBrainStore({ repoPath: repo });
});

afterAll(async () => {
  await fs.rm(repo, { recursive: true, force: true });
});

const id = Ulid.of("0123456789ABCDEFGHJKMNPQRS");

function capture(over: Partial<Capture["state"]> = {}): Capture {
  return new Capture({
    id,
    title: "A test note",
    body: "hello brain",
    type: "note",
    status: "inbox",
    kind: "note",
    source: "mcp",
    capturedAt: new Date("2026-09-23T06:41:00Z"),
    claimedBy: null,
    claimedAt: null,
    attachments: [],
    originUrl: null,
    proposal: null,
    ...over,
  });
}

describe("FsGitBrainStore", () => {
  it("persists a capture as inbox/<ulid>.md and commits", async () => {
    await store.saveCapture(capture());
    const onDisk = await fs.readFile(path.join(repo, "inbox", `${id.value}.md`), "utf8");
    expect(onDisk).toContain("nexalog:");
    expect(onDisk).toContain("hello brain");

    // a commit was created
    const log = await execFileP("git", ["log", "--oneline"], { cwd: repo });
    expect(log.stdout).toContain("capture");
  });

  it("reads a capture back through getCapture", async () => {
    const got = await store.getCapture(id);
    expect(got).not.toBeNull();
    expect(got!.title).toBe("A test note");
    expect(got!.status).toBe("inbox");
  });

  it("lists captures and filters by status", async () => {
    const list = await store.listCaptures();
    expect(list.length).toBe(1);
    const filtered = await store.listCaptures({ status: "processing" });
    expect(filtered.length).toBe(0);
  });

  it("round-trips a page save/get", async () => {
    const slug = Slug.of("people/example-person");
    await store.savePage(slug, { type: "person", title: "Example" }, "body text");
    const page = await store.getPage(slug);
    expect(page).not.toBeNull();
    expect(page!.frontmatter.type).toBe("person");
    expect(page!.body).toContain("body text");
  });

  it("serializes concurrent writes without corrupting git (single-writer queue)", async () => {
    await Promise.all([
      store.savePage(Slug.of("notes/a"), { title: "A" }, "aaa"),
      store.savePage(Slug.of("notes/b"), { title: "B" }, "bbb"),
      store.savePage(Slug.of("notes/c"), { title: "C" }, "ccc"),
    ]);
    // all three files exist and the repo is not in a mid-merge state
    for (const s of ["notes/a", "notes/b", "notes/c"]) {
      const p = await store.getPage(Slug.of(s));
      expect(p).not.toBeNull();
    }
    const status = await execFileP("git", ["status", "--porcelain"], { cwd: repo });
    expect(status.stdout.trim()).toBe("");
  });
});

/**
 * The lock must distinguish "another writer holds it" from "this process cannot
 * write here at all".
 *
 * The bug these pin: `withLock` caught EVERY error from `open(lockfile, "wx")`
 * and treated it as contention, so a permission fault became a 10-second spin
 * followed by "Timed out waiting for brain-repo write lock" — a message naming
 * contention for a repo where the lockfile did not exist and nothing else was
 * writing. That masking hid a real outage for days: the brain repo was owned by
 * a different uid than the app ran as, every capture failed, and the error text
 * sent the reader hunting a lock holder that was never there.
 *
 * A lock timeout is the RIGHT behaviour only for EEXIST. Everything else has to
 * surface immediately, with the errno intact, so the operator sees the actual
 * cause.
 */
describe("FsGitBrainStore lock failure semantics", () => {
  it("reports a permissions fault instead of spinning to a lock timeout", async () => {
    // A directory where the lockfile's parent cannot be created: a FILE stands
    // in the way, so mkdir fails with ENOTDIR/EEXIST rather than EEXIST-on-open.
    // Either way it is NOT contention and must not become a 10s timeout.
    const blocked = path.join(repo, "blocked-repo");
    await fs.writeFile(blocked, "not a directory", "utf8");
    const lockedStore = new FsGitBrainStore({
      repoPath: blocked,
      lockfilePath: path.join(blocked, ".nexalog", "write.lock"),
    });

    const started = Date.now();
    await expect(lockedStore.saveCapture(capture())).rejects.toThrow(/write lock/i);
    const elapsed = Date.now() - started;

    // The decisive assertion: it failed FAST. The old code burned the full
    // 10,000ms deadline before reporting a (wrong) timeout.
    expect(elapsed).toBeLessThan(2_000);
  });

  it("names the cause and the path, not just 'timed out'", async () => {
    const blocked = path.join(repo, "blocked-repo-2");
    await fs.writeFile(blocked, "not a directory", "utf8");
    const lockedStore = new FsGitBrainStore({
      repoPath: blocked,
      lockfilePath: path.join(blocked, ".nexalog", "write.lock"),
    });

    // The message must carry the diagnosis: an errno code and the lock path.
    await expect(lockedStore.saveCapture(capture())).rejects.toThrow(
      /Cannot acquire the brain-repo write lock at .*write\.lock: [A-Z]+/,
    );
  });

  it("still reports a genuine holder as a lock timeout", async () => {
    // Pre-create the lockfile: now `wx` fails EEXIST, which IS the retryable
    // case. This must keep spinning to the timeout — the fix narrows the retry
    // set, it does not remove it.
    const held = path.join(repo, ".nexalog", "write.lock");
    await fs.mkdir(path.dirname(held), { recursive: true });
    await fs.writeFile(held, "999999\n", "utf8");
    try {
      await expect(store.saveCapture(capture({ title: "held" }))).rejects.toThrow(
        /Timed out waiting for brain-repo write lock/,
      );
    } finally {
      await fs.unlink(held).catch(() => undefined);
    }
  }, 20_000);
});
