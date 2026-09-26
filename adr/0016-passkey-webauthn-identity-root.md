# ADR-0016 — Passkey / WebAuthn identity root

- **Status**: Accepted
- **Accepted**: 2026-07-02 (operator-authorized full-spec close-out)
- **Date**: 2026-07-02
- **Phase**: U7
- **Owner**: orchestrator
- **Related**: ADR-0014 (intelligence port), ADR-0015 (mesh protocol)

## Context

Current auth: `better-auth` with email/password + optional Google OAuth
(`lib/auth.ts`). No passwordless / hardware-key path. Goals:

1. **Standalone**: passkey registration + authentication works with zero external
   services. A user can create an account and log in using a platform
   authenticator (Face ID, Touch ID, Windows Hello, hardware key) — no Plexo,
   no Google.

2. **Plexo coordinator role**: when the app is connected to a Plexo instance,
   Plexo becomes the canonical identity coordinator. A passkey registered in
   standalone mode is recognized by Plexo without migration — the credential ID
   is the key. Plexo then brokers authorization (canonical profile, per-app
   session tokens, federation across sibling apps).

3. **Second-component recognition**: authenticating with the same passkey on a
   different component (app instance, device) within the same Plexo mesh yields
   the same identity automatically — no linking flow, no account migration.

## Decision

### Passkey plugin (`better-auth` v1.x)

`better-auth` 1.5.6 ships a `passkey` plugin (`better-auth/plugins/passkey`).
This plugin wraps `@simplewebauthn/server` and adds `/api/auth/passkey/*`
endpoints (registration challenge, registration verification, authentication
challenge, authentication verification). The plugin stores credentials in the
`auth` schema (existing DB pool).

> ⚠ **Package verification required**: confirm `better-auth/plugins/passkey`
> exports are present in the installed 1.5.6 build. If not, add
> `@simplewebauthn/server` + `@simplewebauthn/browser` directly (≈same code
> surface, slightly more wiring).

Add to `lib/auth.ts`:
```ts
import { passkey } from "better-auth/plugins/passkey";

plugins: [admin(), bearer(), passkey()],
```

No schema migration beyond what the plugin creates (`passkey_credentials` table
in the `auth` schema — additive).

### Client-side (`better-auth/client/plugins`)

The React client uses `passkeyClient()` from `better-auth/client/plugins`. This
calls the browser's `navigator.credentials.create` / `navigator.credentials.get`
WebAuthn API. No third-party client bundle added.

Mobile: The Flutter mobile app defers passkey support until platform SDK support
is confirmed (platform authenticator availability varies by Android API level).
Email/password + bearer token remains the mobile auth path for now.

### Plexo coordinator role

When `PLEXO_API_URL` is set and Plexo is healthy (same startup check as
ADR-0015):

1. After a successful passkey authentication, the app's session handler calls
   `POST ${PLEXO_API_URL}/api/auth/passkey-link` with the credential ID
   (public-key thumbprint, not the private key) and the local user ID.
2. Plexo stores the mapping (credential ID → Plexo identity). On subsequent
   authentications from any component, Plexo can resolve the credential ID to
   the canonical identity.
3. The app receives a Plexo session token in exchange and stores it alongside the
   better-auth session. Plexo becomes the canonical profile authority; the local
   better-auth record is the auth anchor.

> ⚠ **Plexo endpoint dependency**: `POST /api/auth/passkey-link` must exist in
> Plexo. If it does not, the coordinator step is skipped (graceful degradation)
> and standalone mode remains fully functional. Plexo integration is an
> enhancement, not a requirement.

### Second-component recognition

A "component" is any app instance connected to the same Plexo mesh. When a user
authenticates with a passkey on component B:

1. Component B sends the credential ID to Plexo.
2. Plexo looks up the credential ID → finds the identity registered via component A.
3. Plexo returns the canonical profile + authorization token to component B.
4. Component B creates a local better-auth session linked to that profile.

No manual linking, no migration, no extra registration step. The passkey IS the
cross-component identity proof.

### Auth surface changes

- New routes (added by the `passkey` plugin): `POST /api/auth/passkey/register`,
  `POST /api/auth/passkey/authenticate` (challenge + verify pairs).
- Existing email/password routes unchanged.
- Middleware unchanged (presence-only cookie/bearer check).
- Login UI: add "Sign in with Passkey" button alongside email/password form.

## Consequences

- **Pro**: standalone login fully functional without Plexo or Google.
- **Pro**: platform authenticators (Face ID, Touch ID) provide phishing-resistant
  auth with no password to leak.
- **Pro**: Plexo coordinator role requires no user action — passkey credential ID
  is the shared secret.
- **Pro**: additive — existing email/password accounts are unaffected.
- **Con**: better-auth passkey plugin API surface needs verification against
  1.5.6; may require minor wiring if the plugin is not yet shipped.
- **Con**: Plexo's `passkey-link` endpoint is not yet confirmed to exist; the
  coordinator flow is conditional on Plexo exposing it.
- **Con**: Mobile passkey deferred — Android WebAuthn support varies; Flutter
  plugin landscape is thin. Email/password + bearer remains mobile auth.

## Proof criteria (exit gate for U7 implementation)

1. Can register a new account with a passkey (no email/password required).
2. Can log in with the same passkey — no Plexo running.
3. With Plexo running: same passkey on a second browser profile is recognized as
   the same identity without any linking step.
4. tsc + vitest + build green.

## Alternatives considered

- **lucia-auth + SimpleWebAuthn directly**: rejected — we already have
  `better-auth`; adding a second auth library is wasteful.
- **Magic-link (email OTP)**: rejected — requires an email provider; passkey
  requires only the browser's authenticator API.
- **Plexo-first auth (delegate auth entirely to Plexo)**: rejected — breaks
  standalone mode goal; local auth anchor must work without Plexo.

## Operator decisions required

- Confirm passkey-only registration is acceptable (no fallback email required on
  first sign-up), or require email as recovery channel.
- Confirm mobile deferred (email/password + bearer) is acceptable for U7.
- Confirm Plexo `passkey-link` endpoint exists or will be built before U7
  coordinator flow is wired.
