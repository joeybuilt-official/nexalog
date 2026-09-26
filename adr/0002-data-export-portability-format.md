# ADR-0002 — Data export & portability format

**Status:** Proposed — **operator approval required before Phase 1.4.**
**Date:** 2026-06-13 · **One-way door:** the export format becomes a long-term contract users and external tools depend on.

## Context
Nexalog is import-only — there is no export/download/backup endpoint (Phase 1 audit §7). Users can enter but cannot leave with their data, the opposite of Obsidian's core pitch and the deepest sovereignty deficit vs Anytype/Obsidian. Fixing it is a table-stakes credibility gap (gap matrix: TS).

## Decision to make
What is the canonical export format, and is it also the re-import format (round-trippable)?

## Options
1. **Markdown-with-frontmatter (notes) + JSON sidecar (captures, links, tags, collections).** Obsidian-compatible for notes; JSON preserves the relational/enrichment layer. Round-trippable via existing import parsers.
2. **Single JSON document (full fidelity, not human-portable).** Easiest, but doesn't satisfy the "leave anytime, lose nothing in a standard format" promise.
3. **Both:** markdown+frontmatter zip for portability + a full JSON backup for fidelity.

## Recommendation
Option 3 (markdown+frontmatter zip as the portability story, full JSON as the backup/restore story). Notes stored as HTML today (audit §6) → requires an HTML→markdown conversion step; flag conversion fidelity as a risk to verify in the ship gate.

## Consequences
- The frontmatter keys + JSON schema are a public contract; changing them later breaks anyone's automation.
- HTML→markdown lossiness must be measured (tables, embeds).
- Enables Phase 1.4 and de-risks the sovereignty conflict (#2) without committing to local-first.

## Open question for operator
Approve Option 3? Any required frontmatter keys / compatibility target (strict Obsidian vault compatibility, or Nexalog-flavored)?
