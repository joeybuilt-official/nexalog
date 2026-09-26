// SPDX-License-Identifier: MIT
import { betterAuth } from "better-auth";
import { admin, bearer } from "better-auth/plugins";
import { Pool } from "pg";

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
  trustedOrigins: [
    process.env.BETTER_AUTH_URL,
    process.env.TRUSTED_ORIGIN,
  ].filter((url): url is string => !!url),
  secret: process.env.AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
});
