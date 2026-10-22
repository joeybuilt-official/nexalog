// SPDX-License-Identifier: MIT
/**
 * The invite door, tested against the INSTALLED Better Auth (1.6.9) and
 * its real adapter pipeline — not against the pure predicate alone.
 *
 * Why an integration test and not just a unit test of `isAllowedEmail`: the
 * question is whether the hooks actually bind. A predicate can be perfect and
 * never run; `disableSignUp` is proof of that, because it looks like a gate and
 * does nothing for a social provider. So every case below drives the same
 * `internalAdapter` methods the Google callback and the credential sign-in flow
 * drive, and asserts on the row/session that did or did not survive.
 *
 * The adapter is Better Auth's own in-memory one (`better-auth/adapters/memory`),
 * so this needs no database, writes nothing, and runs in the normal suite.
 */
import { describe, expect, it } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { APIError } from "better-auth/api";

import {
  ALLOWED_EMAILS,
  isAllowedEmail,
  normalizeEmail,
} from "@/lib/auth/allowlist";
import {
  allowlistDatabaseHooks,
  NOT_INVITED_MESSAGE,
} from "@/lib/auth/allowlist-hooks";

const OWNER = "dustin.olenslager@gmail.com";
const ABE = "abeole21@gmail.com";
const STRANGER = "someone.else@gmail.com";

/**
 * A Better Auth instance wired exactly like `lib/auth.ts`: same hooks, same
 * allowlist, memory database. `lookupEmail` stands in for the pool query so the
 * test never needs Postgres.
 */
async function makeAuth(
  rows: Map<string, string>,
  withGate = true,
) {
  return betterAuth({
    // The memory adapter throws `Model <name> not found` for a model it was
    // never given, so every table Better Auth touches is declared up front.
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    secret: "test-only-secret-not-used-anywhere-else",
    baseURL: "http://localhost:3300",
    emailAndPassword: { enabled: true, disableSignUp: true },
    ...(withGate
      ? {
          databaseHooks: allowlistDatabaseHooks(async (userId) =>
            rows.get(userId) ?? null,
          ),
        }
      : {}),
  });
}

/** The refusal, asserted as a status and a message — not just "it threw". */
async function expectRefused(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(APIError);
  await promise.catch((error: unknown) => {
    const apiError = error as APIError;
    expect(apiError.status).toBe("FORBIDDEN");
    expect(apiError.body?.message).toBe(NOT_INVITED_MESSAGE);
  });
}

describe("allowlist predicate", () => {
  it("is exactly the two invited addresses", () => {
    expect(ALLOWED_EMAILS).toEqual([OWNER, ABE]);
  });

  it("admits both invited addresses in any casing or padding the browser may send", () => {
    expect(isAllowedEmail(OWNER)).toBe(true);
    expect(isAllowedEmail("Dustin.Olenslager@Gmail.com")).toBe(true);
    expect(isAllowedEmail("  dustin.olenslager@gmail.com ")).toBe(true);
    expect(isAllowedEmail(ABE)).toBe(true);
    expect(isAllowedEmail("AbeOle21@Gmail.com")).toBe(true);
  });

  it("refuses everyone else, including the empty cases", () => {
    expect(isAllowedEmail(STRANGER)).toBe(false);
    expect(isAllowedEmail("abeole21@gmail.com.evil.example")).toBe(false);
    expect(isAllowedEmail("dustin.olenslager@gmail.com.evil.example")).toBe(false);
    expect(isAllowedEmail("")).toBe(false);
    expect(isAllowedEmail(null)).toBe(false);
    expect(isAllowedEmail(undefined)).toBe(false);
    expect(isAllowedEmail(42)).toBe(false);
  });

  it("normalizes to the same string Google returns", () => {
    expect(normalizeEmail(" Dustin.Olenslager@GMAIL.com ")).toBe(OWNER);
  });
});

describe("user.create hook — a stranger is refused a row", () => {
  it("(a) creates the owner's row, with the address canonicalized by Better Auth", async () => {
    const auth = await makeAuth(new Map());
    const context = await auth.$context;

    const created = await context.internalAdapter.createUser({
      email: OWNER,
      name: "Dustin",
      emailVerified: true,
    });

    expect(created?.id).toBeTruthy();
    const found = await context.internalAdapter.findUserByEmail(OWNER, { includeAccounts: false });
    expect(found?.user.email).toBe(OWNER);
  });

  it("(a2) creates the second invited address's row", async () => {
    const auth = await makeAuth(new Map());
    const context = await auth.$context;

    const created = await context.internalAdapter.createUser({
      email: ABE,
      name: "Abe",
      emailVerified: false,
    });

    expect(created?.id).toBeTruthy();
    const found = await context.internalAdapter.findUserByEmail(ABE, { includeAccounts: false });
    expect(found?.user.email).toBe(ABE);
  });

  it("(b) refuses a different Google account at create, and writes nothing", async () => {
    const auth = await makeAuth(new Map());
    const context = await auth.$context;

    await expectRefused(
      context.internalAdapter.createUser({
        email: STRANGER,
        name: "Not Dustin",
        emailVerified: true,
      }),
    );

    const found = await context.internalAdapter.findUserByEmail(STRANGER, { includeAccounts: false });
    expect(found).toBeNull();
  });

  it("(b2) refuses the social path's combined create too (user + account in one transaction)", async () => {
    const auth = await makeAuth(new Map());
    const context = await auth.$context;

    await expectRefused(
      context.internalAdapter.createOAuthUser(
        { email: STRANGER, name: "Not Dustin", emailVerified: true },
        {
          providerId: "google",
          accountId: "google-sub-123",
        } as Parameters<typeof context.internalAdapter.createOAuthUser>[1],
      ),
    );
    expect(await context.internalAdapter.findUserByEmail(STRANGER, { includeAccounts: false })).toBeNull();
  });
});

describe("session.create hook — an existing row cannot obtain a session", () => {
  it("(c) refuses a session for a pre-existing non-allowlisted row", async () => {
    const rows = new Map<string, string>();
    const auth = await makeAuth(rows);
    const context = await auth.$context;

    // The row that already exists in the shared `auth` schema today, inserted
    // through the raw adapter so the create hook never sees it — exactly how a
    // pre-Google account got there.
    const existing = await context.adapter.create<{ id: string }>({
      model: "user",
      data: {
        id: "user-blocked",
        email: STRANGER,
        name: "Not Dustin",
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    rows.set(existing.id, STRANGER);

    await expectRefused(context.internalAdapter.createSession(existing.id));

    expect(await context.internalAdapter.listSessions(existing.id)).toHaveLength(0);
    // The row itself is untouched — removing it is the operator's call, not the
    // gate's, and a gate that deletes is a different feature.
    expect(await context.internalAdapter.findUserByEmail(STRANGER, { includeAccounts: false })).not.toBeNull();
  });

  it("(d) still issues a session to the owner", async () => {
    const rows = new Map<string, string>();
    const auth = await makeAuth(rows);
    const context = await auth.$context;

    const owner = await context.internalAdapter.createUser({
      email: OWNER,
      name: "Dustin",
      emailVerified: true,
    });
    rows.set(owner.id, OWNER);

    const session = await context.internalAdapter.createSession(owner.id);
    expect(session.token).toBeTruthy();
    expect(await context.internalAdapter.listSessions(owner.id)).toHaveLength(1);
  });
});

describe("the gate is per-instance, not table-wide", () => {
  it("another Better Auth instance on the same data is unaffected", async () => {
    // Fylo, Levio, Fonto and Ordica share this `auth` schema through their OWN
    // `betterAuth({...})` calls. Hooks are read from the instance's own options
    // when its context is built, so an instance without them — this one, which
    // stands in for a sibling app — still creates a stranger's row.
    const gated = await (await makeAuth(new Map())).$context;
    await expectRefused(
      gated.internalAdapter.createUser({
        email: STRANGER,
        name: "Not Dustin",
        emailVerified: true,
      }),
    );

    const sibling = await (await makeAuth(new Map(), false)).$context;
    const stranger = await sibling.internalAdapter.createUser({
      email: STRANGER,
      name: "Not Dustin",
      emailVerified: true,
    });
    expect(stranger?.id).toBeTruthy();
  });
});
