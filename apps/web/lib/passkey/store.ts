// SPDX-License-Identifier: MIT
/**
 * PasskeyStore — persistence layer for WebAuthn credentials.
 *
 * Credentials live in auth.passkey_credentials (same pg connection as
 * better-auth; migration in drizzle/0026_passkey.sql — WRITE ONLY, operator
 * must apply).
 *
 * Uses raw pg queries so we don't need a Drizzle schema for the auth schema
 * (better-auth owns that schema; we just piggyback a table).
 */

import { Pool } from "pg"
import type { PasskeyCredential } from "./types"

export const authPool = new Pool({
  connectionString:
    process.env.AUTH_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "postgresql://placeholder:5432/placeholder",
  max: 5,
  idleTimeoutMillis: 30_000,
  options: "-c search_path=auth",
})

export const PasskeyStore = {
  async getByUserId(userId: string): Promise<PasskeyCredential[]> {
    const res = await authPool.query(
      `SELECT id, user_id, credential_id, public_key, counter,
              device_type, backed_up, transports, created_at
       FROM auth.passkey_credentials WHERE user_id = $1`,
      [userId],
    )
    return res.rows.map(rowToCredential)
  },

  async getByCredentialId(
    credentialId: string,
  ): Promise<PasskeyCredential | null> {
    const res = await authPool.query(
      `SELECT id, user_id, credential_id, public_key, counter,
              device_type, backed_up, transports, created_at
       FROM auth.passkey_credentials WHERE credential_id = $1`,
      [credentialId],
    )
    return res.rows[0] ? rowToCredential(res.rows[0]) : null
  },

  async create(cred: Omit<PasskeyCredential, "id" | "createdAt">): Promise<void> {
    await authPool.query(
      `INSERT INTO auth.passkey_credentials
         (user_id, credential_id, public_key, counter, device_type, backed_up, transports)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        cred.userId,
        cred.credentialId,
        Buffer.from(cred.publicKey),
        cred.counter,
        cred.deviceType,
        cred.backedUp,
        JSON.stringify(cred.transports),
      ],
    )
  },

  async updateCounter(credentialId: string, counter: number): Promise<void> {
    await authPool.query(
      `UPDATE auth.passkey_credentials SET counter = $1 WHERE credential_id = $2`,
      [counter, credentialId],
    )
  },

  async getUserIdByEmail(email: string): Promise<string | null> {
    const res = await authPool.query(
      `SELECT id FROM auth."user" WHERE email = $1 LIMIT 1`,
      [email],
    )
    return res.rows[0]?.id ?? null
  },

  async getUserById(
    id: string,
  ): Promise<{ id: string; email: string; name: string } | null> {
    const res = await authPool.query(
      `SELECT id, email, name FROM auth."user" WHERE id = $1 LIMIT 1`,
      [id],
    )
    return res.rows[0] ?? null
  },
}

function rowToCredential(row: Record<string, unknown>): PasskeyCredential {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    credentialId: row.credential_id as string,
    publicKey: row.public_key as Uint8Array,
    counter: row.counter as number,
    deviceType: row.device_type as string,
    backedUp: row.backed_up as boolean,
    transports: (
      typeof row.transports === "string"
        ? JSON.parse(row.transports)
        : (row.transports as string[])
    ),
    createdAt: row.created_at as Date,
  }
}
