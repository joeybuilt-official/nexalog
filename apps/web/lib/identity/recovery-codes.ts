// SPDX-License-Identifier: MIT
/**
 * Per-app recovery codes (ADR-0016 B4 fallback 1).
 *
 * Generated once at passkey registration (shown to the user a single time),
 * stored as sha256 hashes, single-use. Redeeming a code proves control of the
 * account when the passkey device is lost; the caller then establishes a
 * session exactly like the passkey verify path.
 */

import { createHash, randomBytes } from "node:crypto"
import { authPool, PasskeyStore } from "@/lib/passkey/store"

const CODE_COUNT = 8

function hash(code: string): string {
  return createHash("sha256").update(code).digest("hex")
}

function newCode(): string {
  // XXXX-XXXX from 5 random bytes — human-typable, 40 bits entropy per code
  const raw = randomBytes(5).toString("hex").toUpperCase()
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`
}

export const RecoveryCodes = {
  /** Generate codes for a user IF they have none yet. Returns plaintext codes
   *  once (never retrievable again), or null when codes already exist. */
  async ensure(userId: string): Promise<string[] | null> {
    const existing = await authPool.query(
      `SELECT 1 FROM auth.recovery_codes WHERE user_id = $1 LIMIT 1`,
      [userId],
    )
    if (existing.rows.length > 0) return null
    const codes = Array.from({ length: CODE_COUNT }, newCode)
    for (const code of codes) {
      await authPool.query(
        `INSERT INTO auth.recovery_codes (user_id, code_hash) VALUES ($1, $2)`,
        [userId, hash(code)],
      )
    }
    return codes
  },

  /** Redeem a code for the account owning `email`. Single-use: marks the code
   *  used atomically. Returns the recognized identity or null. */
  async redeem(
    email: string,
    code: string,
  ): Promise<{ userId: string; email: string; name: string } | null> {
    const userId = await PasskeyStore.getUserIdByEmail(email)
    if (!userId) return null
    const res = await authPool.query(
      `UPDATE auth.recovery_codes SET used_at = now()
       WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL
       RETURNING id`,
      [userId, hash(code.trim().toUpperCase())],
    )
    if (res.rows.length === 0) return null
    const user = await PasskeyStore.getUserById(userId)
    return user ? { userId: user.id, email: user.email, name: user.name } : null
  },
}
