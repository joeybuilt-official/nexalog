// SPDX-License-Identifier: MIT
"use client";

/**
 * Pill row of facet filters. Three families:
 *   - segmented (kind, age) — pick one
 *   - tristate toggle (evergreen, opened, paywalled) — yes / no / any
 *   - chip-list (themeIds, regions) — multi-select
 *
 * Which families render is parameterized by `available`.
 */

import { useCallback } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ContentFinderFilters, AgeRange, Surface } from "./types";

const AGE_OPTIONS: { id: AgeRange; label: string }[] = [
  { id: "all", label: "Any age" },
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
  { id: "1y", label: "1 year" },
];

interface FacetChipsProps {
  /** Current filter state. */
  filters: ContentFinderFilters;
  onChange: (patch: Partial<ContentFinderFilters>) => void;
  /** Which surfaces are in scope for this finder — controls which chips to show. */
  surfaces: Surface[];
  /** Optional theme labels for the chip list (id -> label). */
  themeLabels?: Record<string, string>;
  /** Optional region labels (id -> label). */
  regionLabels?: Record<string, { label: string; color: string }>;
  /** Active region/theme counts from facets, for the chip badges. */
  totalsByRegion?: Record<string, number>;
  /**
   * When true, fold the secondary tristate filters (evergreen / opened /
   * paywall / has-reader) into a "More filters" popover so the bar
   * stays a single short row even on narrow viewports. Used by the
   * Apr-2026 bookmarks redesign.
   */
  compact?: boolean;
}

export function FacetChips({
  filters,
  onChange,
  surfaces,
  themeLabels,
  regionLabels,
  totalsByRegion,
  compact = false,
}: FacetChipsProps) {
  const showEvergreen = surfaces.some((s) => s !== "notes");
  const showOpened = surfaces.some((s) => s !== "notes");
  const showPaywalled = surfaces.some((s) => s === "bookmarks" || s === "article");

  const cycleTri = useCallback(
    (cur: boolean | undefined): boolean | undefined => {
      if (cur === undefined) return true;
      if (cur === true) return false;
      return undefined;
    },
    []
  );
  const triLabel = (v: boolean | undefined) => (v === true ? "yes" : v === false ? "no" : "any");

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Segmented
        label="Age"
        options={AGE_OPTIONS}
        value={filters.ageRange ?? "all"}
        onChange={(id) => onChange({ ageRange: id })}
      />

      {compact ? (
        <MoreFiltersPopover
          showEvergreen={showEvergreen}
          showOpened={showOpened}
          showPaywalled={showPaywalled}
          filters={filters}
          onChange={onChange}
          cycleTri={cycleTri}
          triLabel={triLabel}
        />
      ) : (
        <>
          {showEvergreen && (
            <TriToggle
              label="Evergreen"
              value={filters.evergreen}
              display={triLabel(filters.evergreen)}
              onClick={() => onChange({ evergreen: cycleTri(filters.evergreen) })}
            />
          )}
          {showOpened && (
            <TriToggle
              label="Opened"
              value={filters.opened}
              display={triLabel(filters.opened)}
              onClick={() => onChange({ opened: cycleTri(filters.opened) })}
            />
          )}
          {showPaywalled && (
            <TriToggle
              label="Paywall"
              value={filters.paywalled}
              display={triLabel(filters.paywalled)}
              onClick={() => onChange({ paywalled: cycleTri(filters.paywalled) })}
            />
          )}
        </>
      )}

      {filters.regions && filters.regions.length > 0 && (
        <ChipList
          label="Regions"
          ids={filters.regions}
          labels={Object.fromEntries(
            Object.entries(regionLabels ?? {}).map(([k, v]) => [k, v.label])
          )}
          counts={totalsByRegion}
          onRemove={(id) =>
            onChange({
              regions: (filters.regions ?? []).filter((r) => r !== id),
            })
          }
        />
      )}

      {filters.themeIds && filters.themeIds.length > 0 && (
        <ChipList
          label="Themes"
          ids={filters.themeIds}
          labels={themeLabels ?? {}}
          onRemove={(id) =>
            onChange({
              themeIds: (filters.themeIds ?? []).filter((t) => t !== id),
            })
          }
        />
      )}

      {hasAnyFilter(filters) && (
        <button
          type="button"
          onClick={() =>
            onChange({
              themeIds: undefined,
              regions: undefined,
              ageRange: "all",
              evergreen: undefined,
              opened: undefined,
              paywalled: undefined,
              hasReader: undefined,
            })
          }
          className="ml-auto rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

function hasAnyFilter(f: ContentFinderFilters): boolean {
  return Boolean(
    (f.themeIds && f.themeIds.length) ||
      (f.regions && f.regions.length) ||
      (f.ageRange && f.ageRange !== "all") ||
      f.evergreen !== undefined ||
      f.opened !== undefined ||
      f.paywalled !== undefined ||
      f.hasReader !== undefined
  );
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded border border-border bg-card px-1 py-0.5">
      <span className="px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={`inline-flex min-h-[44px] items-center rounded px-3 py-2 transition-colors ${
            value === o.id
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function TriToggle({
  label,
  value,
  display,
  onClick,
}: {
  label: string;
  value: boolean | undefined;
  display: string;
  onClick: () => void;
}) {
  const active = value !== undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded border px-2 py-1 text-[11px] transition-colors ${
        active
          ? "border-foreground/40 bg-foreground/10 text-foreground"
          : "border-border bg-card text-muted-foreground hover:text-foreground"
      }`}
    >
      <span className="mr-1 text-[10px] uppercase tracking-wide">{label}</span>
      <span className="font-medium">{display}</span>
    </button>
  );
}

/**
 * "More filters" popover — used by the bookmarks redesign to keep the
 * filter bar a single short row. Houses the secondary tristate toggles
 * (evergreen / opened / paywall) so they don't crowd the segmented age
 * picker.
 */
function MoreFiltersPopover({
  showEvergreen,
  showOpened,
  showPaywalled,
  filters,
  onChange,
  cycleTri,
  triLabel,
}: {
  showEvergreen: boolean;
  showOpened: boolean;
  showPaywalled: boolean;
  filters: ContentFinderFilters;
  onChange: (patch: Partial<ContentFinderFilters>) => void;
  cycleTri: (cur: boolean | undefined) => boolean | undefined;
  triLabel: (v: boolean | undefined) => string;
}) {
  const activeCount =
    (filters.evergreen !== undefined ? 1 : 0) +
    (filters.opened !== undefined ? 1 : 0) +
    (filters.paywalled !== undefined ? 1 : 0);

  if (!showEvergreen && !showOpened && !showPaywalled) return null;

  return (
    <Popover>
      <PopoverTrigger
        className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] transition-colors ${
          activeCount > 0
            ? "border-foreground/40 bg-foreground/10 text-foreground"
            : "border-border bg-card text-muted-foreground hover:text-foreground"
        }`}
      >
        <SlidersHorizontal className="h-3 w-3" aria-hidden />
        <span>More filters</span>
        {activeCount > 0 && (
          <span className="rounded bg-foreground/20 px-1 text-[10px] font-medium tabular-nums">
            {activeCount}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-64" align="start">
        <div className="flex flex-col gap-2">
          {showEvergreen && (
            <TriToggle
              label="Evergreen"
              value={filters.evergreen}
              display={triLabel(filters.evergreen)}
              onClick={() => onChange({ evergreen: cycleTri(filters.evergreen) })}
            />
          )}
          {showOpened && (
            <TriToggle
              label="Opened"
              value={filters.opened}
              display={triLabel(filters.opened)}
              onClick={() => onChange({ opened: cycleTri(filters.opened) })}
            />
          )}
          {showPaywalled && (
            <TriToggle
              label="Paywall"
              value={filters.paywalled}
              display={triLabel(filters.paywalled)}
              onClick={() => onChange({ paywalled: cycleTri(filters.paywalled) })}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ChipList({
  label,
  ids,
  labels,
  counts,
  onRemove,
}: {
  label: string;
  ids: string[];
  labels: Record<string, string>;
  counts?: Record<string, number>;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded border border-border bg-card px-1 py-0.5">
      <span className="px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onRemove(id)}
          className="group rounded bg-foreground/10 px-2 py-0.5 text-foreground hover:bg-foreground/20"
          aria-label={`Remove ${labels[id] ?? id}`}
        >
          <span className="mr-1">{labels[id] ?? id}</span>
          {counts?.[id] != null && (
            <span className="text-[10px] text-muted-foreground">{counts[id]}</span>
          )}
          <span className="ml-1 text-[10px] text-muted-foreground group-hover:text-foreground">
            ×
          </span>
        </button>
      ))}
    </div>
  );
}
