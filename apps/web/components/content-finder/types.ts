// SPDX-License-Identifier: MIT
/**
 * Shared types for the ContentFinder component family. Mirror of the
 * `/api/search` request/response shape so the UI never reaches into the
 * route handler directly.
 */

export type Surface =
  | "notes"
  | "bookmarks"
  | "video"
  | "article"
  | "reference"
  | "social"
  | "homepage";

export type SortKey =
  | "relevance"
  | "recency"
  | "last_opened"
  | "staleness_desc"
  | "theme_growth";

export type AgeRange = "today" | "7d" | "30d" | "90d" | "1y" | "all";

/** Render lens for the result set. "grid" is the default card view. */
export type ViewMode = "grid" | "table" | "board" | "calendar";

export type ResultKind =
  | "note"
  | "video"
  | "article"
  | "reference"
  | "social"
  | "homepage"
  | "other";

export interface ContentFinderFilters {
  themeIds?: string[];
  themeLabels?: string[];
  captureIds?: string[];
  tagIds?: string[];
  regions?: string[];
  ageRange?: AgeRange;
  evergreen?: boolean;
  opened?: boolean;
  paywalled?: boolean;
  hasReader?: boolean;
}

export interface SearchResult {
  id: string;
  kind: ResultKind;
  title: string;
  /** Server-decided route. Null when the row has no in-app page. */
  href?: string | null;
  url: string | null;
  themeLabel: string | null;
  themeRegion: string | null;
  themeId: string | null;
  openedAt: string | null;
  evergreen: boolean | null;
  paywalled: boolean | null;
  readMinutes: number | null;
  watchMinutes: number | null;
  summary: string | null;
  ogImage: string | null;
  faviconUrl: string | null;
  urlHost: string | null;
  createdAt: string;
  score: number;
  snippet: string | null;
}

export interface SearchSuggestion {
  label: string;
  action: "addFilter" | "replaceQuery" | "changeSort";
  payload: Record<string, unknown>;
}

export interface SearchResponse {
  results: SearchResult[];
  facets: {
    totalsByKind: Record<string, number>;
    totalsByRegion: Record<string, number>;
    totalsByAge: Record<string, number>;
  };
  suggestions: SearchSuggestion[];
  total: number;
  nextCursor?: string;
  rankingMode: "hybrid" | "lexical" | "recency";
}

export interface SearchRequest {
  surfaces: Surface[];
  query?: string;
  filters?: ContentFinderFilters;
  sort?: SortKey;
  limit?: number;
  cursor?: string;
}
