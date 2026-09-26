# ADR-0014 — Intelligence port + adapter contract

- **Status**: Accepted
- **Accepted**: 2026-07-02 (operator-authorized full-spec close-out)
- **Date**: 2026-07-02
- **Phase**: U7 (intelligence + identity ports)
- **Owner**: orchestrator
- **Supersedes**: extends the informal port in `lib/projects/domain.ts`
- **Related**: ADR-0015 (mesh protocol), ADR-0016 (passkey identity root)

## Context

A single concrete intelligence port exists today (`ProjectIntelligencePort` in
`lib/projects/domain.ts`) with one implementation (`lib/plexo.ts`). The pattern
is correct but:

- The port is narrow (one method, one domain).
- There is no embedded fallback — if Plexo is absent the app cannot call AI at all.
- The "port" is an informal TypeScript interface; there is no adapter registry or
  resolution mechanism. Consumers import a concrete Plexo function directly in
  several routes.
- Future surfaces (chat, search, resurfacing) each hand-wire Plexo calls.

The goal: every intelligence capability the app uses must flow through a typed
port. Two adapters satisfy that port: an **embedded** adapter (works with any
OpenAI-compatible endpoint, no Plexo required) and a **Plexo federated**
adapter (delegates to the Plexo SDK, supersedes embedded when Plexo is healthy).
App domain code never imports an adapter directly.

## Decision

### Port contract (`lib/intelligence/port.ts`)

One `IntelligencePort` interface covers all intelligence capabilities the app
currently uses:

```ts
export interface IntelligencePort {
  /** Text completion / chat turn. */
  complete(req: CompleteRequest): Promise<CompleteResponse>;

  /** Dense embedding for a text chunk (384-d, L2-normalised). */
  embed(text: string): Promise<number[]>;

  /** Project-scoped brainstorm turn (replaces ProjectIntelligencePort). */
  brainstorm(req: BrainstormRequest): Promise<{ reply: string }>;
}
```

`ProjectIntelligencePort` in `lib/projects/domain.ts` is kept as a
domain-scoped alias (`brainstorm` only) for backward compatibility; it delegates
to `IntelligencePort`. No domain file imports an adapter.

### Embedded adapter (`lib/intelligence/adapters/embedded.ts`)

Calls any OpenAI-compatible `INTELLIGENCE_API_URL` (default: Plexo's bundled
ONNX server at `plexo-embeddings:3001`; in local dev: any local
Ollama/OpenAI endpoint). Uses `fetch` directly — no SDK dependency. Fully
functional with zero external services beyond the LLM endpoint. This is the
**default**: if no Plexo adapter registers itself, the embedded adapter handles
all calls.

```
INTELLIGENCE_API_URL   — OpenAI-compatible base (required in standalone mode)
INTELLIGENCE_MODEL     — default model name (e.g. "gpt-4o-mini", "llama3")
```

### Plexo federated adapter (`lib/intelligence/adapters/plexo.ts`)

Wraps `lib/plexo.ts` (existing facade). At startup the adapter performs a
health check (`GET ${PLEXO_API_URL}/health`); if healthy it registers itself
via the mesh protocol (ADR-0015) to supersede the embedded adapter. App code
sees no change — the port is the same. The adapter also passes workspace
context to Plexo so LLM connections configured in the Plexo UI appear
automatically in the app.

### Resolution order

1. On startup `lib/intelligence/index.ts` exports a `getIntelligence()` fn.
2. `getIntelligence()` returns the registered adapter (Plexo if registered,
   embedded otherwise).
3. Adapter registration happens in `lib/intelligence/mesh.ts` (ADR-0015).
4. Server components and route handlers call `getIntelligence()` — never a
   concrete adapter path.

## Consequences

- **Pro**: standalone mode works with just `INTELLIGENCE_API_URL` pointing at any
  local LLM.
- **Pro**: Plexo adapter swaps in without any app domain change — the swap is
  invisible to callers.
- **Pro**: future adapters (a different federation layer, a local model server)
  register the same way.
- **Con**: one migration cost: routes that today import `lib/plexo.ts` fns
  directly must be updated to `getIntelligence()`. Mechanical search-and-replace.
- **Con**: `embed()` returns a fixed 384-d vector; if the embedded and Plexo
  adapters produce differently-sized vectors, pgvector indexes break. Mitigation:
  both must use the same Plexo ONNX server (384-d); the embedded adapter's
  `INTELLIGENCE_API_URL` defaults to that same server.

## Alternatives considered

- **Two separate ports (embed vs complete)**: rejected — over-engineering; one
  port with three methods is simpler and the existing `ProjectIntelligencePort`
  precedent is one interface.
- **Dynamic import / plugin registry**: rejected — startup-time registration via
  a module-level variable (ADR-0015) is simpler and has no dynamic-import
  complexity.
- **Keep lib/plexo.ts as the only adapter**: rejected — breaks standalone mode
  goal; the whole point is the embedded fallback.

## Operator decisions required

- Ratify `IntelligencePort` method surface (complete + embed + brainstorm) or
  add/remove methods.
- Confirm `INTELLIGENCE_API_URL` default (Plexo ONNX server vs dev Ollama) for
  standalone mode.
