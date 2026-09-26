// SPDX-License-Identifier: MIT
//
// User-tz helpers. Every "today" derivation in nexalog should go through
// here, NOT `new Date().toISOString().slice(0, 10)` (= UTC, wrong at the
// day-boundary edges for any user outside UTC).
//
// Resolution order:
//   1. `nexalog_tz` cookie — set on first page load by <TimezoneSync/>
//      from `Intl.DateTimeFormat().resolvedOptions().timeZone`. Lives one
//      year, refreshes on every set.
//   2. `DEFAULT_TIMEZONE` env var — operational override, useful for the
//      operator's single-user prod (set via the DEFAULT_TIMEZONE env var on prod-host).
//   3. `America/New_York` hardcoded fallback — matches the project
//      default everywhere else (mirrors levio + conflicts/route patterns).

import { cookies } from "next/headers";

export const TZ_COOKIE = "nexalog_tz";
const DEFAULT_FALLBACK = "America/New_York";

/** IANA timezone for the current request. Always returns a usable string. */
export async function getUserTimezone(): Promise<string> {
  try {
    const jar = await cookies();
    const fromCookie = jar.get(TZ_COOKIE)?.value;
    if (fromCookie && isValidIana(fromCookie)) return fromCookie;
  } catch {
    // cookies() throws outside request scope; fall through to env.
  }
  const fromEnv = process.env.DEFAULT_TIMEZONE;
  if (fromEnv && isValidIana(fromEnv)) return fromEnv;
  return DEFAULT_FALLBACK;
}

/** Today's date in the user's tz as YYYY-MM-DD. */
export async function userTodayStr(): Promise<string> {
  const tz = await getUserTimezone();
  return todayInTz(tz);
}

/** Same as userTodayStr but for tests / non-async contexts. */
export function todayInTz(tz: string): string {
  // en-CA always renders YYYY-MM-DD.
  return new Date().toLocaleDateString("en-CA", { timeZone: tz });
}

function isValidIana(tz: string): boolean {
  if (!/^[A-Za-z_]+(?:\/[A-Za-z_]+){0,2}$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}
