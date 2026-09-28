// SPDX-License-Identifier: MIT
/**
 * The PAGE degradation ladder (pure — no IO, unit-tested).
 *
 * `GET /api/pages` and `GET /api/pages/[...slug]` can answer from more than one
 * place, and the Brain surface must always know WHICH one it got so it can show
 * a useful state instead of a blank screen. The routes do the IO (auth, MCP,
 * the brain repo); this module decides what the response says, which is the
 * part worth testing.
 *
 * It is the same ladder `lib/graph/degrade.ts` established for the garden:
 *
 *   gbrain — GBrain MCP answered. Authoritative.
 *   local  — GBrain is unconfigured, unreachable, or empty. The answer was
 *            rebuilt from the brain repo itself (the system of record), with
 *            the limits stated in `note`.
 *   none   — nothing to read at all.
 *
 * `degraded` is the UI's cue to explain itself, and every non-gbrain rung
 * carries a human-readable `note`, because "source: local" alone tells a
 * reader nothing.
 *
 * Honest limits repeated in the notes: GBrain's page index and typed links are
 * its own (embeddings, inferred edges, link table). The local rung sees only
 * the brain repo's explicit `[[wiki links]]` and frontmatter link lists over
 * the typed directories — it is a fallback, not parity.
 */

/** One row of the brain page index, as the API returns it. */
export interface BrainPageSummary {
  slug: string;
  title: string;
  type: string;
  /** Last update instant (ISO-8601), or null when the source cannot say. */
  updatedAt: string | null;
}

/** One page read: identity + the markdown body. */
export interface BrainPage {
  slug: string;
  title: string;
  type: string;
  body: string;
}

/** One resolved link, with the title of the page it points at when known. */
export interface BrainPageLink {
  slug: string;
  title: string | null;
  linkType: string;
  context: string | null;
}

export type PagesSource = "gbrain" | "local" | "none";

export interface BrainPagesPayload {
  ok: boolean;
  source: PagesSource;
  /** True when the answer is not GBrain's. */
  degraded: boolean;
  pages: BrainPageSummary[];
  /** Pass back as `offset` for the next slice; null when exhausted. */
  nextOffset: number | null;
  /** The index is a prefix (GBrain's own list is capped), not the whole. */
  truncated: boolean;
  /** Why the index is what it is — set on every non-gbrain rung. */
  note?: string;
}

export interface BrainPagePayload {
  ok: boolean;
  source: Exclude<PagesSource, "none">;
  degraded: boolean;
  page: BrainPage;
  /** This page's outbound links (typed). */
  links: BrainPageLink[];
  /** Links pointing AT this page. */
  backlinks: BrainPageLink[];
  note?: string;
}

/** What the route managed to get out of GBrain, if anything. */
export type GbrainPagesOutcome =
  | { status: "unconfigured" }
  | { status: "unreachable" }
  | { status: "empty" }
  /**
   * GBrain answered, and at the requested offset there is nothing left. This
   * is NOT the same as `empty`: the caller walked off the end of a real index,
   * so falling back to the brain repo here would report rows from a different
   * source at a position they do not occupy.
   */
  | { status: "exhausted" }
  | { status: "ok"; pages: BrainPageSummary[]; truncated: boolean };

/** The brain-repo fallback: whatever the bounded local walk could read. */
export interface LocalPagesOutcome {
  pages: BrainPageSummary[];
}

export interface ResolvePagesInput {
  gbrain: GbrainPagesOutcome;
  local: LocalPagesOutcome;
  /** Rows the caller asked for, and how many it skipped. */
  limit: number;
  offset: number;
}

export function resolvePagesPayload(input: ResolvePagesInput): BrainPagesPayload {
  const { gbrain, local, limit, offset } = input;

  if (gbrain.status === "exhausted") {
    // GBrain answered — the index simply has no rows past this offset. Report
    // that plainly rather than rebuilding a position from another source.
    return {
      ok: true,
      source: "gbrain",
      degraded: false,
      pages: [],
      nextOffset: null,
      truncated: false,
    };
  }

  if (gbrain.status === "ok" && gbrain.pages.length > 0) {
    // GBrain's index is authoritative, but a page of exactly `limit` rows may
    // be a prefix of a larger set — say so instead of implying completeness.
    const more = gbrain.truncated || gbrain.pages.length >= limit;
    return {
      ok: true,
      source: "gbrain",
      degraded: false,
      pages: gbrain.pages,
      nextOffset: more ? offset + gbrain.pages.length : null,
      truncated: more,
    };
  }

  if (local.pages.length > 0) {
    const more = local.pages.length > limit;
    return {
      ok: true,
      source: "local",
      degraded: true,
      pages: local.pages.slice(0, limit),
      nextOffset: more ? offset + limit : null,
      truncated: more,
      note: localPagesNote(gbrain.status, local.pages.length),
    };
  }

  return {
    ok: true,
    source: "none",
    degraded: true,
    pages: [],
    nextOffset: null,
    truncated: false,
    note: nonePagesNote(gbrain.status),
  };
}

function localPagesNote(status: GbrainPagesOutcome["status"], count: number): string {
  const read = `${count} page${count === 1 ? "" : "s"} readable in the brain repo`;
  switch (status) {
    case "unreachable":
      return `GBrain is unreachable — this list was read straight from the brain repo (${read}). Bodies are readable; typed links and search need GBrain.`;
    case "empty":
      return `GBrain has no pages yet — showing what the brain repo itself holds (${read}).`;
    case "unconfigured":
      return `GBrain is not configured in this environment — showing what the brain repo itself holds (${read}).`;
    default:
      return `Showing what the brain repo itself holds (${read}).`;
  }
}

function nonePagesNote(status: GbrainPagesOutcome["status"]): string {
  switch (status) {
    case "unreachable":
      return "GBrain is unreachable and no brain pages were readable — nothing to list yet. Captures and notes still work.";
    case "empty":
      return "GBrain returned no pages and no brain pages were readable — nothing to list yet.";
    default:
      return "GBrain is not configured (BRAIN_INDEX / GBRAIN_MCP_URL unset) and no brain pages were readable — the page index is unavailable in standalone mode.";
  }
}

/** What the route managed to get out of GBrain for ONE page. */
export type GbrainPageOutcome =
  | { status: "unconfigured" }
  | { status: "unreachable" }
  | { status: "missing" }
  | { status: "ok"; page: BrainPage; links: BrainPageLink[]; backlinks: BrainPageLink[] };

/** One page read from the brain repo, with its links resolved locally. */
export interface LocalPageOutcome {
  page: BrainPage;
  links: BrainPageLink[];
  backlinks: BrainPageLink[];
}

export interface ResolvePageInput {
  gbrain: GbrainPageOutcome;
  local: LocalPageOutcome | null;
}

/**
 * One page's payload, or null when the page genuinely does not exist (the
 * route turns that into a 404 — never a blank 200).
 */
export function resolvePagePayload(input: ResolvePageInput): BrainPagePayload | null {
  const { gbrain, local } = input;

  if (gbrain.status === "ok") {
    return {
      ok: true,
      source: "gbrain",
      degraded: false,
      page: gbrain.page,
      links: gbrain.links,
      backlinks: gbrain.backlinks,
    };
  }

  if (local) {
    return {
      ok: true,
      source: "local",
      degraded: true,
      page: local.page,
      links: local.links,
      backlinks: local.backlinks,
      note: localPageNote(gbrain.status),
    };
  }

  return null;
}

function localPageNote(status: GbrainPageOutcome["status"]): string {
  switch (status) {
    case "unreachable":
      return "GBrain is unreachable — this page was read straight from the brain repo. Links shown are the page's own explicit links; inferred links and backlink metadata need GBrain.";
    case "unconfigured":
      return "GBrain is not configured in this environment — this page was read straight from the brain repo. Links shown are the page's own explicit links.";
    default:
      return "This page was read from the brain repo rather than GBrain's index.";
  }
}
