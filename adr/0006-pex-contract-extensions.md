# ADR-0006 — Jex contract extensions (the `[X]` prerequisite items)

> **Rename note (2026-07-02, U9):** the integration protocol formerly called "Pex" is renamed **Jex** — a Joeybuilt-level mesh protocol (Plexo is one node, not the hub). File name keeps `pex` to preserve links.

**Status:** Proposed — **operator approval required before Phases 3.2 / 3.4 / 3.5.**
**Date:** 2026-06-13 · **One-way door:** the Jex contract shape (every endpoint added is a durable cross-app commitment).

## Context
Several moat capabilities are blocked not on Nexalog work but on **Jex-protocol gaps** — capabilities Plexo does not yet expose (audit §2). Per the plan's rule, no Nexalog phase may depend on an unbuilt `[X]` unless its Plexo-repo prerequisite is scheduled first. This ADR collects them so they're decided as one contract evolution rather than smuggled in piecemeal.

## The `[X]` items
| Capability | Blocks | Current state |
|---|---|---|
| **Salience / surfacing** verb ("rank these items by relevance-to-now for this user") | Phase 3.2 | no Plexo verb at all — the marquee moat primitive |
| **Transcription** (Deepgram via Jex) | Phase 3.5 | `/api/voice` uploads to R2, never transcribes |
| **Graphiti node-merge** | Phase 3.4 | only read-only `/graph/cypher` exists |
| `memory/embeddings` (write) + `memory/cluster/compute` | Phase 3.3 (Path A branch) | both 404; Path B works around them |

## Decision to make
Which `[X]` endpoints get built in the Plexo repo, in what order, and what is each one's contract shape? These are Plexo-side work items that gate the corresponding Nexalog phase.

## Recommendation
Sequence by moat ROI vs cost:
1. **Salience verb** (unlocks 3.2 — the single biggest differentiator; "the right note finds you").
2. **Transcription** (unlocks 3.5 — table-stakes capture + Tana-style win).
3. **Node-merge** (unlocks 3.4 — quality, lower urgency).
4. **embeddings/cluster write** — only if ADR-0003 chooses Path A/hybrid; otherwise Path B stands and these can stay deprecated/deleted.

Each endpoint, once shipped, is a contract: version it; don't break the payload shape.

## Consequences
- Cross-repo coordination: these are Joeybuilt-Plexo-monorepo work items, not Nexalog ones — track them as explicit prerequisites with their own gates.
- Defines how far "Plexo owns intelligence" reaches into Nexalog's surfaces.

## Open question for operator
Approve building #1 and #2 first? Is there capacity/authorization to schedule Plexo-repo work, or should moat phases that depend on `[X]` be parked until then?
