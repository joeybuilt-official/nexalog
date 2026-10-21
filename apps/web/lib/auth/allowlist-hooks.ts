// SPDX-License-Identifier: MIT
import { APIError } from "better-auth/api";

import { isAllowedEmail } from "./allowlist";

/**
 * The refusal is one sentence shown to whoever hits the door. It says what
 * happened and why, in the second person, without confirming whether an
 * account exists — an uninvited visitor learns nothing about the owner's data.
 */
export const NOT_INVITED_MESSAGE =
  "Nexalog is a single-account app. This account is not allowed to sign in.";

/** Resolves a user id to its email, or `null` when no such user exists. */
export type EmailLookup = (userId: string) => Promise<string | null>;

/**
 * Better Auth `databaseHooks` that make {@link isAllowedEmail} binding.
 *
 * Verified against the INSTALLED version (better-auth 1.6.9), not the docs:
 * `dist/db/with-hooks.mjs` runs `hooks[model].create.before(data, context)`
 * inside the adapter's create, and the type surface
 * (`@better-auth/core` `types/init-options.d.mts`) declares both hooks with the
 * contract used here. Throwing is deliberate over returning `false`:
 *
 *  - `false` makes `createWithHooks` return `null`. For email sign-up that is a
 *    clean null, but the SOCIAL path (`internalAdapter.createOAuthUser`) builds
 *    the account row from `createdUser.id` — a `null` user becomes a TypeError
 *    and a 500, the user is told nothing, and the failure looks like a bug.
 *  - An `APIError("FORBIDDEN")` rolls the transaction back and surfaces as a 403
 *    with the message above, which is the honest answer.
 *
 * The lookup is injected rather than read from the hook's `context` argument:
 * `context` is `null` whenever the internal adapter is driven outside a request
 * (tests, scripts, future server-side callers), and a guard that silently no-ops
 * in those cases is not a guard.
 */
export function allowlistDatabaseHooks(lookupEmail: EmailLookup) {
  return {
    user: {
      create: {
        before: async (user: { email?: unknown }) => {
          if (!isAllowedEmail(user.email)) {
            throw new APIError("FORBIDDEN", { message: NOT_INVITED_MESSAGE });
          }
        },
      },
    },
    session: {
      create: {
        before: async (session: { userId?: unknown }) => {
          const email =
            typeof session.userId === "string"
              ? await lookupEmail(session.userId)
              : null;
          if (!isAllowedEmail(email)) {
            throw new APIError("FORBIDDEN", { message: NOT_INVITED_MESSAGE });
          }
        },
      },
    },
  };
}
