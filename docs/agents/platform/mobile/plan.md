# Plan: Mobile — visual identity and surface parity

- **Area:** `platform`  ·  **Started:** 2026-10-01  ·  **Status:** In progress
- **Owner:** the operator — visual standard is his call
- **Next step:** The token→`ColorScheme` mapping is written in
  `mobile/lib/src/theme/app_theme.dart` (`nexalogColorScheme`). Next: run
  `flutter analyze` + `flutter test` in the mobile container, then walk the existing screens
  replacing any `Theme.of(context).colorScheme` reliance that still reads Material's defaults,
  starting with `features/today/today_screen.dart`.
- **Roadmap initiative:** [`../../roadmap.md`](../../roadmap.md) — carries into the Plexo-moat arc
- **Parent plan:** none

## Goal

The operator installs the Android app and it reads as the same product as the web app — same paper/ink
palette, same accent, same type colours — rather than "an amateur wireframe from the 90s". Concretely:
no widget on any shipped screen draws a colour that the Knowledge Garden token set did not choose, and
the surfaces the web app has that mobile lacks are either built or recorded as a decision.

How we will know it worked: `mobile/lib/src/theme/app_theme.dart` no longer calls
`ColorScheme.fromSeed`; `flutter test test/no_hardcoded_colors_test.dart` is green; and the operator
confirms by eye on a signed APK that the app matches the web app's identity.

**Out of scope:** any new colour invented for mobile (the design authority is
`apps/web/app/globals.css`); the Play Store listing copy and screenshots; iOS; and any change to the
web app's own palette. A token the web does not define is a web change and a decision, not a guess
here.

## Context

Two distinct gaps, and they are worth separating because they have different fixes:

1. **Identity — the design system exists but is not applied.** The Knowledge Garden token layer was
   ported in 2026-09-26 (`theme/knowledge_garden_tokens.dart`, both light and dark, plus the pure
   type→colour mapping and a hardcoded-colour gate). But `buildNexalogTheme` still calls
   `ColorScheme.fromSeed(seedColor: kCopper)`, so Material's tonal algorithm picks `primary`,
   `surface`, `error` and every container tone — and Material widgets read the *scheme*, not the
   extension. The tokens rode alongside as a `ThemeExtension` that most widgets never consult. That is
   the mechanism behind the operator's complaint.
2. **Surfaces — 14 of 20 tracked surfaces are Partial and 4 are Missing.** Full inventory and
   per-surface detail: [`parity.md`](parity.md). The largest absences are `/app/projects`,
   `/app/graph` (the signature Knowledge Garden surface), `/app/brain`, `/app/chat`, `/app/proposals`.

Constraints that rule out the obvious approach:

- **The web is the design authority.** `apps/web/app/globals.css` is the only live design source
  (`docs/design/direction.md` does not exist in any ref). Mobile does not get to invent tokens.
- **`--color-*: initial` on web means some web classes resolve to nothing.** Two sites
  (`text-green-500` in the review page, `bg-blue-100` in the review card) have no real colour on web.
  Mobile renders those through Material semantic roles; porting them literally is impossible and
  inventing a token is not allowed.
- **Parity work is gated by `adr/0020-mobile-v2-parity-gate.md`**, which is still *Proposed* — so a
  Miss is a recorded gap, not a breached rule.

## Architecture

- **Layers touched:** Frameworks & Drivers only for the identity work — `app_theme.dart` is the
  composition root that builds `ThemeData`. No domain or use-case file changes. Surface work will add
  Interface Adapters (screens/repos) and, where a route does not exist yet, an adapter call.
- **New ports (interfaces):** none. The identity change is a pure mapping function
  (`nexalogColorScheme`) from an existing value type to an existing framework type.
- **Boundary data:** none crossing a boundary. `KnowledgeGardenTokens` is a UI-layer value type already
  local to `lib/src/theme/`.
- **Dependency direction:** unchanged and inward. The mapping is pure and framework-local; it imports
  no IO, no network, no storage.
- **Swap test:** swapping Flutter's Material theming stays inside `lib/src/theme/`. No screen file
  appears in that diff.

## Milestones

1. **Identity: tokens become the actual `ColorScheme`.** Replace `ColorScheme.fromSeed` with an
   explicit mapping from the garden tokens; keep Material's own `error` so a failure state is never
   mistakable for a brand action. *(This change.)*
2. **Identity: screens audit.** Walk each shipped screen and remove reliance on Material defaults
   where a garden token is the correct source; keep the hardcoded-colour test green.
3. **Surfaces: operator-prioritised.** Projects first (it is the newest web surface and the one the
   operator is actively using), then `/app/graph`, then brain/chat/proposals as separate batches.
4. **Delivery.** A pushd-signed APK on a version tag so the operator installs a real build and judges
   it by eye — the only acceptance test that matters here.

## Deletion candidates

The Algorithm pass owes an artifact, and for this work the honest answer is that **most of the
candidate set SHOULD be deleted** — the temptation here is to port things faithfully that a phone
should not carry at all.

| Candidate | Removed? | Why |
|---|---|---|
| `ColorScheme.fromSeed` in `buildNexalogTheme` | **yes** | It is the defect. It generates a whole palette from one hue, which is precisely how a token-driven design system ends up looking like stock Material. Deleting it is the change. |
| The garden tokens as a *parallel* `ThemeExtension` read only by opting-in widgets | **yes** | Kept registered for direct token access, but no longer the only route to the palette. Two sources of colour truth is the bug; one is the fix. |
| Inventing a mobile-only `error`/success/info token | **no — refused** | Material needs `error`; the garden set does not define one. Taking Material's default keeps a failure state distinct from the brand. Defining a Nexalog one would be a colour the design system never chose — the operator's decision, not the agent's. |
| A second accent hue for Material's `secondary` slot | **no — refused** | Material expects `secondary` ≠ `primary`. The web uses ONE accent. Inventing a hue to fill a framework slot is exactly the "detail escapes into the design" failure; `secondary` mirrors `accent`. |
| Porting `text-green-500` / `bg-blue-100` from web as literal colours | **no — impossible** | The web's `--color-*: initial` means those classes resolve to nothing. There is no value to port, and mobile already renders them via semantic roles. If web wants success/info tokens, that is a web change. |
| A native `/app/graph` garden surface in THIS batch | **yes (deferred, previously recorded)** | Row 13 stays deferred by operator decision (2026-10-01). The token system it draws with is the prerequisite and now exists; the surface is its own milestone, not a rider on the identity fix. |
| The Play Store screenshots/listing polish | **yes (deferred)** | Not asked for; it is marketing work with its own inputs (copy, store assets) and would be scope creep on a visual-identity fix. |
| Building all 14 Partial surfaces in one pass | **yes (refused)** | A 14-surface PR cannot be reviewed, cannot fail cleanly, and would be the single most expensive thing to undo. Operator-prioritised, one batch at a time. |
| **The whole request** | **no** | The operator's complaint is specific and the diagnosis is confirmed in code (`fromSeed` + unapplied tokens + 4 missing surfaces). Deleting it would leave an app he cannot use comfortably — rejection not warranted. |

## Open questions

- **Which surfaces does the operator actually want next, in what order?** Asked 2026-10-01; the
  clarify call recorded the APK answer and timed out on the other two, so the agent took the
  documented defaults (identity first; follow web but allow richer native feel). Reversible.
- **Does the web want a success/info token?** Two web sites currently have no real colour. That is a
  web decision.
