// SPDX-License-Identifier: MIT

// Surface names as accepted by /api/search SearchBody.surfaces
const SURFACE_ALIASES: Record<string, string> = {
  note: "notes",
  notes: "notes",
  bookmark: "bookmarks",
  bookmarks: "bookmarks",
  video: "video",
  article: "article",
  reference: "reference",
  ref: "reference",
  social: "social",
  homepage: "homepage",
};

const AGE_ALIASES: Record<string, string> = {
  today: "today",
  "7d": "7d",
  "30d": "30d",
  "90d": "90d",
  "1y": "1y",
  all: "all",
};

const SORT_ALIASES: Record<string, string> = {
  relevance: "relevance",
  recency: "recency",
  recent: "recency",
  last_opened: "last_opened",
  opened: "last_opened",
  staleness: "staleness_desc",
  growth: "theme_growth",
};

export interface ParsedDSL {
  text: string;
  surfaces: string[];
  sort: string;
  ageRange: string | null;
  evergreen: boolean | null;
  opened: boolean | null;
  paywalled: boolean | null;
}

// Parse a DSL query string into structured fields.
// DSL tokens: kind:<surface> age:<range> sort:<sort> is:evergreen is:opened is:paywalled
// Remaining words → text (passed as freetext query to /api/search).
export function parseQueryDSL(raw: string): ParsedDSL {
  const surfaces: string[] = [];
  let sort = "relevance";
  let ageRange: string | null = null;
  let evergreen: boolean | null = null;
  let opened: boolean | null = null;
  let paywalled: boolean | null = null;
  const textParts: string[] = [];

  for (const token of raw.trim().split(/\s+/)) {
    if (!token) continue;
    const lower = token.toLowerCase();
    const colon = lower.indexOf(":");
    if (colon === -1) {
      textParts.push(token);
      continue;
    }
    const prefix = lower.slice(0, colon);
    const val = lower.slice(colon + 1);
    if (prefix === "kind" && val) {
      const mapped = SURFACE_ALIASES[val];
      if (mapped && !surfaces.includes(mapped)) surfaces.push(mapped);
    } else if (prefix === "age" && val) {
      ageRange = AGE_ALIASES[val] ?? null;
    } else if (prefix === "sort" && val) {
      sort = SORT_ALIASES[val] ?? "relevance";
    } else if (prefix === "is" && val === "evergreen") {
      evergreen = true;
    } else if (prefix === "is" && val === "opened") {
      opened = true;
    } else if (prefix === "is" && val === "paywalled") {
      paywalled = true;
    } else {
      textParts.push(token);
    }
  }

  return { text: textParts.join(" "), surfaces, sort, ageRange, evergreen, opened, paywalled };
}

// Serialize a ParsedDSL back to a DSL string (for display / saving).
export function serializeDSL(parsed: ParsedDSL): string {
  const parts: string[] = [];
  for (const s of parsed.surfaces) parts.push(`kind:${s}`);
  if (parsed.ageRange) parts.push(`age:${parsed.ageRange}`);
  if (parsed.sort !== "relevance") parts.push(`sort:${parsed.sort}`);
  if (parsed.evergreen) parts.push("is:evergreen");
  if (parsed.opened) parts.push("is:opened");
  if (parsed.paywalled) parts.push("is:paywalled");
  if (parsed.text) parts.push(parsed.text);
  return parts.join(" ");
}
