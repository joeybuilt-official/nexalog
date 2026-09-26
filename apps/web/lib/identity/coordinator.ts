// SPDX-License-Identifier: MIT
/**
 * IdentityCoordinator port (ADR-0016 B3) — Plexo as identity COORDINATOR,
 * never root, never hard dependency.
 *
 * When Plexo is present + authorized it holds the canonical profile, records
 * cross-app authorizations mesh-wide, and assists recovery. When absent, the
 * NullCoordinator no-ops and the app is fully functional standalone — the
 * identity anchor (the user's passkey in the shared auth schema) exists and
 * works without any coordinator.
 *
 * Jex contract (Plexo-side endpoints, NOT yet implemented in Plexo as of
 * 2026-07-02 — verified by repo grep; PlexoCoordinator degrades to no-op on
 * any failure so nexalog never depends on them):
 *   POST {PLEXO_URL}/api/jex/identity/recognition
 *     { appId, userId, email, credentialId } → 2xx
 *   GET  {PLEXO_URL}/api/jex/identity/profile/{userId} → { userId, email, name, apps: string[] }
 */

const APP_ID = "nexalog"

export interface RecognitionEvent {
  userId: string
  email: string
  credentialId: string
}

export interface CanonicalProfile {
  userId: string
  email: string
  name: string
  apps: string[]
}

export interface IdentityCoordinator {
  /** Record that this app recognized an existing mesh identity (fire-and-forget). */
  recordRecognition(ev: RecognitionEvent): Promise<void>
  /** Fetch the mesh-wide canonical profile, or null when unavailable. */
  getCanonicalProfile(userId: string): Promise<CanonicalProfile | null>
}

export const NullCoordinator: IdentityCoordinator = {
  async recordRecognition() {},
  async getCanonicalProfile() {
    return null
  },
}

export class PlexoCoordinator implements IdentityCoordinator {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceKey: string,
  ) {}

  async recordRecognition(ev: RecognitionEvent): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/jex/identity/recognition`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.serviceKey}`,
        },
        body: JSON.stringify({ appId: APP_ID, ...ev }),
        signal: AbortSignal.timeout(3_000),
      })
    } catch {
      // Coordinator is enrichment, never a dependency — swallow.
    }
  }

  async getCanonicalProfile(userId: string): Promise<CanonicalProfile | null> {
    try {
      const res = await fetch(
        `${this.baseUrl}/api/jex/identity/profile/${encodeURIComponent(userId)}`,
        {
          headers: { Authorization: `Bearer ${this.serviceKey}` },
          signal: AbortSignal.timeout(3_000),
        },
      )
      if (!res.ok) return null
      return (await res.json()) as CanonicalProfile
    } catch {
      return null
    }
  }
}

export function resolveCoordinator(): IdentityCoordinator {
  const url = process.env.PLEXO_URL
  const key = process.env.PLEXO_SERVICE_KEY
  if (url && key) return new PlexoCoordinator(url, key)
  return NullCoordinator
}
