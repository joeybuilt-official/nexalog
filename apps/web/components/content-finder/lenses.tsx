// SPDX-License-Identifier: MIT
"use client";

/**
 * Database-style lenses over the ContentFinder result set (Phase 2.3).
 * Table / Board / Calendar views render the SAME `/api/search` rows the
 * card grid does — no new data model, no typed objects (that path is
 * ADR-0004-gated). Every lens consumes `SearchResult[]` and degrades to a
 * plain empty state when there's nothing to show.
 *
 * Item linking is uniform: notes → /app/notes/{id}, captures → their URL
 * (new tab), mirroring the citation-chip behaviour elsewhere.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, FileText } from "lucide-react";
import type { SearchResult } from "./types";

// ── shared helpers ──────────────────────────────────────────────────────────

function kindLabel(r: SearchResult): string {
  return r.kind === "note" ? "note" : r.kind;
}

function isExternal(r: SearchResult): boolean {
  return r.kind !== "note" && !!r.url;
}

function shortDate(v: string | null): string {
  if (!v) return "—";
  return new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function timeLabel(r: SearchResult): string {
  if (r.readMinutes) return `${r.readMinutes}m read`;
  if (r.watchMinutes) return `${r.watchMinutes}m watch`;
  return "—";
}

/** Note → internal Link; capture → external anchor. Shared by all lenses. */
function ItemLink({
  r,
  className,
  title,
  children,
}: {
  r: SearchResult;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  if (r.kind === "note") {
    return (
      <Link href={`/app/notes/${r.id}`} className={className} title={title}>
        {children}
      </Link>
    );
  }
  if (r.url) {
    return (
      <a href={r.url} target="_blank" rel="noopener noreferrer" className={className} title={title}>
        {children}
      </a>
    );
  }
  return (
    <span className={className} title={title}>
      {children}
    </span>
  );
}

function EmptyLens({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

// ── Table lens ──────────────────────────────────────────────────────────────

export function ResultTable({ results }: { results: SearchResult[] }) {
  if (results.length === 0) return <EmptyLens label="Nothing to show in this table." />;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">Title</th>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="hidden px-3 py-2 font-medium md:table-cell">Theme</th>
            <th className="px-3 py-2 font-medium">Saved</th>
            <th className="hidden px-3 py-2 font-medium lg:table-cell">Opened</th>
            <th className="hidden px-3 py-2 font-medium lg:table-cell">Time</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={`${r.kind}:${r.id}`} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
              <td className="max-w-[420px] px-3 py-2">
                <ItemLink
                  r={r}
                  title={r.title}
                  className="flex items-center gap-1.5 font-medium text-foreground hover:underline"
                >
                  {r.kind === "note" ? (
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : null}
                  <span className="truncate">{r.title || "Untitled"}</span>
                  {isExternal(r) && <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />}
                </ItemLink>
                {r.urlHost && <span className="block truncate text-[11px] text-muted-foreground">{r.urlHost}</span>}
              </td>
              <td className="px-3 py-2">
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] capitalize text-muted-foreground">
                  {kindLabel(r)}
                </span>
              </td>
              <td className="hidden px-3 py-2 text-muted-foreground md:table-cell">
                <span className="line-clamp-1">{r.themeLabel ?? "—"}</span>
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{shortDate(r.createdAt)}</td>
              <td className="hidden whitespace-nowrap px-3 py-2 text-muted-foreground lg:table-cell">
                {shortDate(r.openedAt)}
              </td>
              <td className="hidden whitespace-nowrap px-3 py-2 text-muted-foreground lg:table-cell">{timeLabel(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Board lens (kanban grouped by type) ─────────────────────────────────────

const KIND_ORDER = ["note", "article", "video", "reference", "social", "homepage", "other"];

export function ResultBoard({ results }: { results: SearchResult[] }) {
  const columns = useMemo(() => {
    const groups = new Map<string, SearchResult[]>();
    for (const r of results) {
      const k = r.kind || "other";
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r);
    }
    const rank = (k: string) => {
      const i = KIND_ORDER.indexOf(k);
      return i === -1 ? KIND_ORDER.length : i;
    };
    return [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
  }, [results]);

  if (results.length === 0) return <EmptyLens label="Nothing to show on this board." />;

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map(([kind, items]) => (
        <div key={kind} className="flex w-64 shrink-0 flex-col rounded-lg border border-border bg-muted/20">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-semibold capitalize text-foreground">{kind}</span>
            <span className="text-[11px] text-muted-foreground">{items.length}</span>
          </div>
          <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto p-2">
            {items.map((r) => (
              <ItemLink
                key={`${r.kind}:${r.id}`}
                r={r}
                title={r.title}
                className="block rounded-md border border-border bg-card p-2.5 transition-colors hover:border-foreground/20"
              >
                <span className="line-clamp-2 break-words text-sm font-medium text-foreground">
                  {r.title || "Untitled"}
                </span>
                <span className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                  {shortDate(r.createdAt)}
                  {isExternal(r) && <ExternalLink className="h-2.5 w-2.5 opacity-50" />}
                </span>
              </ItemLink>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Calendar lens (month grid by saved date) ────────────────────────────────

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function ResultCalendar({ results }: { results: SearchResult[] }) {
  // Anchor the initial month on the most recent result so the view opens
  // where the data is, not necessarily the current (possibly empty) month.
  const [anchor, setAnchor] = useState<Date>(() => {
    const newest = results[0]?.createdAt;
    const d = newest ? new Date(newest) : new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const byDay = useMemo(() => {
    const map = new Map<string, SearchResult[]>();
    for (const r of results) {
      if (!r.createdAt) continue;
      const d = new Date(r.createdAt);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return map;
  }, [results]);

  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  const cells: Array<{ day: number | null }> = [];
  for (let i = 0; i < firstDow; i++) cells.push({ day: null });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d });
  while (cells.length % 7 !== 0) cells.push({ day: null });

  const monthLabel = anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-semibold text-foreground">{monthLabel}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setAnchor(new Date(year, month - 1, 1))}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Previous month"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => setAnchor(new Date(today.getFullYear(), today.getMonth(), 1))}
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Today
          </button>
          <button
            onClick={() => setAnchor(new Date(year, month + 1, 1))}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Next month"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 border-b border-border text-center text-[11px] text-muted-foreground">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1.5">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((c, i) => {
          if (c.day == null) return <div key={`e${i}`} className="min-h-[88px] border-b border-r border-border/40 bg-muted/10" />;
          const key = `${year}-${month}-${c.day}`;
          const items = byDay.get(key) ?? [];
          const isToday =
            today.getFullYear() === year && today.getMonth() === month && today.getDate() === c.day;
          return (
            <div key={key} className="min-h-[88px] border-b border-r border-border/40 p-1 last:border-r-0">
              <div className={`mb-1 text-[11px] ${isToday ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                {c.day}
              </div>
              <div className="flex flex-col gap-0.5">
                {items.slice(0, 3).map((r) => (
                  <ItemLink
                    key={`${r.kind}:${r.id}`}
                    r={r}
                    title={r.title}
                    className="block truncate rounded bg-muted px-1 py-0.5 text-[10px] text-foreground hover:bg-muted/70"
                  >
                    {r.title || "Untitled"}
                  </ItemLink>
                ))}
                {items.length > 3 && (
                  <span className="px-1 text-[10px] text-muted-foreground">+{items.length - 3} more</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
