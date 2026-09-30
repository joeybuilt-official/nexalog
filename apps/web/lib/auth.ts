// SPDX-License-Identifier: MIT
import { betterAuth } from "better-auth";
import { admin, bearer } from "better-auth/plugins";
import { Pool } from "pg";
import { hostConfig as hostConfigFromEnv, trustedOriginsFromEnv } from "@/lib/hosts/config";

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

export const auth = betterAuth({
  database: pool,
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
