// SPDX-License-Identifier: MIT
"use client";

/**
 * Segmented control to switch the ContentFinder result lens between the
 * card grid and the database-style table / board / calendar views. All
 * lenses render the same `/api/search` result set — see lenses.tsx.
 */

import { LayoutGrid, Table2, Columns3, CalendarDays } from "lucide-react";
import type { ViewMode } from "./types";

const VIEWS: Array<{ key: ViewMode; label: string; Icon: typeof LayoutGrid }> = [
  { key: "grid", label: "Grid", Icon: LayoutGrid },
  { key: "table", label: "Table", Icon: Table2 },
  { key: "board", label: "Board", Icon: Columns3 },
  { key: "calendar", label: "Calendar", Icon: CalendarDays },
];

export function ViewSwitcher({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Result view"
      className="inline-flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5"
    >
      {VIEWS.map(({ key, label, Icon }) => {
        const active = value === key;
        return (
          <button
            key={key}
            role="tab"
            aria-selected={active}
            title={label}
            onClick={() => onChange(key)}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
              active
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
