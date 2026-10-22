// SPDX-License-Identifier: MIT
/**
 * One person, one row — tested by driving Better Auth's OWN linking code
 * (`handleOAuthUserInfo` from `better-auth/oauth2`), not by restating the rule.
 *
 * The question this file answers is the one the allowlist cannot: Abe's address
 * already owns a `user` row from before Google was enabled (provider
 * `credential`). When he clicks "Continue with Google", does Better Auth link
 * that Google identity onto his existing row — keeping his notes where they
 * are — or does it create a second row with the same email? A second row would
 * put one person's data in two places and read to him as data loss.
 *
 * The installed source (`dist/oauth2/link-account.mjs`) settles it: the user is
 * looked up BY EMAIL first, and the link is made onto that row when the provider
 * is trusted or the provider asserts `email_verified`; when neither holds it
 * refuses with `account not linked` — it never creates a duplicate. These tests
 * pin that against 1.6.9 so a dependency bump cannot quietly change it.
 */
import { describe, expect, it } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { handleOAuthUserInfo } from "better-auth/oauth2";

import { allowlistDatabaseHooks } from "@/lib/auth/allowlist-hooks";

const ABE = "abeole21@gmail.com";
const OWNER = "dustin.olenslager@gmail.com";

type AuthInstance = Awaited<ReturnType<typeof makeAuth>>;
type Context = Awaited<AuthInstance["$context"]>;

/** The config `lib/auth.ts` ships: allowlist hooks + google declared trusted. */
async function makeAuth(rows: Map<string, string>, withLinking = true) {
  return betterAuth({
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    secret: "test-only-secret-not-used-anywhere-else",
    baseURL: "http://localhost:3300",
    emailAndPassword: { enabled: true, disableSignUp: true },
    databaseHooks: allowlistDatabaseHooks(async (userId) => rows.get(userId) ?? null),
    ...(withLinking
      ? { account: { accountLinking: { enabled: true, trustedProviders: ["google"] } } }
      : {}),
  });
}

async function contextOf(rows: Map<string, string>, withLinking = true): Promise<Context> {
  return (await makeAuth(rows, withLinking)).$context;
}

/** A pre-Google user row with a password account only — Abe's shape today. */
async function seedCredentialUser(context: Context, email: string, rows: Map<string, string>) {
  const user = await context.adapter.create<{ id: string }>({
    model: "user",
    data: {
      email,
      name: "Abe",
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  await context.adapter.create({
    model: "account",
    data: {
      userId: user.id,
      providerId: "credential",
      accountId: user.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  rows.set(user.id, email);
  return user;
}

/** The exact call the OAuth callback route makes, with a fake Google identity. */
function googleSignIn(context: Context, email: string, emailVerified: boolean) {
  return handleOAuthUserInfo(
    {
      context,
      redirect: (url: string) => {
        throw new Error(`unexpected redirect: ${url}`);
      },
    } as never,
    {
      userInfo: { id: "google-sub-abe", email, emailVerified, name: "Abe" },
      account: { providerId: "google", accountId: "google-sub-abe" },
      callbackURL: "/app/today",
      disableSignUp: false,
      overrideUserInfo: false,
    } as never,
  );
}

describe("(d) an invited address that already owns a row links onto it", () => {
  it("links Google onto Abe's existing row: no second user, same id, session issued", async () => {
    const rows = new Map<string, string>();
    const context = await contextOf(rows);
    const abe = await seedCredentialUser(context, ABE, rows);

    const result = await googleSignIn(context, ABE, false);

    expect(result.error).toBeNull();
    expect(result.isRegister).toBe(false);
    expect(result.data?.user?.id).toBe(abe.id);

    // One person, one row — the assertion the whole file exists for.
    const users = await context.adapter.findMany<{ email: string }>({ model: "user" });
    expect(users).toHaveLength(1);
    expect(users[0]?.email).toBe(ABE);

    const accounts = await context.adapter.findMany<{ providerId: string }>({ model: "account" });
    expect(accounts.map((a) => a.providerId).sort()).toEqual(["credential", "google"]);

    const sessions = await context.internalAdapter.listSessions(abe.id);
    expect(sessions).toHaveLength(1);
  });

  it("links even when the provider omits email_verified — that is why google is trusted", async () => {
    const rows = new Map<string, string>();
    const context = await contextOf(rows);
    await seedCredentialUser(context, ABE, rows);

    const result = await googleSignIn(context, ABE, false);
    expect(result.error).toBeNull();
  });

  it("without the declared trusted provider the same input is refused — the config is load-bearing", async () => {
    const rows = new Map<string, string>();
    const context = await contextOf(rows, false);
    await seedCredentialUser(context, OWNER, rows);

    const refused = await googleSignIn(context, OWNER, false);
    expect(refused.error).toBe("account not linked");
    expect(refused.data).toBeNull();
  });

  it("never creates a second row for the same email, even with linking off", async () => {
    const rows = new Map<string, string>();
    const context = await contextOf(rows, false);
    await seedCredentialUser(context, ABE, rows);

    const result = await googleSignIn(context, ABE, false);

    expect(result.error).toBe("account not linked");
    const users = await context.adapter.findMany({ model: "user" });
    expect(users).toHaveLength(1);
  });
});

describe("the door still holds on the social path", () => {
  it("refuses a stranger's Google sign-up and writes no row", async () => {
    const rows = new Map<string, string>();
    const context = await contextOf(rows);

    const result = await googleSignIn(context, "stranger@example.com", true);

    expect(result.error).toBeTruthy();
    expect(await context.adapter.findMany({ model: "user" })).toHaveLength(0);
    expect(await context.adapter.findMany({ model: "account" })).toHaveLength(0);
  });
});
