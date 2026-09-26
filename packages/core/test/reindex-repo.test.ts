import { describe, it, expect } from "vitest";

import {
  AppStateRepo,
  ApiTokenCreated,
  ApiTokenView,
  BrainStore,
  Capture,
  CaptureIndexRow,
  InboxIndexFilter,
  InboxIndexPage,
  Ulid,
  ReindexRepo,
} from "@nexalog/core";

// ── in-memory ports ─────────────────────────────────────────────────────────

class MemAppState implements AppStateRepo {
  rows = new Map<string, CaptureIndexRow>();
  cleared = 0;
  upserts: CaptureIndexRow[][] = [];

  async upsertCaptureIndex(rows: CaptureIndexRow[]): Promise<void> {
    this.upserts.push(rows);
    for (const r of rows) this.rows.set(r.ulid, r);
  }
  async listInboxIndex(filter: InboxIndexFilter = {}): Promise<InboxIndexPage> {
    let all = [...this.rows.values()].sort(
      (a, b) => b.capturedAt.getTime() - a.capturedAt.getTime() || (a.ulid < b.ulid ? 1 : -1),
    );
    if (filter.status) all = all.filter((r) => r.status === filter.status);
    const start = filter.cursor ? all.findIndex((r) => r.ulid === filter.cursor) + 1 : 0;
    const limit = filter.limit ?? 50;
    const page = all.slice(start, start + limit);
    return { rows: page, nextCursor: start + limit < all.length ? page[page.length - 1].ulid : null };
  }
  async deleteCaptureIndex(ulids: string[]): Promise<void> {
    for (const u of ulids) this.rows.delete(u);
  }
  async clearCaptureIndex(): Promise<void> {
    this.cleared++;
    this.rows.clear();
  }
  async getCaptureIndexRow(ulid: string): Promise<CaptureIndexRow | null> {
    return this.rows.get(ulid) ?? null;
  }
  async markRead(): Promise<void> {}
  async isRead(): Promise<boolean> {
    return false;
  }
  async createApiToken(name: string): Promise<ApiTokenCreated> {
    return { id: "x", name, tokenPrefix: "nex_", token: "t", tokenHash: "h", createdAt: new Date() };
  }
  async verifyApiToken(): Promise<ApiTokenView | null> {
    return null;
  }
  async revokeApiToken(): Promise<void> {}
  async listApiTokens(): Promise<ApiTokenView[]> {
    return [];
  }
}

class MemBrainStore implements BrainStore {
  captures = new Map<string, Capture>();
  async saveCapture(c: Capture): Promise<void> {
    this.captures.set(c.state.id.value, c);
  }
  async getCapture(id: Ulid): Promise<Capture | null> {
    return this.captures.get(id.value) ?? null;
  }
  async listCaptures(): Promise<Capture[]> {
    return [...this.captures.values()].map((c) => c.state as unknown as Capture);
  }
  async updateCapture(c: Capture): Promise<void> {
    this.captures.set(c.state.id.value, c);
  }
  async getPage() {
    return null;
  }
  async savePage(): Promise<void> {}
  async saveAttachment() {
    return { path: "attachments/x" };
  }
}

// ── fixtures ────────────────────────────────────────────────────────────────

function capture(over: Partial<Capture["state"]> = {}): Capture {
  return new Capture({
    id: Ulid.of("0123456789ABCDEFGHJKMNPQRS"),
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

const reindexedAt = new Date("2026-09-23T12:00:00Z");
const hasher = (body: string) => body.split("").reverse().join(""); // cheap fake "sha256 hex"

// ── tests ───────────────────────────────────────────────────────────────────

describe("ReindexRepo", () => {
  it("clears the index, reads the store, and upserts derived rows", async () => {
    const store = new MemBrainStore();
    const state = new MemAppState();
    const repo = new ReindexRepo(store, state, { now: () => reindexedAt }, hasher);

    store.captures.set(
      "0123456789ABCDEFGHJKMNPQRS",
      capture({
        attachments: [{ path: "attachments/2026/09/a.opus", kind: "audio", sizeBytes: 10 }],
        proposal: { pages: [], links: [], confidence: 0.9 },
      }),
    );

    const result = await repo.execute();

    expect(state.cleared).toBe(1); // truncate semantics
    expect(state.upserts.length).toBe(1);
    expect(result.indexed).toBe(1);
    expect(result.ulids).toEqual(["0123456789ABCDEFGHJKMNPQRS"]);

    const row = state.rows.get("0123456789ABCDEFGHJKMNPQRS")!;
    expect(row.path).toBe("inbox/0123456789ABCDEFGHJKMNPQRS.md");
    expect(row.status).toBe("inbox");
    expect(row.attachments).toEqual(["attachments/2026/09/a.opus"]);
    expect(row.hasProposal).toBe(true);
    expect(row.bodySha256).toBe(hasher("hello brain"));
    expect(row.reindexedAt.getTime()).toBe(reindexedAt.getTime());
  });

  it("is a full reconciliation: orphan index rows do not survive a rebuild", async () => {
    const store = new MemBrainStore();
    const state = new MemAppState();
    const repo = new ReindexRepo(store, state, { now: () => reindexedAt }, hasher);

    await state.upsertCaptureIndex([
      {
        ulid: "01ABCDEFGHJKMNPQRS0123456",
        path: "inbox/01ABCDEFGHJKMNPQRS0123456.md",
        type: "note",
        schemaVersion: 1,
        status: "inbox",
        kind: "note",
        source: "web",
        capturedAt: reindexedAt,
        processedAt: null,
        claimedBy: null,
        attachments: [],
        originUrl: null,
        hasProposal: false,
        title: "orphan",
        bodySha256: null,
        reindexedAt,
      },
    ]);

    await repo.execute(); // store is empty

    expect(state.rows.size).toBe(0); // orphan wiped by truncate
  });

  it("upserts nothing when the repo has no captures but still truncated", async () => {
    const store = new MemBrainStore();
    const state = new MemAppState();
    const repo = new ReindexRepo(store, state, { now: () => reindexedAt }, hasher);

    const result = await repo.execute();

    expect(state.cleared).toBe(1);
    expect(state.upserts.length).toBe(0); // no empty batch write
    expect(result.indexed).toBe(0);
  });

  it("rebuild reflects the CURRENT status from the system of record", async () => {
    const store = new MemBrainStore();
    const state = new MemAppState();
    const repo = new ReindexRepo(store, state, { now: () => reindexedAt }, hasher);

    await store.saveCapture(
      capture({ claimedBy: "agent-primary", claimedAt: reindexedAt }),
    );
    const cap = (await store.getCapture(Ulid.of("0123456789ABCDEFGHJKMNPQRS")))!;
    const mutated = JSON.parse(JSON.stringify(cap.state));
    mutated.status = "processing";
    await store.updateCapture(new Capture(mutated as unknown as Capture["state"]));

    await repo.execute();

    const row = state.rows.get("0123456789ABCDEFGHJKMNPQRS")!;
    expect(row.status).toBe("processing");
    expect(row.claimedBy).toBe("agent-primary");
  });
});
