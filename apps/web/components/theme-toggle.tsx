// SPDX-License-Identifier: MIT
'use client';

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Sun, Moon } from "lucide-react";

/**
 * ThemeToggle — light/dark/system cycle via next-themes (Knowledge Garden).
 *
 * Hydration-safe: `next-themes` only knows the resolved theme on the client, so
 * the server render and the first client paint must agree on the placeholder.
 * That used to be a `useState` + `useEffect(() => setMounted(true))` flag, which
 * the React Compiler flags as a cascading-render anti-pattern ("Calling setState
 * synchronously within an effect") — it was the one error keeping `pnpm lint`
 * red. `useSyncExternalStore` expresses the same "mounted yet?" question in one
 * render-safe call: the server snapshot returns `false` (placeholder), the
 * client snapshot returns `true` (real button), and hydration reconciles without
 * a second render pass. Same pattern as `components/bookmarks/density.ts`.
 */
const emptySubscribe = () => () => {};

function useIsMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useIsMounted();

  if (!mounted) {
    return <div className="h-9 w-9" aria-hidden />;
  }

  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      aria-label="Toggle theme"
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-foreground hover:bg-muted"
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
