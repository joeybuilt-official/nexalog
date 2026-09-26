/**
 * CaptureStatus — the lifecycle of an inbox item.
 *
 *   inbox      → just captured, waiting for Hermes
 *   processing → claimed by a Hermes instance (the commit is the lock)
 *   review     → Hermes was unsure; a proposal awaits the operator
 *   processed  → Hermes wrote pages; original kept 30 days (see D6)
 *   rejected   → operator rejected the proposal
 *
 * The transition `inbox → processing` is the claim; it must be atomic (commit
 * as the lock) and carries `claimed_by` + `claimed_at`.
 */

export const CAPTURE_STATUSES = [
  "inbox",
  "processing",
  "review",
  "processed",
  "rejected",
] as const;

export type CaptureStatus = (typeof CAPTURE_STATUSES)[number];

export function isCaptureStatus(v: unknown): v is CaptureStatus {
  return (
    typeof v === "string" && (CAPTURE_STATUSES as readonly string[]).includes(v)
  );
}

/**
 * CaptureKind — how the item arrived. Drives the icon and, for Hermes, the
 * processing path (audio → transcribe, link → fetch+readability, etc.).
 */
export const CAPTURE_KINDS = ["note", "link", "file", "audio", "image", "doc"] as const;
export type CaptureKind = (typeof CAPTURE_KINDS)[number];

export function isCaptureKind(v: unknown): v is CaptureKind {
  return typeof v === "string" && (CAPTURE_KINDS as readonly string[]).includes(v);
}

/**
 * CaptureSource — the entry channel. Distinct from `kind`: a voice memo and a
 * shared URL can both arrive via `pwa-share`.
 */
export const CAPTURE_SOURCES = [
  "pwa-share",
  "web",
  "bookmarklet",
  "mcp",
  "telegram",
] as const;
export type CaptureSource = (typeof CAPTURE_SOURCES)[number];

export function isCaptureSource(v: unknown): v is CaptureSource {
  return typeof v === "string" && (CAPTURE_SOURCES as readonly string[]).includes(v);
}
