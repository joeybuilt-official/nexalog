-- WRITE ONLY — DO NOT APPLY AUTOMATICALLY.
-- Operator must review and apply to the auth schema manually.
-- Run: psql $DATABASE_URL -f drizzle/0026_passkey.sql
--
-- Creates the passkey_credentials table in the auth schema.
-- better-auth 1.6.9 does not ship a passkey plugin, so credentials
-- are managed by Nexalog's custom WebAuthn routes (lib/passkey/,
-- app/api/auth/passkey/*).  See ADR-0016.

CREATE TABLE IF NOT EXISTS auth.passkey_credentials (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL REFERENCES auth."user"(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key   BYTEA NOT NULL,
  counter      BIGINT NOT NULL DEFAULT 0,
  device_type  TEXT NOT NULL DEFAULT 'singleDevice',
  backed_up    BOOLEAN NOT NULL DEFAULT false,
  transports   JSONB NOT NULL DEFAULT '[]',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS passkey_credentials_user_idx
  ON auth.passkey_credentials (user_id);
