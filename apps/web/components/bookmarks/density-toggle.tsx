// SPDX-License-Identifier: MIT
"use client";

/**
 * Three-button segmented control for bookmark density. Persists
 * via `useBookmarkDensity`. Lives in the ContentFinder toolbar slot
 * so it sits next to the result count.
 */

import { Rows3, LayoutGrid, Image as ImageIcon } from "lucide-react";
import type { BookmarkDensity } from "./density";

const OPTIONS: Array<{
  id: BookmarkDensity;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "compact", label: "Compact", icon: Rows3 },
  { id: "standard", label: "Standard", icon: LayoutGrid },
  { id: "rich", label: "Rich", icon: ImageIcon },
];

export function DensityToggle({
  value,
  onChange,
}: {
  value: BookmarkDensity;
  onChange: (d: BookmarkDensity) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Card density"
      className="flex items-center rounded-md border border-border bg-card p-0.5"
    >
      {OPTIONS.map((o) => {
        const Icon = o.icon;
        const active = value === o.id;
        return (
          <button
            key={o.id}
            role="radio"
            aria-checked={active}
            type="button"
            title={o.label}
            onClick={() => onChange(o.id)}
            className={`inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] transition-colors ${
              active
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-3 w-3" aria-hidden />
            <span className="hidden sm:inline">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
