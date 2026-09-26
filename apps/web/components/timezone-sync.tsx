// SPDX-License-Identifier: MIT
"use client";

import { useEffect } from "react";

const COOKIE = "nexalog_tz";
const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Mount-once side-effect: write the browser's IANA timezone to the
 * `nexalog_tz` cookie so server components can derive "today" in the
 * user's wall-clock. No UI. The cookie is refreshed every mount so a
 * tz change (travel, DST settings) propagates next request.
 */
export function TimezoneSync() {
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!tz) return;
      const existing = document.cookie
        .split("; ")
        .find((c) => c.startsWith(`${COOKIE}=`))
        ?.slice(COOKIE.length + 1);
      if (existing === tz) return;
      document.cookie = `${COOKIE}=${encodeURIComponent(tz)}; max-age=${ONE_YEAR}; path=/; SameSite=Lax`;
    } catch {
      // Older browsers without Intl support — accept the env fallback.
    }
  }, []);
  return null;
}
