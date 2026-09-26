// SPDX-License-Identifier: MIT
"use client";

/**
 * Renders the result list. Hosts a default renderer that bridges to the
 * existing card grammar: `CaptureCard` for url-kind rows, a notes row for
 * `kind === "note"`. Override via `renderItem` from the host page when
 * a surface-specific layout is needed.
 *
 * Virtualization (Apr 2026 redesign): always uses
 * `useWindowVirtualizer` so the result list rides the document scroll
 * (the AppShell's <main> overflow-y-auto). No more nested scroll
 * viewports — the host page is sticky on top, list flows below.
 *
 * Below VIRTUALIZE_THRESHOLD (200) the virtualizer is skipped — no
 * point in measuring 50 nodes when the layout cost is fixed.
 *
 * Date grouping (Jun 2026): when `groupBy` is set the list is segmented
 * into Photos-style per-day sections. The server already returns rows in
 * the active sort order, so groups are formed by scanning *consecutive*
 * rows sharing a calendar day — this keeps grouping sort-aware without a
 * client re-sort. Inline day headers separate sections; a floating pill
 * (sticky below the host chrome) tracks the current section while
 * scrolling.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { CaptureCard, type CaptureCardData } from "@/components/bookmarks/capture-card";
import type { SearchResult } from "./types";

/** Which date field to segment by — must mirror the active sort. */
export type GroupByField = "createdAt" | "openedAt";

interface ResultGridProps {
  results: SearchResult[];
  layout?: "grid" | "list";
  renderItem?: (r: SearchResult) => React.ReactNode;
  estimatedRowHeight?: number;
  columnsByBreakpoint?: { sm: number; md: number; lg: number; xl: number };
  /**
   * When set, rows are grouped into Photos-style per-day sections keyed
   * off this date field. Pass the field that matches the active sort
   * (recency→createdAt, last_opened/staleness→openedAt). Omit for
   * relevance / theme-growth orderings where a date axis is meaningless.
   */
  groupBy?: GroupByField | null;
  /**
   * Px offset for the floating date pill so it sticks *below* the host's
   * own sticky chrome (search/sort/facets) instead of behind it.
   */
  stickyTopOffset?: number;
}

const VIRTUALIZE_THRESHOLD = 200;
const ESTIMATED_ROW_HEIGHT = 180; // grid card height ballpark
const ESTIMATED_LIST_ROW_HEIGHT = 76;
const HEADER_ROW_HEIGHT = 40;

const DEFAULT_COLUMNS = { sm: 1, md: 2, lg: 2, xl: 2 };

interface DateGroup {
  key: string;
  label: string;
  items: SearchResult[];
}

function dateValue(r: SearchResult, field: GroupByField): string | null {
  return field === "openedAt" ? r.openedAt : r.createdAt;
}

function formatDayLabel(d: Date): string {
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(
    undefined,
    sameYear
      ? { weekday: "long", month: "long", day: "numeric" }
      : { year: "numeric", month: "long", day: "numeric" }
  );
}

/**
 * Segment already-sorted results into consecutive per-day groups. Does
 * NOT re-sort — relies on the server ordering matching `field`.
 */
function buildDateGroups(results: SearchResult[], field: GroupByField): DateGroup[] {
  const groups: DateGroup[] = [];
  for (const r of results) {
    const v = dateValue(r, field);
    let key: string;
    let label: string;
    if (!v) {
      key = "__none__";
      label = field === "openedAt" ? "Never opened" : "No date";
    } else {
      const d = new Date(v);
      key = d.toDateString();
      label = formatDayLabel(d);
    }
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(r);
    else groups.push({ key, label, items: [r] });
  }
  return groups;
}

function renderResult(r: SearchResult, renderItem?: (r: SearchResult) => React.ReactNode) {
  if (renderItem) return <div key={`${r.kind}:${r.id}`}>{renderItem(r)}</div>;
  return r.kind === "note" ? (
    <NoteRow key={`note:${r.id}`} row={r} />
  ) : (
    <CaptureCard
      key={`url:${r.id}`}
      row={searchResultToCaptureCardData(r)}
      reason={r.themeLabel ? `Theme: ${r.themeLabel}` : undefined}
    />
  );
}

export function ResultGrid({
  results,
  layout = "grid",
  renderItem,
  estimatedRowHeight,
  columnsByBreakpoint,
  groupBy,
  stickyTopOffset = 0,
}: ResultGridProps) {
  const cols = columnsByBreakpoint ?? DEFAULT_COLUMNS;

  if (results.length > VIRTUALIZE_THRESHOLD) {
    return (
      <VirtualizedGrid
        results={results}
        layout={layout}
        renderItem={renderItem}
        estimatedRowHeight={estimatedRowHeight}
        columnsByBreakpoint={cols}
        groupBy={groupBy}
        stickyTopOffset={stickyTopOffset}
      />
    );
  }

  // Small-list path — no virtualizer.
  if (groupBy) {
    const groups = buildDateGroups(results, groupBy);
    return (
      <div className="flex flex-col gap-1">
        {groups.map((g) => (
          <section key={g.key}>
            <DateHeader
              label={g.label}
              count={g.items.length}
              sticky
              stickyTopOffset={stickyTopOffset}
            />
            <div className={containerCls(layout, cols)}>
              {g.items.map((r) => renderResult(r, renderItem))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className={containerCls(layout, cols)}>
      {results.map((r) => renderResult(r, renderItem))}
    </div>
  );
}

/**
 * Watches the viewport width and returns the column count for the
 * current breakpoint, matching Tailwind's defaults
 * (sm 640, md 768, lg 1024, xl 1280).
 */
function useResponsiveColumns(cols: { sm: number; md: number; lg: number; xl: number }) {
  const [columns, setColumns] = useState<number>(cols.lg);
  useEffect(() => {
    function compute() {
      const w = window.innerWidth;
      if (w >= 1280) setColumns(cols.xl);
      else if (w >= 1024) setColumns(cols.lg);
      else if (w >= 768) setColumns(cols.md);
      else setColumns(cols.sm);
    }
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [cols.sm, cols.md, cols.lg, cols.xl]);
  return columns;
}

type VirtualRow =
  | { type: "header"; key: string; label: string; count: number }
  | { type: "items"; key: string; items: SearchResult[] };

function VirtualizedGrid({
  results,
  layout,
  renderItem,
  estimatedRowHeight,
  columnsByBreakpoint,
  groupBy,
  stickyTopOffset = 0,
}: ResultGridProps & { columnsByBreakpoint: { sm: number; md: number; lg: number; xl: number } }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const isList = layout === "list";
  const columns = useResponsiveColumns(columnsByBreakpoint);
  const effectiveColumns = isList ? 1 : columns;
  const estimateRow =
    estimatedRowHeight ?? (isList ? ESTIMATED_LIST_ROW_HEIGHT : ESTIMATED_ROW_HEIGHT);

  // Flatten into a render-row list. When grouping, each group emits a
  // header row followed by chunked item rows. Recomputed when the
  // column count changes (chunk width depends on it).
  const rows = useMemo<VirtualRow[]>(() => {
    if (!groupBy) {
      const out: VirtualRow[] = [];
      for (let i = 0; i < results.length; i += effectiveColumns) {
        out.push({
          type: "items",
          key: `r:${i}`,
          items: results.slice(i, i + effectiveColumns),
        });
      }
      return out;
    }
    const out: VirtualRow[] = [];
    for (const g of buildDateGroups(results, groupBy)) {
      out.push({ type: "header", key: `h:${g.key}`, label: g.label, count: g.items.length });
      for (let i = 0; i < g.items.length; i += effectiveColumns) {
        out.push({
          type: "items",
          key: `${g.key}:${i}`,
          items: g.items.slice(i, i + effectiveColumns),
        });
      }
    }
    return out;
  }, [results, groupBy, effectiveColumns]);

  const [scrollMargin, setScrollMargin] = useState(0);
  useEffect(() => {
    function measure() {
      if (parentRef.current) setScrollMargin(parentRef.current.offsetTop);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: (index) => (rows[index]?.type === "header" ? HEADER_ROW_HEIGHT : estimateRow),
    overscan: 6,
    scrollMargin,
  });

  const virtualItems = virtualizer.getVirtualItems();

  // Floating-pill label: the header at or before the first visible row.
  const activeLabel = useMemo(() => {
    if (!groupBy || virtualItems.length === 0) return null;
    const firstVisible = virtualItems[0].index;
    for (let i = firstVisible; i >= 0; i--) {
      const row = rows[i];
      if (row?.type === "header") return row.label;
    }
    return null;
  }, [groupBy, virtualItems, rows]);

  return (
    <div ref={parentRef} className="relative w-full">
      {activeLabel && (
        <div
          className="pointer-events-none sticky z-10 flex"
          style={{ top: stickyTopOffset }}
        >
          <span className="pointer-events-auto rounded-full border border-border bg-background/90 px-3 py-1 text-xs font-medium text-foreground shadow-sm backdrop-blur-sm">
            {activeLabel}
          </span>
        </div>
      )}
      <div
        style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}
      >
        {virtualItems.map((virtualRow) => {
          const row = rows[virtualRow.index];
          return (
            <div
              key={row?.key ?? virtualRow.index}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start - virtualizer.options.scrollMargin}px)`,
              }}
              className={
                row?.type === "header"
                  ? "px-px"
                  : isList
                    ? "px-px py-1"
                    : `grid gap-3 px-px pb-3 ${gridColsCls(columnsByBreakpoint)}`
              }
            >
              {row?.type === "header" ? (
                <DateHeader label={row.label} count={row.count} />
              ) : (
                row?.items.map((r) => renderResult(r, renderItem))
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DateHeader({
  label,
  count,
  sticky,
  stickyTopOffset = 0,
}: {
  label: string;
  count: number;
  sticky?: boolean;
  stickyTopOffset?: number;
}) {
  return (
    <div
      className={`flex items-baseline gap-2 py-2 ${
        sticky ? "sticky z-10 bg-background/95 backdrop-blur-sm" : ""
      }`}
      style={sticky ? { top: stickyTopOffset } : undefined}
    >
      <h2 className="text-sm font-semibold text-foreground">{label}</h2>
      <span className="text-[11px] text-muted-foreground">{count}</span>
    </div>
  );
}

function containerCls(
  layout: "grid" | "list",
  cols: { sm: number; md: number; lg: number; xl: number }
): string {
  if (layout === "list") return "flex flex-col gap-2";
  return `grid items-start gap-3 ${gridColsCls(cols)}`;
}

// Tailwind v4 scans for literal class names — these maps keep every
// class string that the responsive grid might emit visible to the
// scanner. Touch carefully when adding new column counts.
const COL_BASE: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
};
const COL_MD: Record<number, string> = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
};
const COL_LG: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
};
const COL_XL: Record<number, string> = {
  1: "2xl:grid-cols-1",
  2: "2xl:grid-cols-2",
  3: "2xl:grid-cols-3",
  4: "2xl:grid-cols-4",
};

function gridColsCls(cols: { sm: number; md: number; lg: number; xl: number }): string {
  return [
    COL_BASE[cols.sm] ?? "grid-cols-1",
    COL_MD[cols.md] ?? "md:grid-cols-2",
    COL_LG[cols.lg] ?? "lg:grid-cols-2",
    COL_XL[cols.xl] ?? "2xl:grid-cols-2",
  ].join(" ");
}

function searchResultToCaptureCardData(r: SearchResult): CaptureCardData {
  return {
    id: r.id,
    url: r.url,
    ogTitle: r.title,
    urlHost: r.urlHost,
    kindClassified: r.kind,
    createdAt: r.createdAt,
    openedAt: r.openedAt,
    evergreen: r.evergreen,
    readMinutes: r.readMinutes,
    watchMinutes: r.watchMinutes,
    summary: r.summary,
    paywalled: r.paywalled,
  };
}

function NoteRow({ row }: { row: SearchResult }) {
  return (
    <Link
      href={`/app/notes/${row.id}`}
      className="block rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/20"
    >
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          note
        </span>
        <span className="text-[10px] text-muted-foreground">
          {new Date(row.createdAt).toLocaleDateString()}
        </span>
      </div>
      <h3
        className="mt-1 line-clamp-2 break-words font-medium leading-snug text-foreground"
        title={row.title}
      >
        {row.title}
      </h3>
      {row.snippet && (
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{row.snippet}</p>
      )}
    </Link>
  );
}
