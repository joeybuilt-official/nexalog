-- WRITE ONLY — DO NOT APPLY AUTOMATICALLY.
-- Operator must review and apply to the auth schema manually.
-- Run: psql $DATABASE_URL -f drizzle/0027_identity_fallbacks.sql
--
-- ADR-0016 B4 fallback (1): per-app recovery codes.  Generated at passkey
-- registration, hashed at rest, single-use.  Redeemed via
-- POST /api/auth/recovery/redeem when the user loses their device.
-- Fallbacks (2) portable keypair and (3) pre-anchor link need no new table:
-- keypair anchors are rows in auth.passkey_credentials with
-- device_type = 'portable-keypair'; pre-anchor linking reuses the existing
-- session-authenticated registration flow.

CREATE TABLE IF NOT EXISTS auth.recovery_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT NOT NULL REFERENCES auth."user"(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL UNIQUE,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recovery_codes_user_idx
  ON auth.recovery_codes (user_id);
