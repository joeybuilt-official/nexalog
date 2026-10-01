// SPDX-License-Identifier: MIT
/**
 * NEXALOG-PROJECTS — the PUBLISH rules, and where a project lives in the brain.
 *
 * Two things are rules rather than IO, so they live here with no React, no
 * database and no `next/*`:
 *
 *   1. **Which brain page a project is addressed to.** A sub-project's page is
 *      addressed under its parent's named page — `projects/<parent>--<child>`,
 *      FLAT, because the brain's slug vocabulary is flat (`projects/fylo`,
 *      `people/x`) and every wire consumer here treats the part after the prefix
 *      as one segment; a nested path would render a page whose own backlink graph
 *      disagrees with its address. A root's is `projects/<slug>`, and a recorded
 *      slug (from the not-yet-built push job, or an id-addressed page) always
 *      wins. Computed, never stored: no column is invented for this.
 *   2. **The published brief's provenance, including the project's in-app route.**
 *      The queue already renders links from a `pageHref` the web layer builds
 *      from the slug; that resolution belongs here, where the URL grammar is a
 *      value a test can assert.
 *
 * The rules a publish must OBEY — only a synthesis may be published, the claim
 * must be fence-safe, the same brief must not double-propose — are
 * `@nexalog/core`'s (see `packages/core/src/domain/brief-publish.ts`). Nothing
 * here re-decides them; this module owns only the address and the URL.
 */

import { z } from "zod";

import { PROJECT_SLUG_PREFIX } from "@nexalog/core";

/** Slugs are paths under `projects/`; each segment is encoded for a URL. */
const SLUG_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The app's own rule for a slug this app MINTS (mirrors `Slug.of` in core). */
export function isMintableSlugSegment(value: string): boolean {
  return SLUG_SEGMENT.test(value);
}

/**
 * Mint the slug segment for a project NAME.
 *
 * Deliberately `<parent-segment>--<child-segment>` rather than
 * `projects/<parent>/<child>`: the brain's slug vocabulary is FLAT
 * (`projects/fylo`, `people/x`), every wire consumer here (`propose`, the
 * page-href builder, search `types: ['project']`) treats the part after the
 * prefix as one segment, and a nested path would render a page whose own
 * backlink graph disagrees with its address. The `--` separator is the same
 * convention the operator already hand-uses for a sub-project's name, and it is
 * legal under the strict slug charset above.
 *
 * ASCII-folds the name (a slug this app mints must be mappable back from a
 * filename) and refuses to mint anything the charset rejects: an empty result
 * returns `null`, and callers fall back to a stable id-derived segment rather
 * than publishing a claim addressed to an invalid slug.
 */
export function projectSlugSegment(name: string | null | undefined): string | null {
  const folded = (name ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!folded || !isMintableSlugSegment(folded)) return null;
  return folded;
}

export type ProjectAddressInput = {
  id: string;
  name: string;
  /** The parent project's NAME, when this project is a sub-project. */
  parentName?: string | null;
  /**
   * A slug recorded by the (not yet built) push job, when one exists. It wins
   * over both synthesized forms — a recorded address is the truth about where
   * this project actually lives.
   */
  slug?: string | null;
};

/**
 * The brain page a project's proposal is addressed to.
 *
 * Every branch is deterministic, so the same project always resolves to the same
 * address — which is what makes the published rows greppable and what keeps a
 * `projects/<slug>` reference valid after a retry.
 *
 * The id-derived fallback exists because a slug must be VALID, not merely
 * non-empty: a project named entirely in non-ASCII characters mints nothing, and
 * a proposal addressed to `projects/` would resolve to no page at all.
 */
export function projectPageSlug(project: ProjectAddressInput): string {
  const recorded = (project.slug ?? "").trim().replace(/\/+$/, "");
  if (recorded) {
    return recorded.startsWith(PROJECT_SLUG_PREFIX) ? recorded : `${PROJECT_SLUG_PREFIX}${recorded}`;
  }

  const child = projectSlugSegment(project.name) ?? idSegment(project.id);
  const parent = projectSlugSegment(project.parentName ?? null);
  if (parent) return `${PROJECT_SLUG_PREFIX}${parent}--${child}`;
  return `${PROJECT_SLUG_PREFIX}${child}`;
}

/** A stable, always-valid segment for a project the slug rules cannot name. */
export function idSegment(id: string): string {
  const compact = id.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 12);
  return `project-${compact || "unnamed"}`;
}

/**
 * Whether a display string can be COMPARED to a slug at all. Non-empty and
 * ASCII-ish: a slug-to-name match is an optimization (it avoids a search round
 * trip), and a string that could never equal a slug must not be sent looking for
 * one.
 */
export function isSlugComparable(value: string | null | undefined): boolean {
  const trimmed = (value ?? "").trim();
  return trimmed !== "" && /^[\x20-\x7e]+$/.test(trimmed);
}

/**
 * The best project page among the brain's search hits.
 *
 * Two rounds, both deterministic, and the reason for two is that the semantic
 * search answers "which page is NEAR this text", not "which page IS this
 * project": on the live index a search for one project returns the project
 * directory as a neighborhood, so a name-exact hit must beat a higher-cosine
 * neighbor or the brief is published on the wrong page.
 *
 *   1. an exact slug match on the project's id, or on its name in slug form;
 *   2. the remaining PROJECT-TYPE hits, by cosine descending, then slug.
 *
 * A hit with no cosine is never chosen in round 2 — "the search did not say how
 * close this is" cannot support choosing a page, which is the same rule the
 * plan-impact reconciler applies to its relevance floor.
 */
export function pickProjectPage(
  project: { id: string; name: string },
  hits: ReadonlyArray<{ slug: string; type?: string | null; cosine?: number | null }>,
): string | null {
  const normalized = (value: string) => value.trim().toLowerCase();

  const exact = new Set<string>([`${PROJECT_SLUG_PREFIX}${idSegment(project.id)}`]);
  const named = projectSlugSegment(project.name);
  if (named) exact.add(`${PROJECT_SLUG_PREFIX}${named}`);
  const id = normalized(project.id);
  if (id) exact.add(id);

  for (const hit of hits) {
    const slug = normalized(hit.slug ?? "");
    if (slug && exact.has(slug)) {
      return slug.startsWith(PROJECT_SLUG_PREFIX) ? slug : `${PROJECT_SLUG_PREFIX}${slug}`;
    }
  }

  let best: { slug: string; cosine: number } | null = null;
  for (const hit of hits) {
    const slug = (hit.slug ?? "").trim();
    if (!slug.startsWith(PROJECT_SLUG_PREFIX)) continue;
    if (hit.type && hit.type !== PROJECT_TYPE) continue;
    const cosine = typeof hit.cosine === "number" && Number.isFinite(hit.cosine) ? hit.cosine : null;
    if (cosine === null || cosine <= 0) continue;
    if (!best || cosine > best.cosine || (cosine === best.cosine && slug < best.slug)) {
      best = { slug, cosine };
    }
  }
  return best ? best.slug : null;
}

/** The page type gbrain tags project pages with. */
export const PROJECT_TYPE = "project";

/**
 * How many linked-note TITLES a published brief cites as evidence. Bounded like
 * every other list this feature builds, and a count rather than a page: the queue
 * card is read at a glance, and the note corpus is the thing that produced the
 * brief, not the thing the operator adjudicates.
 */
export const BRIEF_PUBLISH_EVIDENCE_NOTE_TITLES = 8;

// ---- the published provenance ------------------------------------------------

/** The `brief/1` payload as the queue DTO carries it. */
export interface BriefDiffDto {
  type: string;
  projectId: string;
  pageSlug: string;
  generatedAt: string;
  modelId: string;
  promptVersion: string;
  markdown: string;
}

/** The provenance columns a published brief's DTO carries. */
export interface PublishedProvenance {
  projectId: string;
  projectName: string;
  /** The in-app route, resolved from the slug here where the URL grammar lives. */
  projectHref: string | null;
  pageSlug: string;
  modelId: string;
  generatedAt: string;
  promptVersion: string;
}

/**
 * `projects/<a>/<b>` → `/app/projects/<a>/<b>`. The prefix is STRIPPED rather
 * than kept, because the in-app route already carries `projects/` — appending it
 * again is the defect that produces a 404 no test would catch.
 *
 * Returns null for an empty slug rather than a link into nowhere; the caller
 * renders the slug as text instead (the same rule `evidenceCaptureHref` follows).
 */
export function projectPageHref(slug: string): string | null {
  const trimmed = (slug ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed) return null;

  // `projects` with no tail is the PREFIX itself, not a project called
  // "projects": a href built from it would point at the projects INDEX, which is
  // not the page the brief is addressed to. Refused rather than rendered.
  if (trimmed === PROJECT_SLUG_PREFIX.replace(/\/$/, "")) return null;

  const path = trimmed.startsWith(PROJECT_SLUG_PREFIX)
    ? trimmed.slice(PROJECT_SLUG_PREFIX.length)
    : trimmed;
  if (!path) return null;
  const encoded = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/app/projects/${encoded}`;
}

// ---- the publish request body ------------------------------------------------

/** The intent a publish request names. A misspelled value is a 400, not a guess. */
export const BRIEF_PUBLISH_ACTIONS = ["publish"] as const;

/**
 * `POST /api/projects/[id]/brief` with `{ intent: "publish" }` publishes;
 * `{ intent: "regenerate" }` (or an absent body) regenerates. The intent is
 * REQUIRED when a body is present — a client asking for something this route does
 * not do must be told so, not handed a synthesis it did not ask for.
 */
export const briefPostBody = z
  .object({
    intent: z.enum(["regenerate", "publish"]).optional(),
    /** Overrides the gbrain source the proposal is addressed to. */
    sourceId: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export type BriefPostBody = z.infer<typeof briefPostBody>;

/**
 * The response of a successful publish. `duplicate` is success, not an error: it
 * is the honest answer to "you have already proposed this brief", and it is what
 * makes the action safe to press twice.
 */
export interface BriefPublishResponse {
  ok: true;
  created: boolean;
  duplicate: boolean;
  proposalId: number;
  pageSlug: string;
  pageHref: string | null;
  provenance: PublishedProvenance;
}

/** Re-exported so the client and the server name the same refusal codes. */
export { BRIEF_PUBLISH_REFUSALS as briefPublishRefusalCodes } from "@nexalog/core";
