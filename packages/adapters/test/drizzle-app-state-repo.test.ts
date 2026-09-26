import { describe, it, expect, beforeAll } from "vitest";

import { DrizzleAppStateRepo } from "../src/db-drizzle/drizzle-app-state-repo";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as pgSql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "../src/db-drizzle/schema";
import { Ulid, type AppStateRepo } from "@nexalog/core";

/**
 * Integration test for DrizzleAppStateRepo — GATED on DATABASE_URL.
 * Skips silently when no Postgres is reachable (CI without a database, etc.).
 * Requires the nexalog schema to exist (`nexalog-v2-bootstrap.sql`).
 */
const DATABASE_URL = process.env.DATABASE_URL ?? "";

const d = DATABASE_URL ? describe : describe.skip;
d("DrizzleAppStateRepo", () => {
  let repo: DrizzleAppStateRepo;
  let client: ReturnType<typeof postgres>;
  const createdTokens: string[] = [];
  const READ_USER = "it-test-user";

  beforeAll(async () => {
    if (!DATABASE_URL) return; // describe.skip — never constructed
    client = postgres(DATABASE_URL);
    const db = drizzle(client, { schema });
    repo = new DrizzleAppStateRepo({ databaseUrl: DATABASE_URL });
    // clean slate
    await db.execute(pgSql`truncate ${pgSql.identifier("nexalog")}.${pgSql.identifier("capture_index")}`);
    await db.execute(pgSql`truncate ${pgSql.identifier("nexalog")}.${pgSql.identifier("api_tokens")}`);
    await db.execute(pgSql`truncate ${pgSql.identifier("nexalog")}.${pgSql.identifier("read_state")}`);
  });

  it("upserts + lists index rows with paging", async () => {
    const now = new Date("2026-09-23T08:00:00Z");
    await repo.upsertCaptureIndex([
      {
        ulid: "01ITTEST00000000000000000A",
        path: "inbox/01ITTEST00000000000000000A.md",
        type: "note",
        schemaVersion: 1,
        status: "inbox",
        kind: "note",
        source: "mcp",
        capturedAt: now,
        processedAt: null,
        claimedBy: null,
        attachments: [],
        originUrl: null,
        hasProposal: false,
        title: "one",
        bodySha256: null,
        reindexedAt: now,
      },
      {
        ulid: "01ITTEST00000000000000000B",
        path: "inbox/01ITTEST00000000000000000B.md",
        type: "note",
        schemaVersion: 1,
        status: "processing",
        kind: "link",
        source: "web",
        capturedAt: new Date(now.getTime() - 60000),
        processedAt: null,
        claimedBy: "agent-primary",
        attachments: [],
        originUrl: "https://example.com",
        hasProposal: false,
        title: "two",
        bodySha256: "deadbeef",
        reindexedAt: now,
      },
    ]);

    const page1 = await repo.listInboxIndex({ limit: 1 });
    expect(page1.rows).toHaveLength(1);
    expect(page1.rows[0].ulid).toBe("01ITTEST00000000000000000A");
    expect(page1.nextCursor).toBe("01ITTEST00000000000000000A");

    const page2 = await repo.listInboxIndex({ limit: 1, cursor: page1.nextCursor! });
    expect(page2.rows[0].ulid).toBe("01ITTEST00000000000000000B");
    expect(page2.nextCursor).toBeNull();

    const filtered = await repo.listInboxIndex({ status: "processing" });
    expect(filtered.rows.map((r) => r.ulid)).toEqual(["01ITTEST00000000000000000B"]);

    const fetched = await repo.getCaptureIndexRow("01ITTEST00000000000000000B");
    expect(fetched).not.toBeNull();
    expect(fetched!.claimedBy).toBe("agent-primary");
    expect(fetched!.bodySha256).toBe("deadbeef");
  });

  it("rebuildCaptureIndex truncates and repopulates within one transaction", async () => {
    const now = new Date("2026-09-23T09:00:00Z");
    await repo.rebuildCaptureIndex([
      {
        ulid: "01ITTEST00000000000000000C",
        path: "inbox/01ITTEST00000000000000000C.md",
        type: "note",
        schemaVersion: 1,
        status: "review",
        kind: "doc",
        source: "pwa-share",
        capturedAt: now,
        processedAt: null,
        claimedBy: null,
        attachments: [],
        originUrl: null,
        hasProposal: true,
        title: "rebuilt",
        bodySha256: null,
        reindexedAt: now,
      },
    ]);
    const fetched = await repo.getCaptureIndexRow("01ITTEST00000000000000000C");
    expect(fetched).not.toBeNull();
    expect(fetched!.hasProposal).toBe(true);
  });

  it("createApiToken never stores plaintext; verify works and revocation kills it", async () => {
    const created = await repo.createApiToken("agent-primary");
    createdTokens.push(created.name);

    expect(created.token.startsWith("nex_")).toBe(true);
    expect(created.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(created.tokenHash).not.toContain(created.token.slice(10));

    // only the hash is persisted — verify via raw SQL
    const raw = await client`select token_hash, token_prefix from nexalog.api_tokens where name = 'agent-primary'`;
    expect(raw).toHaveLength(1);
    const hexInDb = String((raw[0] as { token_hash: string }).token_hash);
    expect(hexInDb).not.toContain("nex_");

    const verified = await repo.verifyApiToken(created.token);
    expect(verified).not.toBeNull();
    expect(verified!.name).toBe("agent-primary");
    expect(verified!.lastUsedAt).not.toBeNull();

    const wrong = await repo.verifyApiToken("nex_wrong-token-value");
    expect(wrong).toBeNull();

    await repo.revokeApiToken("agent-primary");
    const afterRevoke = await repo.verifyApiToken(created.token);
    expect(afterRevoke).toBeNull();

    // idempotent re-issue resets revocation
    const reissued = await repo.createApiToken("agent-primary");
    createdTokens.push(reissued.name);
    const afterReissue = await repo.verifyApiToken(reissued.token);
    expect(afterReissue).not.toBeNull();
  });

  it("marks and reports read state per user", async () => {
    const id = Ulid.of("0123456789ABCDEFGHJKMNPQRS");
    expect(await repo.isRead(id, READ_USER)).toBe(false);
    await repo.markRead(id, new Date(), READ_USER);
    expect(await repo.isRead(id, READ_USER)).toBe(true);
    // idempotent insert-on-read
    await repo.markRead(id, new Date(), READ_USER);
    expect(await repo.isRead(id, READ_USER)).toBe(true);
    // other users are still unread
    expect(await repo.isRead(id, "other")).toBe(false);
  });
});
