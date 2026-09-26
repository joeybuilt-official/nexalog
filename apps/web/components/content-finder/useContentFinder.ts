// SPDX-License-Identifier: MIT
"use client";

/**
 * State + fetch hook for ContentFinder. Owns:
 *   - URL-search-param round-trip (browser back/forward + share-link)
 *   - debounced query (180ms)
 *   - in-flight abort on subsequent calls
 *   - light cache keyed by request signature (last 8 entries)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type {
  ContentFinderFilters,
  SearchRequest,
  SearchResponse,
  SortKey,
  Surface,
} from "./types";

const DEBOUNCE_MS = 180;
const CACHE_SIZE = 8;

interface UseContentFinderOptions {
  surfaces: Surface[];
  defaultSort?: SortKey;
  defaultFilters?: ContentFinderFilters;
  limit?: number;
  /**
   * Whether to read/write filter state from the URL. Defaults to true.
   * Set false for embedded use where the host page owns its own URL state.
   */
  syncToUrl?: boolean;
  /**
   * Extra request seed merged into every payload (e.g. region/theme from a
   * sidebar selection that lives outside ContentFinder).
   */
  seedFilters?: ContentFinderFilters;
}

export interface UseContentFinderState {
  query: string;
  setQuery: (q: string) => void;
  filters: ContentFinderFilters;
  setFilters: (f: ContentFinderFilters) => void;
  patchFilters: (patch: Partial<ContentFinderFilters>) => void;
  sort: SortKey;
  setSort: (s: SortKey) => void;
  data: SearchResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

function readFromParams(
  params: URLSearchParams,
  defaultSort: SortKey,
  defaultFilters: ContentFinderFilters
): {
  query: string;
  sort: SortKey;
  filters: ContentFinderFilters;
} {
  const q = params.get("q") ?? "";
  const sort = (params.get("sort") as SortKey) || defaultSort;
  const filters: ContentFinderFilters = { ...defaultFilters };
  const themeIds = params.getAll("theme");
  if (themeIds.length) filters.themeIds = themeIds;
  const regions = params.getAll("region");
  if (regions.length) filters.regions = regions;
  const age = params.get("age");
  if (age) filters.ageRange = age as ContentFinderFilters["ageRange"];
  const ev = params.get("evergreen");
  if (ev === "y") filters.evergreen = true;
  if (ev === "n") filters.evergreen = false;
  const op = params.get("opened");
  if (op === "y") filters.opened = true;
  if (op === "n") filters.opened = false;
  const pw = params.get("paywalled");
  if (pw === "y") filters.paywalled = true;
  return { query: q, sort, filters };
}

function writeToParams(
  base: URLSearchParams,
  query: string,
  sort: SortKey,
  filters: ContentFinderFilters,
  defaultSort: SortKey
): URLSearchParams {
  const next = new URLSearchParams(base);
  // strip our keys first
  ["q", "sort", "theme", "region", "age", "evergreen", "opened", "paywalled"].forEach((k) =>
    next.delete(k)
  );
  if (query) next.set("q", query);
  if (sort && sort !== defaultSort) next.set("sort", sort);
  if (filters.themeIds) for (const t of filters.themeIds) next.append("theme", t);
  if (filters.regions) for (const r of filters.regions) next.append("region", r);
  if (filters.ageRange && filters.ageRange !== "all") next.set("age", filters.ageRange);
  if (filters.evergreen === true) next.set("evergreen", "y");
  if (filters.evergreen === false) next.set("evergreen", "n");
  if (filters.opened === true) next.set("opened", "y");
  if (filters.opened === false) next.set("opened", "n");
  if (filters.paywalled === true) next.set("paywalled", "y");
  return next;
}

export function useContentFinder(
  options: UseContentFinderOptions
): UseContentFinderState {
  const {
    surfaces,
    defaultSort = "recency",
    defaultFilters = {},
    limit = 60,
    syncToUrl = true,
    seedFilters,
  } = options;

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const initial = useMemo(
    () =>
      syncToUrl
        ? readFromParams(searchParams, defaultSort, defaultFilters)
        : { query: "", sort: defaultSort, filters: defaultFilters },
    // intentional: only read URL on first mount; subsequent updates flow back
    // to the URL via the writer below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [query, setQueryRaw] = useState(initial.query);
  const [debouncedQuery, setDebouncedQuery] = useState(initial.query);
  const [filters, setFiltersRaw] = useState<ContentFinderFilters>(initial.filters);
  const [sort, setSortRaw] = useState<SortKey>(initial.sort);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<Map<string, SearchResponse>>(new Map());

  // Debounce typed query
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // Write to URL whenever query/filters/sort change
  useEffect(() => {
    if (!syncToUrl) return;
    const next = writeToParams(searchParams, debouncedQuery, sort, filters, defaultSort);
    const nextStr = next.toString();
    const curStr = searchParams.toString();
    if (nextStr !== curStr) {
      router.replace(`${pathname}${nextStr ? `?${nextStr}` : ""}`, { scroll: false });
    }
  }, [debouncedQuery, sort, filters, syncToUrl, defaultSort, pathname, router, searchParams]);

  // Fetch on debounced query / filters / sort / tick
  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const merged: ContentFinderFilters = { ...filters };
    if (seedFilters) {
      if (seedFilters.themeIds?.length) {
        merged.themeIds = [
          ...(merged.themeIds ?? []),
          ...seedFilters.themeIds,
        ]
      }
      if (seedFilters.themeLabels?.length) {
        merged.themeLabels = [
          ...(merged.themeLabels ?? []),
          ...seedFilters.themeLabels,
        ]
      }
      if (seedFilters.captureIds?.length) {
        merged.captureIds = [
          ...(merged.captureIds ?? []),
          ...seedFilters.captureIds,
        ];
      }
      if (seedFilters.tagIds?.length) {
        merged.tagIds = [...(merged.tagIds ?? []), ...seedFilters.tagIds];
      }
      if (seedFilters.regions?.length) {
        merged.regions = [...(merged.regions ?? []), ...seedFilters.regions];
      }
      if (seedFilters.ageRange && !merged.ageRange) merged.ageRange = seedFilters.ageRange;
      if (seedFilters.evergreen != null && merged.evergreen == null) {
        merged.evergreen = seedFilters.evergreen;
      }
      if (seedFilters.opened != null && merged.opened == null) {
        merged.opened = seedFilters.opened;
      }
    }

    const body: SearchRequest = {
      surfaces,
      query: debouncedQuery || undefined,
      filters: merged,
      sort,
      limit,
    };
    const cacheKey = JSON.stringify(body);
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setData(cached);
      setError(null);
      return () => controller.abort();
    }

    setLoading(true);
    setError(null);
    fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`search ${res.status}`);
        const json = (await res.json()) as SearchResponse;
        if (!controller.signal.aborted) {
          setData(json);
          // LRU-ish trim
          if (cacheRef.current.size >= CACHE_SIZE) {
            const oldest = cacheRef.current.keys().next().value;
            if (oldest) cacheRef.current.delete(oldest);
          }
          cacheRef.current.set(cacheKey, json);
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Search failed");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [debouncedQuery, filters, sort, surfaces, limit, seedFilters, tick]);

  const setQuery = useCallback((q: string) => setQueryRaw(q), []);
  const setFilters = useCallback((f: ContentFinderFilters) => setFiltersRaw(f), []);
  const patchFilters = useCallback(
    (patch: Partial<ContentFinderFilters>) =>
      setFiltersRaw((prev) => ({ ...prev, ...patch })),
    []
  );
  const setSort = useCallback((s: SortKey) => setSortRaw(s), []);
  const refetch = useCallback(() => setTick((t) => t + 1), []);

  return {
    query,
    setQuery,
    filters,
    setFilters,
    patchFilters,
    sort,
    setSort,
    data,
    loading,
    error,
    refetch,
  };
}
