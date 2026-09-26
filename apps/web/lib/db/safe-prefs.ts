// SPDX-License-Identifier: MIT
//
// D5 — pre-deploy guard. The web-history feature ships a new migration
// (drizzle/0010_page_visits.sql) that adds three columns to
// nexalog.user_preferences: save_page_visits, history_denylist,
// history_retention_days. The nexalog prod deploy does NOT auto-run
// drizzle (sibling Plexo confirms same). If the code lands before the
// migration runs, every per-user preference read raises:
//
//   PostgresError: column "save_page_visits" of relation "user_preferences"
//   does not exist
//
// …and the settings page + web-history page + any onboarding flow that
// reads prefs 500s. Wrap the read here so we degrade to defaults instead.

export type HistoryPrefs = {
  savePageVisits: boolean;
  historyDenylist: string[];
  historyRetentionDays: number;
};

export const DEFAULT_HISTORY_PREFS: HistoryPrefs = {
  savePageVisits: false,
  historyDenylist: [],
  historyRetentionDays: 90,
};

// Run an async preference-read; on a "missing column" error fall back to
// safe defaults instead of throwing. Any other error keeps propagating —
// we don't want to hide a real outage.
export async function withMissingColumnFallback<T>(
  fn: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = (err as Error | null)?.message ?? "";
    if (
      msg.includes("does not exist") &&
      (msg.includes("save_page_visits") ||
        msg.includes("history_denylist") ||
        msg.includes("history_retention_days") ||
        msg.includes("page_visits"))
    ) {
      return fallback;
    }
    throw err;
  }
}
