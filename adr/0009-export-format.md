# ADR-0009 — Data export format (Tier-1, one-way door)

**Status:** Proposed — operator approval required before C1 acceptance.
**Date:** 2026-06-27 · **Supersedes the operational specifics of ADR-0002** (kept for historical record).
**One-way door:** the export filenames + frontmatter keys + CSV header become a long-term contract; tooling people build will depend on them.

## Context
Nexalog is import-only. Phalanx gap plan flags this as the north-star Tier-1 lever: end users cannot leave with their data, the opposite of the Obsidian-class sovereignty pitch. Fix it now, before anyone has enough data that the format choice is locked in by inertia.

## Decision

One canonical export package per user, requested from a GET endpoint that streams a ZIP. Filename `nexalog-export-<userIdShort>-<YYYYMMDD>.zip`, where `<userIdShort>` = first 8 chars of the user id (avoids leaking the full id in a downloaded filename while staying disambiguated for the user's own archive).

Per-table emission rules:

- **notes/** → one markdown file per note, `notes/<workspaceSlug>/<id>-<slug>.md`. YAML frontmatter (Obsidian-compatible): `title`, `id`, `created`, `updated`, `tags`, `kind`, `workspace`, `lifecycle`. Body = the note's `content` field verbatim. Notes currently store HTML in `content`; we write it as-is (lossless) — a future HTML→markdown pass is a separate ADR (the round-trip is already guaranteed by keeping HTML in markdown's body; readers that don't render HTML fall back to source view).
- **captures.csv** → one row per `capture_sources`. Columns = every non-derived enrichment column (the full list lives in `lib/export/captures-csv.ts`; the schema source of truth is `lib/db/schema.ts` `captureSources`). Excludes only the FTS generated column and the `embedding` raw vector column (re-derivable).
- **note_links.json** → JSON array `[{ sourceNoteId, targetNoteId, kind, strength, createdAt }, …]`.
- **journal/** → one markdown file per entry, `journal/<YYYY-MM-DD>.md`. Frontmatter: `date`, `mood`, `energy`, `weather`, `voiceSourceId`. Body = `journal_entries.body`.
- **voice/** — out of scope for v1. Audio blobs live in R2 keyed by `nexalog/audio/<workspaceId>/<id>.<ext>`. The export records the R2 key on the related capture/journal row but does NOT stream the blobs through the ZIP yet (would balloon the archive and the route is currently synchronous-ish via archiver). Tracked as a follow-up — when added, blobs land at `voice/<workspaceId>/<id>.<ext>` mirroring the R2 layout.
- **manifest.json** → `{ exportedAt, userId, schemaVersion: 1, counts: { notes, captures, links, journal } }`. Drives future re-import / format-versioning.

Excluded by design:
- Embeddings (re-derivable; not portable across model versions).
- Plexo-derived themes (`memory_themes.centroid` / `memory_themes.metadata`; re-derivable from captures).
- Chat session history (not user-authored content; UX-state, not portable knowledge).
- Encryption (Nexalog has no zero-knowledge layer; users authenticate over HTTPS — adding archive-level encryption would only theatrically protect data the server already sees in cleartext).

Package = single ZIP, streamed from the route (never buffered whole-archive in memory). Library = `archiver` (one new dep, npm-standard streaming zip, used everywhere; no equivalent stdlib without writing a zip writer by hand).

## Consequences
- Frontmatter keys + CSV column set + JSON shape are a public contract from this commit forward; column adds are safe, removes/renames are breaking. Bump `schemaVersion` on any break.
- HTML-in-markdown is lossless but ugly when re-imported into a strict-markdown vault. Live with it for v1; convert in a separate ADR once we measure lossiness on real notes.
- Voice/blob omission is a documented v1 gap, not a silent miss.

## Open questions for operator
1. Approve the schemaVersion=1 commitment now, or block on a re-import roundtrip story?
2. Approve voice-blob deferral, or require it in v1?
