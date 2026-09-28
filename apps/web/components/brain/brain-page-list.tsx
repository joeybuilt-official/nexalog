// SPDX-License-Identifier: MIT
"use client";

/**
 * BrainPageList — the /app/brain index: every page in the brain, filterable by
 * typed group and by title/slug, with an honest degraded banner when the list
 * did not come from GBrain.
 *
 * It deliberately REUSES the ContentFinder family's states (`EmptyState`,
 * `ErrorState`, `LoadingShimmer`) and the garden's type->group folding
 * (`lib/graph/filters`), so the brain surface reads like the rest of the app
 * and a page's type means the same thing here as in the Garden. It does NOT
 * reuse `<ContentFinder>` itself: that component is bound to `POST /api/search`
 * and its `SearchResult` shape, and bending it into a different resource would
 * make both worse. The shared vocabulary is the types and the states.
 *
 * The list is virtualized only past the point where it matters (the whole
 * index can be thousands of rows); before that it renders plainly.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { EmptyState, ErrorState, LoadingShimmer } from "@/components/content-finder/states";
import { FilterChips } from "@/components/brain/filter-chips";
import { brainPageHref } from "@/lib/search/result-href";
import { filterByGroups, groupForPage, groupsInPages, type BrainGroup } from "@/lib/pages/groups";

export interface BrainPageRow {
  slug: string;
  title: string;
  type: string;
  updatedAt: string | null;
}

interface PagesResponse {
  ok: boolean;
  source: "gbrain" | "local" | "none";
  degraded: boolean;
  pages: BrainPageRow[];
  nextOffset: number | null;
  truncated: boolean;
  note?: string;
}

const PAGE_SIZE = 100;

export function BrainPageList() {
  const [data, setData] = useState<PagesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<BrainGroup[] | "all">("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/pages?limit=${PAGE_SIZE}`, { cache: "no-store", signal: ac.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`pages ${r.status}`);
        return (await r.json()) as PagesResponse;
      })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!ac.signal.aborted) setError(e instanceof Error ? e.message : "Pages request failed");
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, []);

  const pages = useMemo(() => data?.pages ?? [], [data]);
  const groups = useMemo(() => groupsInPages(pages), [pages]);
  const visible = useMemo(
    () => filterByGroups(pages, active, query),
    [pages, active, query],
  );
  const counts = useMemo(() => {
    const out = new Map<BrainGroup, number>();
    for (const p of pages) {
      const g = groupForPage(p);
      if (g) out.set(g, (out.get(g) ?? 0) + 1);
    }
    return out;
  }, [pages]);

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <LoadingShimmer count={6} />
      </div>
    );
  }

  if (error && !data) {
    return (
      <ErrorState
        message={`The brain index is out of reach (${error}). Captures and notes keep working — nothing is lost, the list is just missing.`}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {data?.degraded && (
        <div className="rounded-lg border border-primary/50 bg-surface p-4 text-sm">
          <p className="font-medium text-foreground">
            {data.source === "local"
              ? "Read from the brain repo — GBrain not in the loop"
              : "No pages to list"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.note ?? "This list was rebuilt from local sources."}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by title or slug…"
          aria-label="Filter brain pages"
          className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
        <span className="text-xs text-muted-foreground">
          {visible.length === pages.length
            ? `${pages.length} page${pages.length === 1 ? "" : "s"}`
            : `${visible.length} of ${pages.length} pages`}
        </span>
      </div>

      {groups.length > 0 && (
        <FilterChips
          groups={groups}
          counts={counts}
          active={active}
          onChange={(next) => setActive(next === "all" ? "all" : [...next])}
        />
      )}

      {data?.truncated && (
        <p className="text-xs text-muted-foreground">
          Showing the most recently updated {pages.length} pages — this is a prefix of the
          index, not the whole of it.
        </p>
      )}

      {pages.length === 0 ? (
        <EmptyState
          title="No brain pages yet"
          hint="Pages appear here once the brain repo holds them and GBrain has indexed them."
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title="Nothing matches that filter"
          hint="Clear the filter or turn a type chip back on."
        />
      ) : (
        <ul className="divide-y divide-border/60">
          {visible.map((p) => (
            <li key={p.slug}>
              <Link
                href={brainPageHref(p.slug)}
                className="flex items-baseline gap-3 px-1 py-3 hover:bg-muted/40"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {p.title || p.slug}
                </span>
                <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {p.type || groupForPage(p) || "page"}
                </span>
                <span className="hidden shrink-0 truncate font-mono text-[11px] text-muted-foreground sm:block sm:max-w-[16rem]">
                  {p.slug}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
