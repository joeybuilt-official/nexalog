// SPDX-License-Identifier: MIT
import { betterAuth } from "better-auth";
import { admin, bearer } from "better-auth/plugins";
import { Pool } from "pg";
import { hostConfig as hostConfigFromEnv, trustedOriginsFromEnv } from "@/lib/hosts/config";
import { allowlistDatabaseHooks } from "@/lib/auth/allowlist-hooks";

const pool = new Pool({
  connectionString:
    process.env.AUTH_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "postgresql://placeholder:5432/placeholder",
  max: 10,
  idleTimeoutMillis: 30_000,
  options: "-c search_path=auth",
});

const googleClientId = process.env.NEXALOG_GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.NEXALOG_GOOGLE_CLIENT_SECRET;

const hostConfig = hostConfigFromEnv();

/**
 * SESSION-GATE — the email behind a user id, for the allowlist's second path.
 * `databaseHooks.session.create` fires for every way a session is minted
 * (Google callback, email/password, bearer), and the user row it points at may
 * predate the allowlist; looking the address up is what closes that path.
 * One primary-key read per session creation, which is a login-frequency event.
 */
async function lookupUserEmail(userId: string): Promise<string | null> {
  const { rows } = await pool.query<{ email: string }>(
    'select email from auth."user" where id = $1 limit 1',
    [userId],
  );
  return rows[0]?.email ?? null;
}

export const auth = betterAuth({
  database: pool,
  // INVITE DOOR. `disableSignUp` below covers email/password only — a social
  // provider still creates a user row for any Google account that completes the
  // flow. These hooks are the binding rule: `user.create` refuses an address
  // that is not on the list, `session.create` refuses a session for a row that
  // is already there. Both throw 403 rather than returning false (see the module
  // comment in allowlist-hooks.ts for why the social callback needs the throw).
  // The list itself is `lib/auth/allowlist.ts` — two people, owner + son.
  databaseHooks: allowlistDatabaseHooks(lookupUserEmail),
  // Additive: the bearer plugin lets the server ALSO accept
  // `Authorization: Bearer <session-token>` in addition to the web cookie.
  // The native mobile client reads the token from the `set-auth-token`
  // response header on sign-in and replays it on every offline-sync request
  // (ADR-0002). Web cookie login is untouched.
  plugins: [admin(), bearer()],
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
  },
  // ONE PERSON, ONE ROW. Abe's address already owns a user row in the shared
  // `auth` schema, created before Google was ever enabled; without this, a
  // Google sign-in for that address links onto the existing row only when the
  // provider asserts `email_verified` — `dist/oauth2/link-account.mjs` refuses
  // with `account not linked` when `!trusted && !emailVerified`. Google does
  // assert it for Gmail, so the default happens to work today, but a claim is
  // not a policy: declaring google trusted makes the link depend on the door in
  // `lib/auth/allowlist.ts` instead. It cannot create a second row — the user is
  // looked up by email before anything is created, and any NEW row is still
  // refused by the `user.create` hook above. Read off the installed 1.6.9 and
  // pinned by `lib/__tests__/auth-account-linking.test.ts`, which drives the
  // vendor's own `handleOAuthUserInfo`.
  account: {
    accountLinking: { enabled: true, trustedProviders: ["google"] },
  },
  ...(googleClientId && googleClientSecret
    ? {
        socialProviders: {
          google: {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
          },
        },
      }
    : {}),
  // NEXALOG-HOSTSPLIT. `trustedOriginsFromEnv` FLATTENS a comma/whitespace
  // separated `TRUSTED_ORIGIN` into separate origins and adds the front-end
  // host. Before this, a value like "https://a,https://b" landed as ONE
  // malformed entry that matched no Origin header, so every auth request from
  // the second host was refused with INVALID_ORIGIN. Additive: with nothing but
  // `BETTER_AUTH_URL` set, the list is the same single origin it is today.
  trustedOrigins: trustedOriginsFromEnv(),
  // The session cookie must be readable on BOTH hostnames or a login taken on
  // the front host authenticates the reader and then bounces them back to a
  // logged-out app. `""` (no derivable shared parent, or no split configured)
  // keeps the cookie host-only — exactly today's behaviour.
  ...(hostConfig.cookieShared ? { advanced: { crossSubDomainCookies: {
    enabled: true,
    domain: hostConfig.cookieDomain,
  } } } : {}),
  secret: process.env.AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
});
