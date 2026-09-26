// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { withMissingColumnFallback, DEFAULT_HISTORY_PREFS } from "@/lib/db/safe-prefs";

describe("withMissingColumnFallback (D5)", () => {
  it("returns the inner result on success", async () => {
    const out = await withMissingColumnFallback(async () => ({ savePageVisits: true }), {
      savePageVisits: false,
    });
    expect(out.savePageVisits).toBe(true);
  });

  it("returns the fallback when the error names a known missing column", async () => {
    const out = await withMissingColumnFallback(async () => {
      throw new Error('column "save_page_visits" of relation "user_preferences" does not exist');
    }, DEFAULT_HISTORY_PREFS);
    expect(out).toBe(DEFAULT_HISTORY_PREFS);
  });

  it("returns the fallback when page_visits table itself is missing", async () => {
    const out = await withMissingColumnFallback(async () => {
      throw new Error('relation "nexalog.page_visits" does not exist');
    }, []);
    expect(out).toEqual([]);
  });

  it("rethrows on an unrelated error", async () => {
    await expect(
      withMissingColumnFallback(async () => {
        throw new Error("connection refused");
      }, DEFAULT_HISTORY_PREFS)
    ).rejects.toThrow("connection refused");
  });

  it("rethrows on a missing-column error for a column we do not own", async () => {
    await expect(
      withMissingColumnFallback(async () => {
        throw new Error('column "stripe_subscription_id" does not exist');
      }, DEFAULT_HISTORY_PREFS)
    ).rejects.toThrow();
  });
});
