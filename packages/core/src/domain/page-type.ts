/**
 * Page types — the Knowledge Garden color system (Design Direction B).
 *
 * These map to GBrain's `gbrain-base-v2` schema-pack types. Each type has a
 * stable identity string used in frontmatter `type:` and is what the UI tints
 * (person=green, company=blue, source=amber, note=violet, project=copper,
 * concept=teal, media=slate). Keeping the canonical list here means the UI and
 * the brain-repo contract can never drift.
 */

export const PAGE_TYPES = [
  "person",
  "company",
  "project",
  "concept",
  "note",
  "source",
  "media",
] as const;

export type PageType = (typeof PAGE_TYPES)[number];

export function isPageType(v: unknown): v is PageType {
  return typeof v === "string" && (PAGE_TYPES as readonly string[]).includes(v);
}

/** A human-friendly label for a page type (used in chips, filters, legends). */
export const PAGE_TYPE_LABELS: Record<PageType, string> = {
  person: "Person",
  company: "Company",
  project: "Project",
  concept: "Concept",
  note: "Note",
  source: "Source",
  media: "Media",
};
