// SPDX-License-Identifier: MIT
"use client";

/**
 * Density mode for the bookmarks list. Three named variants, persisted
 * to `localStorage["nexalog:bookmarks:density"]`. Default = "standard".
 *
 * Each variant declares its own row-height estimate (used by
 * `useWindowVirtualizer` to reserve scroll space) and responsive column
 * counts. Centralized here so the bookmarks client and the renderer
 * agree on layout math.
 */

import { useCallback, useSyncExternalStore } from "react";

export type BookmarkDensity = "compact" | "standard" | "rich";

const STORAGE_KEY = "nexalog:bookmarks:density";
const DEFAULT_DENSITY: BookmarkDensity = "standard";

export interface DensitySpec {
  /** Estimated rendered height of one card row (px). */
  rowHeight: number;
  /** Responsive grid column counts. */
  columns: { sm: number; md: number; lg: number; xl: number };
  /** Layout — "list" for compact, "grid" otherwise. */
  layout: "grid" | "list";
}

export const DENSITY_SPEC: Record<BookmarkDensity, DensitySpec> = {
  compact: {
    rowHeight: 56,
    columns: { sm: 1, md: 1, lg: 1, xl: 1 },
    layout: "list",
  },
  standard: {
    rowHeight: 156,
    columns: { sm: 1, md: 2, lg: 3, xl: 4 },
    layout: "grid",
  },
  rich: {
    rowHeight: 340,
    columns: { sm: 1, md: 1, lg: 2, xl: 3 },
    layout: "grid",
  },
};

function isDensity(v: string | null): v is BookmarkDensity {
  return v === "compact" || v === "standard" || v === "rich";
}

/**
 * Reads density preference from localStorage and subscribes to its
 * changes. Server-side and the first client paint use
 * `DEFAULT_DENSITY`; the real value swaps in after hydration via
 * `useSyncExternalStore` (no setState-in-effect, which the React
 * Compiler flags as a cascading-render anti-pattern).
 */
function readDensity(): BookmarkDensity {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isDensity(saved)) return saved;
  } catch {
    /* storage may be unavailable */
  }
  return DEFAULT_DENSITY;
}

function subscribeDensity(callback: () => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) callback();
  };
  window.addEventListener("storage", handler);
  window.addEventListener("nexalog:density-change", callback as EventListener);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener("nexalog:density-change", callback as EventListener);
  };
}

export function useBookmarkDensity(): [BookmarkDensity, (d: BookmarkDensity) => void] {
  const density = useSyncExternalStore(
    subscribeDensity,
    readDensity,
    () => DEFAULT_DENSITY
  );

  const setDensity = useCallback((d: BookmarkDensity) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, d);
      // localStorage's "storage" event fires only on cross-tab writes;
      // dispatch our own event so same-tab subscribers re-read.
      window.dispatchEvent(new Event("nexalog:density-change"));
    } catch {
      /* ignore */
    }
  }, []);

  return [density, setDensity];
}
