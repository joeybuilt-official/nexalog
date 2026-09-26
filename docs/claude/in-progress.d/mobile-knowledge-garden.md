---
id: mobile-knowledge-garden
title: Native Knowledge Garden surface (/app/graph) — tokens landed, surface missing
status: open
area: platform
branch: feat/mobile-knowledge-garden-tokens
order: 5
---

**Split from the token port, because only half of it shipped.** The 2026-09-26 token PR landed the
mobile half of the web's Knowledge Garden *design system* — `mobile/lib/src/theme/knowledge_garden_tokens.dart`
(the `--t-*` palette plus the base tokens as a `ThemeExtension`, transcribed hex-for-hex from
`apps/web/app/globals.css`), the pure type→colour mapping that folds the dual spelling
(`people` from a seed's slug segment / `person` from a page's frontmatter type) exactly as
`apps/web/lib/graph/filters.ts` does, unit tests, and `mobile/test/no_hardcoded_colors_test.dart` —
a gate that fails when a colour literal appears under `mobile/lib` outside the token file. See
`docs/claude/platform/mobile/parity.md` §4.2 for the port, its verification, and its honest limits.

**What did NOT ship, and is this task:** the garden itself. `docs/claude/platform/mobile/parity.md`
row 13 — `/app/graph` — is still **Missing**: no mobile screen, no route, **no `/api/graph` caller**
in `mobile/lib`. The signature v2 surface does not exist on mobile; what exists now is the palette it
must be drawn with.

**Next step:** this is a §1 parity-gate item that needs a decision before code — `parity.md` §6 D4
item 4 states the options plainly: build a native garden surface, or record a deferral, which *is* a
parity-gate exception and needs the operator. If it proceeds, the shape is: (a) confirm the
`/api/graph` payload contract against `apps/web/app/api/graph/`, (b) decide the mobile renderer
(CustomPaint vs. a graph package — note `mobile/pubspec.yaml` has no chart/graph dependency, so
adding one needs the dependency justification), and (c) carry the web's **degraded** state honestly
the way `graph-canvas.tsx` does (`data.degraded`, `note`, the `tone: "warning"` notice) rather than
rendering an empty canvas. Offline-first applies: the garden is a read surface, so say why a
mirror-backed path is or is not possible (`parity.md` §4.3).
