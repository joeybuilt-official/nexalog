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
