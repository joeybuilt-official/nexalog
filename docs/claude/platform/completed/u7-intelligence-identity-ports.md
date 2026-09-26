# U7 Rollout Plan — Intelligence + Identity Ports

## Phase 1: Standalone Deployment (already shipped in this branch)

Deploy Nexalog without any Plexo dependency. All AI routes degrade gracefully.

**Steps:**
1. Apply `drizzle/0026_passkey.sql` to prod DB (operator, auth schema).
2. Set `NEXALOG_AI_PROVIDER_KEY=<anthropic key>` in prod env.
3. Set `NEXT_PUBLIC_RP_ID=<your domain>` and `NEXT_PUBLIC_APP_URL=<your origin>`.
4. Merge `task/u7-intelligence-identity` → main after operator review.
5. Deploy (standard docker compose pull + up).

**Verification:**
- `/api/ai/inline` works → EmbeddedAdapter serving.
- `/api/auth/passkey/register` returns options for logged-in user.
- `/api/auth/passkey/authenticate` returns challenge.
- `tsc --noEmit` + `vitest run` green.

## Phase 2: Plexo Federated Adapter Activation

When Plexo is available (existing `PLEXO_URL` + `PLEXO_SERVICE_KEY` env vars):

**Steps:**
1. PlexoAdapter activates automatically — `resolveIntelligence()` returns PlexoAdapter.
2. Embed and classify are now fully functional (Plexo ONNX, 384-d, classifier).
3. No code change needed. Environment vars drive the switch.

**Verification:**
- `plexoAvailable()` returns true on boot.
- `resolveIntelligence()` instanceof check → PlexoAdapter.

## Phase 3: Plexo Passkey Coordinator (ROLLOUT PLAN ONLY — NO EXECUTION)

**Precondition:** Plexo exposes `POST /api/auth/passkey-link` (D7 from ADR-0016, not yet confirmed with Plexo team).

**When D7 confirmed yes:**
1. Plexo team exposes `POST /api/auth/passkey-link { credentialId, plexoUserId }`.
2. Add coordinator call to `authenticate-verify/route.ts`: after successful passkey auth, if Plexo is available and the user has a Plexo workspace, call `/api/auth/passkey-link` to bind the credential to the Plexo identity.
3. "Same passkey → same identity": subsequent Plexo coordinator calls resolve the Nexalog userId from the credential, returning the same user identity across standalone + federated modes — no migration, credentials remain unchanged.

**Hard stop:** No code for mesh protocol execution, no second app. This plan is documentation only.

## Operator Actions Required Before Shipping U7

| # | Action | Owner |
|---|--------|-------|
| 1 | Apply `drizzle/0026_passkey.sql` to auth schema | Operator |
| 2 | Set `NEXALOG_AI_PROVIDER_KEY` in prod env | Operator |
| 3 | Set `NEXT_PUBLIC_RP_ID` + `NEXT_PUBLIC_APP_URL` | Operator |
| 4 | Review + merge PR for U7 branch | Operator |
| 5 | (Later) Confirm Plexo D7 passkey-link endpoint | Plexo team |

## What Is NOT In This Branch

- Plexo passkey coordinator call (pending D7 confirmation)
- Mesh protocol execution
- Any second app
- Mobile WebAuthn (Flutter email/password stays; passkey is web-only in U7)
