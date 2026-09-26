# ADR-0015 — Jex protocol (adapter mesh)

> **Rename note (2026-07-02, U9):** this protocol is named **Jex** (formerly "Pex" / "adapter mesh") — a Joeybuilt-level mesh protocol; components register adapters with each other and supersede the embedded adapter behind a port. Plexo is one node on the Jex mesh, not the hub.

- **Status**: Accepted
- **Accepted**: 2026-07-02 (operator-authorized full-spec close-out)
- **Date**: 2026-07-02
- **Phase**: U7
- **Owner**: orchestrator
- **Related**: ADR-0014 (intelligence port), ADR-0016 (passkey identity)

## Context

ADR-0014 defines two adapters (embedded, Plexo) satisfying one port. We need a
lightweight mechanism for the Plexo adapter to register itself at startup and
supersede the embedded adapter — without the app knowing which is active.

Requirements:
- Zero config when standalone: embedded adapter is the default, no registration
  needed.
- Zero app-code change when Plexo registers: callers already use
  `getIntelligence()`.
- Deterministic: adapter resolves once at startup, not per-request.
- Testable: tests can inject a mock adapter via the same registration path.

## Decision

### Module-level registry (`lib/intelligence/mesh.ts`)

```ts
let _adapter: IntelligencePort | null = null;

export function registerAdapter(adapter: IntelligencePort): void {
  _adapter = adapter;
}

export function getIntelligence(): IntelligencePort {
  return _adapter ?? embeddedAdapter;
}
```

`embeddedAdapter` is the stateless singleton from
`lib/intelligence/adapters/embedded.ts`. It is the fallback — no registration
required.

### Startup registration (`lib/intelligence/startup.ts`)

A single async function `initIntelligence()` runs once at server startup
(called from the Next.js instrumentation hook `instrumentation.ts`):

```ts
export async function initIntelligence(): Promise<void> {
  if (!process.env.PLEXO_API_URL) return;          // standalone — skip
  const healthy = await checkPlexoHealth();
  if (!healthy) return;                             // Plexo down — stay embedded
  registerAdapter(plexoAdapter);
}
```

If `PLEXO_API_URL` is not set OR Plexo health check fails, the embedded adapter
remains active. No throw — graceful degradation.

### Health check

`GET ${PLEXO_API_URL}/health` with a 2 s timeout. Plexo returning 2xx →
healthy. Any error or non-2xx → not healthy. Health is checked once at startup;
it is NOT re-checked per request (restarts re-evaluate).

### Test injection

Tests call `registerAdapter(mockAdapter)` in `beforeEach` and restore via
`registerAdapter(embeddedAdapter)` in `afterEach`. No dependency injection
framework needed — the module-level variable IS the composition root for this
concern.

### "Mesh" naming rationale

"Mesh" signals that this protocol is the same seam over which future
services (a second Plexo instance, an on-device model server) would also
register. The protocol is intentionally minimal today (one slot, last-write
wins) with a clear upgrade path to a priority map if multiple adapters compete.

```
// ponytail: one-slot registry. Priority map when >1 adapter competes.
```

## Consequences

- **Pro**: ~20 lines total. No framework, no DI container.
- **Pro**: `getIntelligence()` is synchronous — callers never await the adapter
  resolution, only the intelligence call itself.
- **Pro**: cold-start cost is one HTTP health check (2 s max), amortised across
  the process lifetime.
- **Con**: a crashed Plexo mid-session is not detected — requests will fail until
  the process restarts and the health check re-runs. Mitigation: per-call error
  handling in adapters can fall back to embedded (future enhancement).
- **Con**: one-slot registry means two competing Plexo instances fight. Acceptable
  — the network should have one Plexo per mesh. Upgrade path: replace `_adapter`
  with a priority array.

## Alternatives considered

- **Per-request resolution**: rejected — async overhead per call, complex caching.
- **Environment variable switch (`ADAPTER=plexo|embedded`)**: rejected — requires
  manual config; health-check-based auto-detection is more operator-friendly.
- **Dependency injection container (tsyringe, etc.)**: rejected — a module
  variable is simpler and already proven in this codebase style.

## Operator decisions required

- Confirm health check timeout (2 s) is acceptable for startup latency.
- Confirm graceful degradation (fall to embedded on Plexo unavailable) vs hard
  fail is the right default.

## Implementation note (2026-07-02)

The shipped pilot implementation is a synchronous env-check resolver at
`lib/intelligence/resolve.ts` (priority: Plexo adapter when `plexoAvailable()`,
else embedded adapter) — NOT the `mesh.ts` registry + `startup.ts` runtime
registration described above. The registry design is deferred to the Phase-3
org-wide rollout. This is an accepted simplification for the single-app pilot,
not drift.
