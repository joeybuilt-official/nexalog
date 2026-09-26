// SPDX-License-Identifier: MIT
"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpDown, Check } from "lucide-react";
import type { SortKey, Surface } from "./types";

interface SortMenuProps {
  value: SortKey;
  onChange: (s: SortKey) => void;
  surfaces: Surface[];
  hasQuery: boolean;
}

const ALL_OPTIONS: Array<{ id: SortKey; label: string; surfaces?: Surface[]; queryOnly?: boolean }> = [
  { id: "relevance", label: "Relevance", queryOnly: true },
  { id: "recency", label: "Recently added" },
  {
    id: "last_opened",
    label: "Recently opened",
    surfaces: ["bookmarks", "video", "article", "reference", "social", "homepage"],
  },
  {
    id: "staleness_desc",
    label: "Most stale first",
    surfaces: ["bookmarks", "video", "article", "reference", "social", "homepage"],
  },
  {
    id: "theme_growth",
    label: "Theme growth",
    surfaces: ["bookmarks", "video", "article", "reference", "social", "homepage"],
  },
];

export function SortMenu({ value, onChange, surfaces, hasQuery }: SortMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const options = ALL_OPTIONS.filter((o) => {
    if (o.queryOnly && !hasQuery) return false;
    if (!o.surfaces) return true;
    return surfaces.some((s) => o.surfaces!.includes(s));
  });

  const current = options.find((o) => o.id === value) ?? options[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ArrowUpDown className="h-3 w-3" />
        <span className="text-[10px] uppercase tracking-wide">Sort</span>
        <span className="font-medium text-foreground">{current?.label}</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-52 overflow-hidden rounded-md border border-border bg-popover shadow-lg"
        >
          {options.map((o) => (
            <button
              key={o.id}
              role="menuitem"
              type="button"
              onClick={() => {
                onChange(o.id);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-accent ${
                o.id === value ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              <span>{o.label}</span>
              {o.id === value && <Check className="h-3 w-3" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
