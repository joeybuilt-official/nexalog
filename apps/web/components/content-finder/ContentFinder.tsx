// SPDX-License-Identifier: MIT
"use client";

/**
 * One AI-assisted search/filter/sort component for every list surface in
 * Nexalog. Parameterized via `surfaces`. Renders:
 *   - Cmd-K-style SearchInput
 *   - SuggestionRail (synthesis-violet, AI-spoken affordances)
 *   - FacetChips (kind-aware, surface-aware)
 *   - SortMenu
 *   - ResultGrid (default: CaptureCard / NoteRow; override via render prop)
 *
 * URL-state owned by useContentFinder. Shareable. Browser back/forward
 * works.
 *
 * Mobile: search + filter chips collapse into a sheet via the `mobileSheet`
 * prop hook. Sort moves into a kebab. Default render is sane responsive.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SearchInput } from "./SearchInput";
import { FacetChips } from "./FacetChips";
import { SortMenu } from "./SortMenu";
import { SuggestionRail } from "./SuggestionRail";
import { ResultGrid, type GroupByField } from "./ResultGrid";
import { ResultTable, ResultBoard, ResultCalendar } from "./lenses";
import { ViewSwitcher } from "./ViewSwitcher";
import { EmptyState, ErrorState, LoadingShimmer } from "./states";
import { useContentFinder } from "./useContentFinder";
import type {
  ContentFinderFilters,
  SearchResult,
  SearchSuggestion,
  SortKey,
  Surface,
  ViewMode,
} from "./types";

interface ContentFinderProps {
  /** Which surfaces participate. Pre-set per host page. */
  surfaces: Surface[];
  /** Heading shown above the finder. */
  title?: string;
  /** Subtitle / hint shown under the title. */
  subtitle?: string;
  /** Default sort. Defaults to `recency` (or `relevance` once a query is typed). */
  defaultSort?: SortKey;
  /** Default filter seed (e.g. `evergreen=true` for a curated surface). */
  defaultFilters?: ContentFinderFilters;
  /**
   * Filters injected from a host context (e.g. region/theme picked in a
   * sidebar). Merged with the user's filter state on every request.
   */
  seedFilters?: ContentFinderFilters;
  /** Placeholder text in the search input. */
  placeholder?: string;
  /** Empty-state copy when no results match. */
  emptyMessage?: string;
  /** Hint shown when results are empty. */
  emptyHint?: string;
  /** Override card layout for a specific surface. */
  renderItem?: (r: SearchResult) => React.ReactNode;
  /** "grid" (default) or "list". */
  layout?: "grid" | "list";
  /**
   * Estimated row height (px) for virtualization. Required when the
   * host overrides `renderItem` with a card whose height differs
   * substantially from the default capture card (~180px).
   */
  estimatedRowHeight?: number;
  /**
   * Responsive column counts for grid layout. Defaults to a 2-col grid
   * across breakpoints (the legacy ContentFinder shape). Hosts using
   * a custom card grammar should pass their own.
   */
  columnsByBreakpoint?: { sm: number; md: number; lg: number; xl: number };
  /** Slot rendered above the result grid (e.g. a density toggle). */
  toolbarRight?: React.ReactNode;
  /** Page size. */
  limit?: number;
  /** Optional theme labels for chip rendering (id -> label). */
  themeLabels?: Record<string, string>;
  /** Optional region labels (id -> { label, color }). */
  regionLabels?: Record<string, { label: string; color: string }>;
  /** Slot rendered above the search input (e.g. a primary action). */
  headerRight?: React.ReactNode;
  /** Read/write filter state from the URL. */
  syncToUrl?: boolean;
  /**
   * When true, fold the secondary tristate filters (evergreen / opened /
   * paywall) into a single "More filters" popover. Used by the
   * Apr-2026 bookmarks redesign to keep the filter row a single
   * compact line.
   */
  compactFilters?: boolean;
  /**
   * Offer the table/board/calendar lenses via a view switcher in the
   * toolbar. Defaults to true. The grid remains the default lens.
   */
  enableViews?: boolean;
  /** Initial lens when `enableViews` is on. Defaults to "grid". */
  defaultView?: ViewMode;
}

export function ContentFinder({
  surfaces,
  title,
  subtitle,
  defaultSort,
  defaultFilters,
  seedFilters,
  placeholder,
  emptyMessage = "Nothing matches.",
  emptyHint,
  renderItem,
  layout,
  estimatedRowHeight,
  columnsByBreakpoint,
  toolbarRight,
  limit,
  themeLabels,
  regionLabels,
  headerRight,
  syncToUrl,
  compactFilters,
  enableViews = true,
  defaultView = "grid",
}: ContentFinderProps) {
  const [view, setView] = useState<ViewMode>(defaultView);
  const finder = useContentFinder({
    surfaces,
    defaultSort,
    defaultFilters,
    seedFilters,
    limit,
    syncToUrl,
  });

  const handleSuggestion = useCallback(
    (s: SearchSuggestion) => {
      switch (s.action) {
        case "addFilter":
          finder.patchFilters(s.payload as Partial<ContentFinderFilters>);
          break;
        case "replaceQuery":
          finder.setQuery(String(s.payload.query ?? ""));
          break;
        case "changeSort":
          finder.setSort(String(s.payload.sort ?? "relevance") as SortKey);
          break;
      }
    },
    [finder]
  );

  const total = finder.data?.total ?? 0;
  const totalsByRegion = finder.data?.facets.totalsByRegion;
  const suggestions = finder.data?.suggestions ?? [];
  const rankingMode = finder.data?.rankingMode;

  // Photos-style date grouping is only meaningful when results are
  // ordered along a date axis. Map the active sort to the field the
  // grid should segment by; relevance / theme-growth get no grouping.
  const groupBy: GroupByField | null = useMemo(() => {
    switch (finder.sort) {
      case "recency":
        return "createdAt";
      case "last_opened":
      case "staleness_desc":
        return "openedAt";
      default:
        return null;
    }
  }, [finder.sort]);

  // Measure the sticky chrome so the floating date pill sticks just
  // below it (its height changes as facet chips wrap).
  const chromeRef = useRef<HTMLDivElement>(null);
  const [chromeHeight, setChromeHeight] = useState(0);
  useEffect(() => {
    const el = chromeRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setChromeHeight(el.offsetHeight));
    ro.observe(el);
    setChromeHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

  const headline = useMemo(() => {
    if (finder.loading && !finder.data) return null;
    if (!finder.query) return `${total} item${total === 1 ? "" : "s"}`;
    if (rankingMode === "hybrid") return `${total} matches · semantic + lexical`;
    if (rankingMode === "lexical") return `${total} matches · lexical`;
    return `${total} matches`;
  }, [finder.loading, finder.data, finder.query, rankingMode, total]);

  return (
    <div className="flex flex-col gap-4">
      {(title || subtitle || headerRight) && (
        <div className="flex items-start justify-between gap-3">
          <div>
            {title && (
              <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
            )}
            {subtitle && (
              <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          {headerRight && <div className="shrink-0">{headerRight}</div>}
        </div>
      )}

      {/*
        Sticky filter chrome. The host page rides the AppShell's
        document scroll (no inner overflow viewports). This block
        pins the search input, sort, AI rail, and facet chips to
        the top of the visible scroll area while the result grid
        flows underneath. `bg-background` on a `-mx`/`px` pad
        prevents content from showing through during scroll.
      */}
      <div
        ref={chromeRef}
        className="sticky top-0 z-20 -mx-4 flex flex-col gap-3 bg-background/95 px-4 pt-1 pb-3 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80 md:-mx-6 md:px-6"
      >
        {/* Search row */}
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="flex-1">
            <SearchInput
              value={finder.query}
              onChange={finder.setQuery}
              loading={finder.loading}
              placeholder={placeholder}
            />
          </div>
          <SortMenu
            value={finder.sort}
            onChange={finder.setSort}
            surfaces={surfaces}
            hasQuery={Boolean(finder.query)}
          />
        </div>

        {/* AI rail */}
        <SuggestionRail suggestions={suggestions} onApply={handleSuggestion} />

        {/* Facet chips */}
        <FacetChips
          filters={finder.filters}
          onChange={finder.patchFilters}
          surfaces={surfaces}
          themeLabels={themeLabels}
          regionLabels={regionLabels}
          totalsByRegion={totalsByRegion}
          compact={compactFilters}
        />

        {/* Headline (item count + updating indicator + toolbar slot) */}
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">{headline}</span>
          <div className="flex items-center gap-2">
            {finder.loading && finder.data && <span>Updating…</span>}
            {toolbarRight}
            {enableViews && <ViewSwitcher value={view} onChange={setView} />}
          </div>
        </div>
      </div>

      {/* Body */}
      {finder.error ? (
        <ErrorState message={finder.error} onRetry={finder.refetch} />
      ) : finder.loading && !finder.data ? (
        <LoadingShimmer />
      ) : !finder.data || finder.data.results.length === 0 ? (
        <EmptyState title={emptyMessage} hint={emptyHint} />
      ) : enableViews && view === "table" ? (
        <ResultTable results={finder.data.results} />
      ) : enableViews && view === "board" ? (
        <ResultBoard results={finder.data.results} />
      ) : enableViews && view === "calendar" ? (
        <ResultCalendar results={finder.data.results} />
      ) : (
        <ResultGrid
          results={finder.data.results}
          layout={layout}
          renderItem={renderItem}
          estimatedRowHeight={estimatedRowHeight}
          columnsByBreakpoint={columnsByBreakpoint}
          groupBy={groupBy}
          stickyTopOffset={chromeHeight}
        />
      )}
    </div>
  );
}
