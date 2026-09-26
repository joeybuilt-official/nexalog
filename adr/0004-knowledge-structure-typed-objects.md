# ADR-0004 — Knowledge structure: opaque-text vs typed objects

**Status:** Proposed — **operator approval required before the typed-object branch of Phase 2.3.**
**Date:** 2026-06-13 · **One-way door:** the atomic-unit / schema model. Migrating a typed-object model is a bespoke ETL once users have data.

## Context
Nexalog's atomic unit is **derived, not modeled** (audit §3): `notes` and `capture_sources` are opaque text blobs; structure is regex/LLM-classified out of text. This sits at the Obsidian/markdown end. The field's structured end (Anytype typed objects + relations, Tana supertags, Notion databases) offers far more query power.

**The conflict (gap matrix #4, INVERTED adoption risk):** Tana lost 41% of users in 6 weeks to supertag *complexity*. Cartographer's audit finding is that Nexalog's risk is the *opposite* — too shallow (15 authored notes vs 3564 bookmark-twins). Adding a typed-object layer could re-import Tana's complexity tax onto a product whose actual problem is "no reason to return."

## Decision to make
Do we introduce a typed-object/relations layer at all — and if so, when (before or after the moat proves retention)?

## Options
1. **Stay opaque-text; deliver DB views over the existing model** (Phase 2.3 default — no ADR needed, reversible). Lowest risk; caps the structural ceiling.
2. **Introduce typed objects/relations** (Anytype-style). High power; one-way door; complexity-tax risk on a shallow-usage product.
3. **Defer the decision** until the moat (Tier 3) demonstrates retention; revisit with usage data.

## Recommendation
Option 3 → then 1 if/when needed. Do **not** build typed objects before retention is proven; the audit says the bottleneck is return-reason, not structural power. Cross into Option 2 only with explicit operator approval and a concrete user pull.

## Consequences
- Phase 2.3 ships views over the current model with no schema commitment.
- Keeps the door open without paying the one-way cost prematurely.

## Open question for operator
Ratify "defer typed objects; ship views over opaque-text first"? Or is structured modeling a product requirement you want sequenced earlier?
