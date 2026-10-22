# Plan: Invite-only Google login (the allowlist door)

- **Area:** `platform`  ·  **Started:** 2026-10-21  ·  **Status:** In progress — code + tests green, PR open, **not merged, not deployed**
- **Owner:** builder (Hermes), for Dustin
- **Next step:** land this amendment (two addresses + account linking), then the operator-gated step in §Milestones M4 — (1) create a Google OAuth client and add `https://app.nexalog.com/api/auth/callback/google`, saving the id + secret to `Projects/Keys/nexalog-google-client.txt`, (2) set `NEXALOG_GOOGLE_CLIENT_ID` and `NEXALOG_GOOGLE_CLIENT_SECRET` in the live compose file and rebuild + restart `nexalog-v2-web-1`. **`BETTER_AUTH_URL` and `NEXALOG_FRONTEND_URL` stay as they are** (`https://app.nexalog.com` / `https://nexalog.com`) — the app origin and the split-cookie input are already correct on the live container. The button needs no build flag: it is derived from the credentials server-side.
- **Roadmap initiative:** none — a security fix with a single named requester (Dustin), not a strategic arc.

## Goal

After this ships, clicking "Continue with Google" signs in **exactly two people** —
`dustin.olenslager@gmail.com` and `abeole21@gmail.com` — and every other Google identity is refused **at
the auth layer**, before a user row or a session exists. The app stops being open to the world the
moment the Google provider is switched on, which is what `disableSignUp: true` was assumed to guarantee
and does not.

The second address was added by the owner on 2026-10-21 ("That's my son Abe. You can allow him to login
with that google account too."). It changes the shape of the work in one way that matters: Abe's address
**already owns a user row** with a `credential` account and no Google link, so the question is not only
"is he allowed in" but "does the Google identity land on the row he already has". It does — and that is
pinned by a test that drives Better Auth's own linking code (§Build notes).

**Out of scope:** deleting or editing any existing user row (no row is removed — both allowed addresses
keep theirs); a second login button or any UI work (one already exists, credential-derived); password
login policy (unchanged); the four sibling apps on the same `auth` schema.

## Context

The Google provider in `apps/web/lib/auth.ts` is already written and already conditional on
`NEXALOG_GOOGLE_CLIENT_ID` / `NEXALOG_GOOGLE_CLIENT_SECRET`; the button in
`apps/web/app/(auth)/login/login-form.tsx` renders when the server tells it the credentials exist
(`googleLoginEnabled()` in `lib/auth/google-enabled.ts`, passed down from the login page). Neither
Google variable is in the live container's environment, which is the whole reason the button is dark.
The button used to be gated on `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED`, which is inlined at build time and
would have stayed dark on a correctly configured container — see §Build notes.

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

- **M1 — the door (done).** `isAllowedEmail()` is a short literal list, case- and padding-insensitive;
  two addresses since 2026-10-21 (owner + son). `allowlistDatabaseHooks()` refuses `user.create` and `session.create`
  with a `FORBIDDEN` `APIError` carrying a second-person message that does not confirm whether an
  account exists. Both throw rather than return `false`: a throw is the same refusal to the caller and
  is far harder to mistake for a no-op when reading the code.
- **M2 — the read paths (done).** `getAuthUser()` and `updateSession()` refuse a session whose email is
  not on the list, so a row that predates the gate cannot ride an old session in. The three routes that
  call `auth.api.getSession` directly (`passkey/register`, `passkey/register-verify`, `keypair`) apply
  the same check. Belt and braces on purpose: `session.create` stops new sessions, this stops old ones,
  and the old ones live for as long as the row does.
- **M3 — proof (done).** `apps/web/lib/__tests__/auth-allowlist.test.ts`: both invited addresses create;
  a stranger is refused at `createUser` **and** at `createOAuthUser` (the social path) **and** writes no
  row; a pre-existing non-allowlisted row is refused a session and its row survives; both invited users
  get sessions; a second un-hooked instance on the same data is unaffected.
- **M3b — the second row is the same person (done).** `apps/web/lib/__tests__/auth-account-linking.test.ts`
  drives the vendor's own `handleOAuthUserInfo` (exported from `better-auth/oauth2`) with a fake Google
  identity against a seeded credential-only row: the sign-in links onto that row, the user count stays
  at 1, the account count goes 1 → 2, and the session is issued for the same user id. Two negative
  cases pin why the config exists: without `accountLinking.trustedProviders: ["google"]` the same input
  is refused with `account not linked`, and even then no second row is ever created.
- **M4 — operator-gated, NOT done here.**
  1. Add `https://app.nexalog.com/api/auth/callback/google` as an authorized redirect URI on a Google
     OAuth client. **No existing client carries it** — probed read-only against the authorize endpoint
     for all four pairs in the estate `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_ID`,
     `ORDICA_GOOGLE_CLIENT_ID`, `PLEXO_GOOGLE_CLIENT_ID`) with both `app.nexalog.com` and `nexalog.com`:
     every one returned Google's `redirect_uri_mismatch` page, while control probes for the URIs those
     clients *do* serve returned the consent page. A trailing slash or http/https difference produces
     the same page as a real code bug, so it must be registered exactly.
  2. Set `NEXALOG_GOOGLE_CLIENT_ID` and `NEXALOG_GOOGLE_CLIENT_SECRET` in the live compose env
     (`/mnt/user/appdata/joeybuilt-migration/source/nexalog-pub/nexalog-prod-compose.yml`) and rebuild
     the `web` service — not the stack. There is **no** `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` in this block:
     the button is credential-derived, and on the pre-amendment tree the flag could never work anyway
     (`apps/web/Dockerfile` declares no `ARG`/`ENV` for any `NEXT_PUBLIC_*`). `NEXALOG_FRONTEND_URL`
     (`https://nexalog.com`) and `BETTER_AUTH_URL` (`https://app.nexalog.com`) are already on the live
     container and must not be changed by this deploy. The secret goes in the env file, never the repo.
  Deploy-source caveat: post-flip, the deployed tree is the **public** repo `nexalog-pub`; this branch
  must reach that tree (or a sibling branch of the same commit) before the built bundle can carry
  `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED`. `NEXT_PUBLIC_*` is inlined at build time, so the flag has to be
  true when the image is built, not only when it runs.

## Open questions

- Which client to extend: reuse `GOOGLE_CLIENT_ID` (shared by Fylo and Levio) or create a dedicated
  Nexalog client. Reuse is fewer moving parts but couples Nexalog's consent screen, branding and
  verification status to two other apps; a dedicated client is cleaner and costs one console trip.
  **This is Dustin's call and needs console access either way.**
- ~~Whether to delete `abeole21@gmail.com`.~~ **Resolved 2026-10-21:** he is invited, not removed. His row
  stays and gains the Google account; nothing is deleted.

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
- **The button's gate is server-derived, not a build flag.** `NEXT_PUBLIC_*` is inlined by `next build`,
  so a client-side flag can hide the button on a deployment that is correctly configured — and
  `apps/web/Dockerfile` declares no `ARG`/`ENV` for any `NEXT_PUBLIC_*`, so even `build.args` would not
  reach the build. `lib/auth/google-enabled.ts` decides from the credentials on the server and
  `app/(auth)/login/page.tsx` passes the boolean down, exactly as it already passes `appOrigin`. A test
  pins the predicate; nothing about the button needs a rebuild to turn on beyond the deploy itself.
- **The Google identity links onto an existing row instead of creating a twin.** `dist/oauth2/link-account.mjs`
  looks the user up **by email** first; if a row exists without an account for this provider it links
  onto it when the provider is trusted **or** the provider asserts `email_verified`, and otherwise
  returns `account not linked` — it never inserts a second user with the same email. Google does assert
  `email_verified` for a Gmail address, so the default would link Abe today, but that is a statement by
  the provider, not a policy here. `lib/auth.ts` therefore declares
  `account: { accountLinking: { enabled: true, trustedProviders: ["google"] } }`, which removes the
  dependence on that claim and leaves the allowlist as the only thing deciding who may link at all.
  Executed against the installed 1.6.9 before writing the test (four probe runs): existing row +
  `email_verified: true` → links; existing row + `false` with no config → `account not linked`, one row;
  existing row + `false` with the config → links; no row → the create path, which the allowlist hook
  refuses.
- **Callback host is the APP host, and the split-cookie design is why.** `BETTER_AUTH_URL` names the app
  origin (`lib/hosts/config.ts` reads `NEXALOG_APP_URL ?? BETTER_AUTH_URL`), and `isCookieShared` returns
  the shared parent domain — `.nexalog.com` — only while the front and app hosts differ. So the redirect
  URI to register is `https://app.nexalog.com/api/auth/callback/google`, and moving `BETTER_AUTH_URL` to
  the apex would drop `advanced.crossSubDomainCookies` to host-only cookies. Page routes on the app host
  do 307 to the apex, but **`/api/auth/*` does not**: probed live during this work, a synthetic
  `?code=…&state=…` hits the handler on **both** hosts and both answer
  `302 /api/auth/error?error=please_restart_the_process` (the state cookie is absent, which is the
  correct answer for a forged code) — the callback therefore runs on whichever host Google was told,
  with no redirect in between. The flow still starts on the apex, because `/login` is canonical there;
  the state cookie is `.nexalog.com`-scoped, so the app-host callback can read it and the session it
  mints is readable on the apex pages. Host alignment (one host, no split) is a separate change, not
  this one.

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
