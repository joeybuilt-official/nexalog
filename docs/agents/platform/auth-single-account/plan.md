# Plan: Single-account Google login (the allowlist door)

- **Area:** `platform`  ·  **Started:** 2026-10-21  ·  **Status:** In progress — code + tests green, PR open, **not merged, not deployed**
- **Owner:** builder (Hermes), for Dustin
- **Next step:** Dustin merges, then the two operator-gated steps in §Milestones M4 — (1) add `https://app.nexalog.com/api/auth/callback/google` to a Google OAuth client in the Google console, (2) set the three env vars in the live compose file and restart `nexalog-v2-web-1`. The code side needs nothing further.
- **Roadmap initiative:** none — a security fix with a single named requester (Dustin), not a strategic arc.

## Goal

After this ships, clicking "Continue with Google" signs **one** person in — `dustin.olenslager@gmail.com` —
and every other Google identity is refused **at the auth layer**, before a user row or a session exists.
The app stops being open to the world the moment the Google provider is switched on, which is what
`disableSignUp: true` was assumed to guarantee and does not.

**Out of scope:** deleting or editing any existing user row (removing `abeole21@gmail.com` is the
operator's call, and the door does not need the deletion — see M3); a second login button or any UI
work (one already exists, gated on `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED`); password login policy (unchanged);
the four sibling apps on the same `auth` schema.

## Context

The Google provider in `apps/web/lib/auth.ts` is already written and already conditional on
`NEXALOG_GOOGLE_CLIENT_ID` / `NEXALOG_GOOGLE_CLIENT_SECRET`; the button in
`apps/web/app/(auth)/login/login-form.tsx` already renders when `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` is
`"true"`. Neither Google variable is in the live container's environment, which is the whole reason the
button is dark.

The trap that makes this more than a config change: **`disableSignUp` governs `emailAndPassword` only.**
With a social provider configured, Better Auth's OAuth callback calls `internalAdapter.createOAuthUser`
→ `createWithHooks(user)` → the raw adapter's `create`, and a user row is written for whatever Google
account completed the flow. Turning the provider on as-is would have opened registration to everyone
— the opposite of the request.

The contract this relies on is the **installed** one, `better-auth@1.6.9`, read out of
`node_modules/@better-auth/core/dist/db/with-hooks.mjs`: `createWithHooks` runs
`hooks.user.create.before` and **`if (result === false) return null`**; a thrown `APIError` propagates.
`createOAuthUser` (the social path) and `createUser` (the credential path) both go through it, and
`createSession` does the same for `session.create.before`. So the gate is one place per path, honoured
by both.

Schema note: `auth."user"` is **shared** — Fylo, Levio, Fonto and Ordica read the same table through
their own `betterAuth({...})`. Hooks come from the instance's own options when its context is built, so
this door is Nexalog's alone; the test asserts that with a second un-hooked instance against the same
data rather than claiming it.

## Architecture

- **Layers touched:** Interface Adapters only. `apps/web/lib/auth/allowlist.ts` (pure predicate),
  `apps/web/lib/auth/allowlist-hooks.ts` (the `databaseHooks` factory), `apps/web/lib/auth.ts`
  (composition — where the instance is built), plus the two server-side read paths that turn a session
  into a request identity (`lib/auth/server.ts`, `lib/auth/middleware.ts`) and the three auth routes
  that read a session directly.
- **New ports (interfaces):** none. `lookupUserEmail` is injected into the hooks factory as a plain
  function, so the hook module never imports the pool — it is testable with a Map and stays inside the
  adapter layer.
- **Boundary data:** the hook sees a `User`-shaped row and returns `boolean | void | { data }`. Nothing
  is serialized to the wire, nothing is handed to the ORM by reflection; the read path is one
  parameterized `select email from auth."user" where id = $1`.
- **Dependency direction:** inward-flat. The predicate imports nothing. The hook module imports only
  `better-auth/api` for `APIError`. `lib/auth.ts` (composition root for auth) supplies the pool query.
- **Swap test:** replacing Better Auth would touch `lib/auth.ts`, `lib/auth/allowlist-hooks.ts` and the
  two read paths — all Interface Adapters / Frameworks & Drivers. The predicate survives untouched.

## Milestones

- **M1 — the door (done).** `isAllowedEmail()` is one address, case- and padding-insensitive; the
  allowlist is a one-line array. `allowlistDatabaseHooks()` refuses `user.create` and `session.create`
  with a `FORBIDDEN` `APIError` carrying a second-person message that does not confirm whether an
  account exists. Both throw rather than return `false`: a throw is the same refusal to the caller and
  is far harder to mistake for a no-op when reading the code.
- **M2 — the read paths (done).** `getAuthUser()` and `updateSession()` refuse a session whose email is
  not on the list, so a row that predates the gate cannot ride an old session in. The three routes that
  call `auth.api.getSession` directly (`passkey/register`, `passkey/register-verify`, `keypair`) apply
  the same check. Belt and braces on purpose: `session.create` stops new sessions, this stops old ones,
  and the old ones live for as long as the row does.
- **M3 — proof (done).** `apps/web/lib/__tests__/auth-allowlist.test.ts`, 10 cases: owner creates;
  a stranger is refused at `createUser` **and** at `createOAuthUser` (the social path) **and** writes no
  row; a pre-existing non-allowlisted row is refused a session and its row survives; the owner still
  gets a session; a second un-hooked instance on the same data is unaffected.
- **M4 — operator-gated, NOT done here.**
  1. Add `https://app.nexalog.com/api/auth/callback/google` as an authorized redirect URI on a Google
     OAuth client. **No existing client carries it** — probed read-only against the authorize endpoint
     for all four pairs in the estate `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_ID`,
     `ORDICA_GOOGLE_CLIENT_ID`, `PLEXO_GOOGLE_CLIENT_ID`) with both `app.nexalog.com` and `nexalog.com`:
     every one returned Google's `redirect_uri_mismatch` page, while control probes for the URIs those
     clients *do* serve returned the consent page. A trailing slash or http/https difference produces
     the same page as a real code bug, so it must be registered exactly.
  2. Set `NEXALOG_GOOGLE_CLIENT_ID`, `NEXALOG_GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`
     in the live compose env (`/mnt/user/appdata/joeybuilt-migration/source/nexalog-pub/nexalog-prod-compose.yml`)
     and restart the `web` container — not the stack. The secret goes in the env file, never the repo.
  Deploy-source caveat: post-flip, the deployed tree is the **public** repo `nexalog-pub`; this branch
  must reach that tree (or a sibling branch of the same commit) before the built bundle can carry
  `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED`. `NEXT_PUBLIC_*` is inlined at build time, so the flag has to be
  true when the image is built, not only when it runs.

## Open questions

- Which client to extend: reuse `GOOGLE_CLIENT_ID` (shared by Fylo and Levio) or create a dedicated
  Nexalog client. Reuse is fewer moving parts but couples Nexalog's consent screen, branding and
  verification status to two other apps; a dedicated client is cleaner and costs one console trip.
  **This is Dustin's call and needs console access either way.**
- Whether to delete `abeole21@gmail.com`. Not needed for the door to hold; left in place.

## Build notes

- `disableSignUp: true` is kept — it still governs the credential path, and the two gates are
  independent.
- The refusal is a `FORBIDDEN` `APIError`, so a blocked attempt is visible in logs as a refusal rather
  than a silent 500 — but the message is deliberately vague to the caller (`not invited`), so the
  endpoint does not become an account-existence oracle.
- The allowlist lives in source, not env, on purpose: an env-supplied allowlist can be widened by
  anyone who can edit a container's environment, and this list is expected to change about never.
- Verification used the memory adapter, so the test writes nothing and needs no database, while still
  driving the real `internalAdapter` methods the OAuth callback drives.
- **Deletion candidates.** (1) The three direct-session route patches — deleting them would leave a
  pre-existing session able to call passkey/keypair registration; kept because "cannot obtain a
  session" has to hold even for a cookie minted before the gate. (2) A second "Continue with Google"
  button — never built; the existing one is flag-gated. (3) Any env-driven allowlist — rejected, see
  above. (4) Deleting the blocked user row — rejected; the door does not need it and deletion is the
  operator's call.

## On ship

Move to `platform/completed/`, add a line to `../../completed-features.md`, delete the queue row, and
record in the worklog that the redirect URI and the three env vars are **operator-gated** until they
land.
