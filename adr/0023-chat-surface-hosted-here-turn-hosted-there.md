# ADR-0023 — The chat surface: Nexalog hosts the surface, one chat port hosts the turn

- **Status**: Accepted
- **Accepted**: 2026-09-28 (operator-authorized M5 close-out)
- **Date**: 2026-09-28
- **Phase**: M5 (chat with the brain)
- **Owner**: orchestrator
- **Supersedes**: the exclusivity clause of ADR-0017 is already retired; this
  ADR records the revised boundary in force (`no PROVIDER calls`, not
  `no LLM calls`) and the port that expresses it
- **Related**: ADR-0014 (intelligence port + adapter contract), ADR-0017
  (retire "intelligence routes exclusively through Plexo"), ADR-0003
  (embeddings/clustering ownership)

## Context

Nexalog shipped a `/app/brain` reader that offered an "Ask about this page"
control, DISABLED, with the reason stated: chat with the brain was a later
milestone. M5 is that milestone.

The premise it ran into is a recorded rule: "Nexalog makes no LLM calls." That
absolute is a stale post-§1.7 snapshot. ADR-0017 retired the exclusivity clause
and replaced it with tiered resolution behind stable ports; the surviving
requirement is narrower and it is the one that actually protects the system:

> Nexalog makes no **provider** calls of its own. It does not speak to a model
> vendor, it does not hold a vendor SDK, and it does not produce embeddings.

That distinction is not cosmetic. The thing it protects is the 1024-dim pgvector
invariant (ADR-0003): a second embedding path in this app would write vectors
that gbrain's HNSW index does not expect, and the failure is silent — retrieval
just gets worse.

Two further facts constrain the design:

- **The turn is not the surface.** An agent turn — tool loops, retrieval,
  writeback — is a runtime. Duplicating one inside Nexalog would create a second
  retrieval path and a second writeback path, i.e. exactly the divergence the
  embedding rule exists to prevent.
- **Precedent says where content lives.** `chat_messages` exists in the ORM
  schema and is unreachable by construction (`/api/search` is a closed
  hand-written union with no dynamic table discovery), and ~4,100 `ideas` rows
  are unreachable for the same reason. A new content table in this app is
  invisible to every retrieval leg the moment it is created.

## Decision

**Nexalog hosts the SURFACE. Something else hosts the TURN. They meet at ONE
port.**

1. **One chat port** (`ChatRuntime`, `packages/core/src/ports/index.ts`). It has
   three methods' worth of surface in one call: `streamTurn(request)` yielding
   `delta` / `done` / `error`. Adapters are the endpoints that already speak the
   OpenAI-compatible streaming wire — the Hermes agent endpoint (the decided
   deployment: it owns the agent loop, tools and writeback, and continues a
   session through its own header) and the LiteLLM gateway (the standalone
   tier). ONE adapter (`OpenAiCompatChatRuntime`) satisfies the port for both:
   they differ in a base URL, a key and at most one header, and the decision
   that matters is made in the composition root, never in a feature.

2. **Retrieval stays in gbrain, via the EXISTING MCP adapter.** A turn's context
   is assembled from the cheap, zero-LLM memory verbs in a measured order:
   `context_pack(entities=scope, budget_tokens=600)` → `recall(query=turn,
   entity=scope, budget_tokens=1200)` → exact-token turns use `search`,
   concept/landscape turns use `query` → `volunteer_context(window=last 3
   turns)` capped at 3, gate 0.7 → expand the top 5 hits with `get_page`.
   `traverse_graph` runs FIRST only for a relationship question (the live
   brain's typed links are sparse). `synthesize` / `think` are background-only
   and never in-turn. Nexalog produces no embeddings and writes no vectors.

3. **Citations are resolved by the SERVER, through the existing mapper.** A
   citation is `{href, slug, title, via}` where `href` comes from
   `apps/web/lib/search/result-href.ts`. There is deliberately no second href
   mapper: four call sites once each derived a route from a row's `kind` and
   every brain page the app could find 404'd on click. The milestone's gate is
   "a citation target that opens", so the route is produced where the slug is
   known and the client never interprets an id.

4. **A chat session is a presentation object, in process memory — no new
   table.** It holds the rail's turn list and the rolling window
   `volunteer_context` reads. It is bounded (LRU over sessions, a turn cap per
   session) and its non-durability is stated in the surface (`SESSION_STORE_NOTE`).
   Durable content is unaffected: it lives in the brain repo and gbrain.

5. **Honest degradation is a first-class state, not a fallback.** The surface
   reports TWO legs independently (`turn`, `brain`). A working turn leg with a
   dead retrieval leg is `ready` and NOT `grounded` and says so, because that is
   the state in which an answer looks grounded and is not; a single `available`
   boolean cannot express it. When no turn leg is configured, the surface shows
   NO composer and a typed 503 names the missing env var — never an empty chat
   that looks like it works.

## Consequences

- **Pro**: the port is swappable without touching the surface. Replacing the
  Hermes endpoint with a local model, or with a different agent runtime, is a
  composition-root change.
- **Pro**: the embedding invariant is structurally safe — the app cannot write a
  vector because nothing here produces one, and retrieval only ever calls
  gbrain's tools.
- **Pro**: no new table, and therefore no new unreachable content store; the
  failure mode the `ideas`/`chat_messages` precedent describes is not re-created.
- **Con**: sessions do not survive a restart. Accepted — a scrollback is not a
  fact, and the alternative (a table invisible to search) is worse than the
  loss. Stated in the UI rather than hidden.
- **Con**: a deployment needs one more env var (`CHAT_BASE_URL`) to enable the
  surface. The unset state is deliberate and visible.
- **Con**: the answer's quality depends on the leg. The surface reports which leg
  answered as data (`meta.leg` / `meta.model`) so a difference is diagnosable
  rather than mysterious.

## Alternatives considered

- **Embed an agent loop in Nexalog.** Rejected: it duplicates retrieval and
  writeback, which is the divergence the embedding rule exists to prevent, and it
  needs tools gbrain already owns.
- **Call a model provider directly from the route.** Rejected: a provider SDK in
  the app is what the revised boundary forbids, and it puts model credentials
  where they do not belong.
- **Persist sessions in a new table.** Rejected: a content table in this app is
  unreachable by `/api/search` by construction (the `chat_messages` precedent),
  and durable content already has a home.
- **Let the client build citation URLs.** Rejected: it is the exact defect that
  404'd every brain search hit, and it puts the route contract in the browser
  where it cannot be verified server-side.
