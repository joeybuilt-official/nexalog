"use client";

// Phase 11 pass 2 — collapsible region/theme/subtheme tree.
// Single-select: clicking a node sets ?region=&theme=&subtheme= via the parent.

import { ChevronRight, ChevronDown } from "lucide-react";
import { useState } from "react";

interface Subtheme {
  id: string;
  label: string;
  count: number;
}
interface Theme {
  id: string;
  label: string;
  count: number;
  subthemes: Subtheme[];
}
interface Region {
  id: string;
  label: string;
  color: string;
  count: number;
  themes: Theme[];
}

export interface ForestSelection {
  regionId: string | null;
  themeId: string | null;
  subthemeId: string | null;
}

export function ForestTree({
  regions,
  selection,
  onSelect,
}: {
  regions: Region[];
  selection: ForestSelection;
  onSelect: (sel: ForestSelection) => void;
}) {
  const [openRegions, setOpenRegions] = useState<Set<string>>(
    () => new Set(selection.regionId ? [selection.regionId] : [regions[0]?.id].filter(Boolean) as string[])
  );
  const [openThemes, setOpenThemes] = useState<Set<string>>(
    () => new Set(selection.themeId ? [selection.themeId] : [])
  );

  function toggleRegion(id: string) {
    setOpenRegions((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleTheme(id: string) {
    setOpenThemes((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  const allSelected =
    !selection.regionId && !selection.themeId && !selection.subthemeId;

  return (
    <nav className="text-sm">
      <button
        onClick={() => onSelect({ regionId: null, themeId: null, subthemeId: null })}
        className={`flex w-full items-center gap-2 rounded px-2 py-1.5 transition-colors ${
          allSelected
            ? "bg-card text-foreground"
            : "text-muted-foreground hover:bg-card hover:text-foreground"
        }`}
      >
        <span className="h-2 w-2 rounded-full bg-foreground/40" />
        <span className="flex-1 text-left font-medium">All bookmarks</span>
      </button>

      <div className="mt-2 space-y-0.5">
        {regions.map((r) => {
          const regionOpen = openRegions.has(r.id);
          const regionActive =
            selection.regionId === r.id && !selection.themeId && !selection.subthemeId;
          return (
            <div key={r.id}>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => toggleRegion(r.id)}
                  className="rounded p-1 text-muted-foreground hover:text-foreground"
                  aria-label={regionOpen ? "Collapse" : "Expand"}
                >
                  {regionOpen ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                </button>
                <button
                  onClick={() =>
                    onSelect({ regionId: r.id, themeId: null, subthemeId: null })
                  }
                  title={r.label}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left transition-colors ${
                    regionActive
                      ? "bg-card text-foreground"
                      : "text-foreground/80 hover:bg-card hover:text-foreground"
                  }`}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: r.color }}
                  />
                  <span className="min-w-0 flex-1 break-words font-medium leading-snug line-clamp-2">{r.label}</span>
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{r.count}</span>
                </button>
              </div>

              {regionOpen && r.themes.length > 0 && (
                <div className="ml-5 mt-0.5 space-y-0.5 border-l border-border pl-2">
                  {r.themes.map((t) => {
                    const themeOpen = openThemes.has(t.id);
                    const themeActive =
                      selection.themeId === t.id && !selection.subthemeId;
                    return (
                      <div key={t.id}>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => toggleTheme(t.id)}
                            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                            aria-label={themeOpen ? "Collapse" : "Expand"}
                          >
                            {themeOpen ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )}
                          </button>
                          <button
                            onClick={() =>
                              onSelect({
                                regionId: r.id,
                                themeId: t.id,
                                subthemeId: null,
                              })
                            }
                            title={t.label}
                            className={`flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left transition-colors ${
                              themeActive
                                ? "bg-card text-foreground"
                                : "text-muted-foreground hover:bg-card hover:text-foreground"
                            }`}
                          >
                            <span className="min-w-0 flex-1 break-words text-xs leading-snug line-clamp-2">{t.label}</span>
                            <span className="shrink-0 text-[10px] tabular-nums">{t.count}</span>
                          </button>
                        </div>

                        {themeOpen && t.subthemes.length > 0 && (
                          <div className="ml-4 mt-0.5 space-y-0.5">
                            {t.subthemes.map((s) => {
                              const subActive = selection.subthemeId === s.id;
                              return (
                                <button
                                  key={s.id}
                                  onClick={() =>
                                    onSelect({
                                      regionId: r.id,
                                      themeId: t.id,
                                      subthemeId: s.id,
                                    })
                                  }
                                  title={s.label}
                                  className={`flex min-w-0 w-full items-center gap-2 rounded px-2 py-0.5 text-left transition-colors ${
                                    subActive
                                      ? "bg-card text-foreground"
                                      : "text-muted-foreground hover:bg-card hover:text-foreground"
                                  }`}
                                >
                                  <span className="min-w-0 flex-1 break-words text-[11px] leading-snug line-clamp-2">
                                    {s.label}
                                  </span>
                                  <span className="shrink-0 text-[10px] tabular-nums">{s.count}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
