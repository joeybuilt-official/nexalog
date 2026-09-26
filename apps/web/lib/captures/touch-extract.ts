// SPDX-License-Identifier: MIT
/**
 * Tiny client helper for the /api/captures/[id]/touch-extract beacon.
 *
 * Bookmark / watch / reading cards call this from their Open handlers so
 * the v1 enrichment chain (metadata → reader → summary) runs once on
 * first user contact, not just on the cron pass. The endpoint is
 * idempotent — already-extracted rows return a no-op skip.
 *
 * Fire-and-forget by design. Errors are swallowed: this is a beacon, not
 * the user-facing Open action. UI components should not block on it.
 */

export async function touchExtract(captureId: string): Promise<void> {
  if (!captureId) return;
  try {
    await fetch(`/api/captures/${captureId}/touch-extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
    });
  } catch {
    // beacon — never throw into the UI
  }
}
