// SPDX-License-Identifier: MIT
/**
 * Where a search result points. Pure — unit-tested, no IO.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * `SearchResult.id` is NOT a uniform key: a note's id and a capture's id are
 * UUIDs, but a BRAIN page's id is its slug (`concepts/litellm-gateway`).
 * Four call sites each guessed the route from `kind` alone and mapped every
 * non-note kind to `/app/bookmarks/<id>/reader` — so every brain hit the search
 * pipeline found 404'd on click.
 *
 * The fix is that the SERVER decides: `/api/search` populates `href` for hits
 * whose route it knows, and the UI uses it. This helper is the one place that
 * resolves a row to a route, so the fallback cannot drift between four copies
 * again, and `resultHref` (the four call sites) reads identically everywhere.
 */

export interface HrefCapableResult {
  id: string;
  kind: string;
  /** Server-supplied route. Preferred whenever present. */
  href?: string | null;
}

/**
 * The in-app route for a search result.
 *
 * `null` means "this row has no in-app route" — the caller should fall back to
 * its own presentation (open the external URL, or render it as plain text)
 * rather than linking somewhere that 404s.
 *
 * A row whose `kind` is a capture kind still resolves through the id fallback:
 * `capture_sources` rows are UUID-keyed and the reader route takes that UUID.
 * That fallback is for rows the server did not annotate — a brain hit always
 * arrives WITH its `href`.
 */
export function resolveResultHref(r: HrefCapableResult): string | null {
  if (r.href) return r.href;
  if (r.kind === "note") return `/app/notes/${r.id}`;
  return null;
}

/** The reader route for one brain page. Slugs are paths, so each segment is encoded. */
export function brainPageHref(slug: string): string {
  const encoded = slug
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/app/brain/${encoded}`;
}

/** A capture's id is a uuid — the shape its reader route takes. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The route for a row the CAPTURE card is rendering: the server's `href` when
 * it supplied one, else the capture-reader route — but ONLY when the id is
 * actually a capture's uuid.
 *
 * The uuid guard is the point. `row.id` is a slug for a brain page, and
 * minting `/app/bookmarks/<slug>/reader` from it is the very 404 this change
 * removes; a card that has neither a server route nor a uuid id gets `null`
 * and renders no reader control, which is honest.
 */
export function captureReaderHref(id: string, href?: string | null): string | null {
  if (href) return href;
  return UUID_RE.test(id) ? `/app/bookmarks/${id}/reader` : null;
}
