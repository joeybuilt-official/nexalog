// SPDX-License-Identifier: MIT
/**
 * Proposal display model — normalize the worker-written `nexalog.proposal`
 * frontmatter block into one stable shape the UI can render.
 *
 * The block is authored by the Hermes inbox worker (external, cron-driven),
 * NOT by Nexalog, and `parseCapture` casts `nexalog.proposal` straight through
 * without validating it (`packages/core/src/contracts/frontmatter.ts`). So the
 * value reaching the view is looser than the core `Proposal` contract:
 *
 *   pages:  ["people/jane-doe", "concepts/foo"]   ← page paths, as the skill writes them
 *           [{ slug, type, title }]               ← the core contract shape
 *   links:  [["people/jane-doe", "companies/acme"]]  ← pairs
 *           ["people/jane-doe,companies/acme"]       ← a pair flattened by the YAML writer
 *
 * This module tolerates all of them and emits a single view model; it is the
 * only place that knows the block's shape is untrusted. Pure functions — no
 * DB, no fs, no React — so the normalizer is unit-testable.
 */

import { PAGE_TYPE_LABELS, Slug, isPageType, type PageType } from "@nexalog/core";

/** Brain dir → Knowledge Garden page type. Dirs are plural, types singular. */
const DIR_TYPE: Record<string, PageType> = {
  people: "person",
  companies: "company",
  projects: "project",
  concepts: "concept",
  atoms: "concept", // atoms/ render as garden concept nodes (see /api/graph)
  notes: "note",
  sources: "source",
  media: "media",
};

/** Human label for a brain dir — preferred over the type label so `atoms/`
 *  doesn't get presented as "Concept". */
const DIR_LABEL: Record<string, string> = {
  people: "Person",
  companies: "Company",
  projects: "Project",
  concepts: "Concept",
  atoms: "Atom",
  notes: "Note",
  sources: "Source",
  media: "Media",
};

const LABEL_MAX = 80;

export interface ProposalPage {
  /** Normalized brain slug, e.g. `people/jane-doe`. */
  slug: string;
  /** Leading path segment of the slug (`people`, `companies`, …); "" if none. */
  dir: string;
  /** Human label — the worker's title if it wrote one, else the de-slugged tail. */
  label: string;
  /** Garden page type driving the chip's type dot, or null when unknown. */
  type: PageType | null;
  /** Chip text for the page kind, e.g. "Person". Null for untyped pages. */
  typeLabel: string | null;
  /** Existing-surface href for the page, or null when the slug is unlinkable. */
  href: string | null;
}

export interface ProposalLink {
  from: ProposalPage;
  to: ProposalPage;
}

export interface ProposalView {
  summary: string | null;
  /** Worker confidence in 0..1, clamped; null when absent or non-numeric. */
  confidence: number | null;
  pages: ProposalPage[];
  links: ProposalLink[];
  /** True when there is anything worth rendering at all. */
  hasContent: boolean;
}

/**
 * Destination for a proposal page path. This is the EXISTING Garden surface
 * (`/app/graph` reads `?slug=` and focuses GBrain's traversal on that page) —
 * the page-identity view for a brain slug, exact rather than fuzzy. No new
 * route is invented; `/api/graph` already accepts the parameter.
 */
function hrefFor(slug: string): string | null {
  try {
    return `/app/graph?slug=${encodeURIComponent(Slug.of(slug).value)}`;
  } catch {
    return null;
  }
}

function labelFor(raw: string): string {
  const spaced = raw.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  const source = spaced || raw.trim();
  if (!source) return raw.slice(0, LABEL_MAX);
  const titled = source.replace(/\b\w/g, (c) => c.toUpperCase());
  return titled.length > LABEL_MAX ? `${titled.slice(0, LABEL_MAX).trimEnd()}…` : titled;
}

/** One page entry → ProposalPage, or null when it isn't a usable slug. */
function toPage(raw: unknown): ProposalPage | null {
  let candidate: string | null = null;
  let title: string | null = null;

  if (typeof raw === "string") {
    candidate = raw;
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    if (typeof o.slug === "string") candidate = o.slug;
    if (typeof o.title === "string" && o.title.trim()) title = o.title.trim();
  }
  if (!candidate || !candidate.trim()) return null;

  // Slugs are the link target, so an unparseable one is dropped rather than
  // rendered as a dead link.
  let normalized: string;
  try {
    normalized = Slug.of(candidate).value;
  } catch {
    return null;
  }

  const segments = normalized.split("/");
  const dir = segments.length > 1 ? segments[0] : "";
  const tail = segments[segments.length - 1];
  const type: PageType | null = dir
    ? (DIR_TYPE[dir] ?? (isPageType(dir) ? dir : null))
    : null;
  const typeLabel = dir
    ? (DIR_LABEL[dir] ?? (type ? PAGE_TYPE_LABELS[type] : labelFor(dir)))
    : null;

  return {
    slug: normalized,
    dir,
    label: title ?? labelFor(tail),
    type,
    typeLabel,
    href: hrefFor(normalized),
  };
}

/** A link entry → its two endpoint slugs, tolerating all three observed shapes. */
function toLinkPair(raw: unknown): [unknown, unknown] | null {
  if (typeof raw === "string") {
    // Flattened pair, e.g. `"people/jane-doe,companies/acme"`. Slugs cannot
    // contain a comma (Slug.SAFE_SEGMENT_RE), so the first comma is the split.
    const idx = raw.indexOf(",");
    if (idx === -1) return null;
    return [raw.slice(0, idx), raw.slice(idx + 1)];
  }
  if (Array.isArray(raw) && raw.length >= 2) return [raw[0], raw[1]];
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (typeof o.from === "string" && typeof o.to === "string") return [o.from, o.to];
  }
  return null;
}

/**
 * Normalize one `nexalog.proposal` value (whatever the worker actually wrote)
 * into the render view model. Never throws; unresolvable entries are dropped.
 */
export function describeProposal(raw: unknown): ProposalView {
  const block =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;

  const summaryRaw = block?.summary;
  const summary =
    typeof summaryRaw === "string" && summaryRaw.trim() ? summaryRaw.trim() : null;

  const confidenceRaw = block?.confidence;
  const confidence =
    typeof confidenceRaw === "number" && Number.isFinite(confidenceRaw)
      ? Math.min(1, Math.max(0, confidenceRaw))
      : null;

  const pages: ProposalPage[] = [];
  const seen = new Set<string>();
  const pagesRaw = Array.isArray(block?.pages) ? (block.pages as unknown[]) : [];
  for (const entry of pagesRaw) {
    const page = toPage(entry);
    if (page && !seen.has(page.slug)) {
      seen.add(page.slug);
      pages.push(page);
    }
  }

  const links: ProposalLink[] = [];
  const linksRaw = Array.isArray(block?.links) ? (block.links as unknown[]) : [];
  for (const entry of linksRaw) {
    const pair = toLinkPair(entry);
    if (!pair) continue;
    const from = toPage(pair[0]);
    const to = toPage(pair[1]);
    if (from && to) links.push({ from, to });
  }

  return {
    summary,
    confidence,
    pages,
    links,
    hasContent: Boolean(summary) || pages.length > 0 || links.length > 0,
  };
}
