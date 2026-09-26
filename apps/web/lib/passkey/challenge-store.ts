// SPDX-License-Identifier: MIT
/**
 * In-process challenge cache (TTL 5m).
 * Production should use Redis or DB — this is correct for the single-process
 * Next.js server; replace with a distributed store when horizontally scaling.
 */

const _challenges = new Map<string, { challenge: string; expiresAt: number }>()
const TTL_MS = 5 * 60 * 1000

function gc(): void {
  const now = Date.now()
  for (const [k, v] of _challenges) {
    if (now > v.expiresAt) _challenges.delete(k)
  }
}

export const ChallengeStore = {
  set(key: string, challenge: string): void {
    gc()
    _challenges.set(key, { challenge, expiresAt: Date.now() + TTL_MS })
  },
  get(key: string): string | null {
    gc()
    const v = _challenges.get(key)
    if (!v || Date.now() > v.expiresAt) return null
    return v.challenge
  },
  delete(key: string): void {
    _challenges.delete(key)
  },
}
