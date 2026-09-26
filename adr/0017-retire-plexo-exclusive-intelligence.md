# ADR-0017 — Retire "intelligence routes exclusively through Plexo"

- **Status**: Accepted
- **Accepted**: 2026-07-02 (operator-authorized full-spec close-out)
- **Date**: 2026-07-02
- **Phase**: U8 (ADR governance)
- **Owner**: orchestrator
- **Related**: ADR-0014 (intelligence port), ADR-0015 (adapter mesh protocol)

## Context

Nexalog's original standard (AGENTS.md) mandated that all AI be routed through
Plexo — no direct provider SDK or API calls. U7 shipped a tiered
port-and-adapter architecture (ADR-0014/0015) whose embedded adapter calls the
provider directly, contradicting the recorded rule. The recorded rule and the
shipped code must agree.

## Decision

Retire the rule "intelligence routes exclusively through Plexo." Replace it
with tiered resolution behind stable ports (per ADR-0014):

1. **Embedded** (always present): direct provider call or local fallback. The
   app is fully functional and best-in-class standalone, with zero siblings and
   zero Plexo installed.
2. **Federated** (Plexo installed + user-authorized): a Plexo adapter
   supersedes the embedded adapter behind the same port, adding memory, agents,
   cross-provider routing, and shared LLM connections.
3. **Cross-app** (sibling installed + authorized): sibling-context adapters
   register behind the same port.

## Rationale

- Every app must be best-in-class standalone. Plexo enriches when present and
  authorized; it is never a baseline dependency.
- Quality lives in the embedded tier. A feature that only works with Plexo is a
  federation bonus, scoped as such — it must not gate standalone quality.
- LLM credentials live at the highest available layer: configured once in Plexo
  when present and exposed via the federated adapter; otherwise the app holds
  its own key in its own config.
- App domain code never knows which adapter answered.

## Reference sites of the old rule updated by this ADR

- `AGENTS.md:17` — "All AI routed through Plexo via Pex — no direct
  OpenAI/Anthropic SDK"
- `AGENTS.md:35` — "No direct AI SDK imports … all intelligence via Plexo Pex"
- `lib/plexo.ts`
- `lib/projects/domain.ts`
- `adr/0006-pex-contract-extensions.md`

## Out of scope

Renaming the integration protocol (Pex → Jex) is handled by a separate unit
(U9), not this ADR.
