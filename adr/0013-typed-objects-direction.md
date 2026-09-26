# ADR-0013 — Typed objects + block transclusion direction

- **Status**: Proposed
- **Date**: 2026-06-27
- **Phase**: P7..P10
- **Owner**: orchestrator (audit-driven)
- **Supersedes**: clarifies ADR-0004 (knowledge structure), ADR-0008 (ideas
  taxonomy)
- **Related**: audit-2026-06-27 §3 T3

## Context

ADR-0004 named the direction (typed objects beyond notes). ADR-0008 shipped
the *first* typed family (ideas, with `ideas.graphEpisodeId` reserved for a
graph integration that never landed). The audit found:

- `ideas.graphEpisodeId` (`lib/db/schema.ts:619`) is **dead** — zero
  readers, zero writers, the migration comment promised graphiti ingestion
  that was never wired (`drizzle/0017_ideas.sql:35`, ADR-0008:72).
- The graph view (`app/(app)/app/graph/*`) is **purely visual** — a d3
  projector over Plexo themes-forest. Chat + search do not call `/api/graph`.
- Tiptap supports block IDs in the editor but there is **no transclusion
  resolver** — no `/api/notes/[id]/blocks/[blockId]` endpoint, no embed
  node.
- No spaced-review schema, no SR scheduler.

The mission asks: "make the graph load-bearing or de-emphasize it."

## Decision

### Three depth bets, executed in this order

#### 1. Spaced review (P7)

Smallest user value relative to scope. Ships first because it does not
depend on typed objects landing.

Schema:

```sql
CREATE TABLE review_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    text NOT NULL,
  user_id         text NOT NULL,
  source_kind     text NOT NULL,  -- 'note' | 'capture' | 'idea'
  source_id       text NOT NULL,
  state           text NOT NULL,  -- 'new' | 'learning' | 'review' | 'lapsed'
  due_at          timestamptz NOT NULL,
  interval_days   integer NOT NULL DEFAULT 0,
  ease            real NOT NULL DEFAULT 2.5,
  lapses          integer NOT NULL DEFAULT 0,
  last_reviewed   timestamptz,
  UNIQUE(workspace_id, source_kind, source_id)
);
CREATE INDEX review_queue_due_idx
  ON review_queue(workspace_id, user_id, due_at);
```

Scheduler: **SM-2 derived** (anki-flavoured), 4 buttons (again/hard/good/
easy). Not FSRS — SM-2 is the lazier win and is ~50 lines; FSRS adds a
params-tuning surface we cannot justify without engagement data.

Surface: `/app/review` daily card showing N due items; per-item show note
front + reveal back (note body or capture excerpt).

#### 2. Block transclusion (P8)

Tiptap node: `<NoteEmbed noteId="..." blockId="..." />`. Resolver:
`GET /api/notes/:id/blocks/:blockId` returns the block's HTML/markdown
fragment. Block IDs are already minted by the editor (`components/editor/
extensions/block-id.ts` — confirm in P8).

Why now (post P7): transclusion without a review surface is more
decorative than load-bearing. Once review exists, transclusion enables
"flashcard sources" without duplication.

#### 3. Typed objects, generalised (P9)

Generalise the ideas-table shape into:

```sql
CREATE TABLE typed_object_kinds (
  workspace_id text NOT NULL,
  kind         text NOT NULL,
  schema_json  jsonb NOT NULL,
  icon         text,
  PRIMARY KEY (workspace_id, kind)
);

CREATE TABLE typed_objects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  text NOT NULL,
  kind          text NOT NULL,
  data          jsonb NOT NULL,
  fts           tsvector GENERATED ALWAYS AS
                  (to_tsvector('english', coalesce(data->>'title',''))) STORED,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  FOREIGN KEY (workspace_id, kind)
    REFERENCES typed_object_kinds(workspace_id, kind)
);
```

A `typed_object_kind` is a user-defined kind (e.g. "Book", "Person",
"Meeting"). `data` is JSON validated against `schema_json` (Effect Schema
at the boundary). Migration is **one** table-pair, not per-kind.

`ideas` stays its own table (legacy) but is **viewable** as a typed-object
kind in the UI via a thin projection.

#### 4. Graph decision (P10)

Default decision: **de-emphasise to a sidebar gadget; drop dead schema**.

Reasoning:
- The graph view doesn't drive retrieval today.
- `ideas.graphEpisodeId` has been dead for a year of audit-history.
- Wiring graphiti pulls in a service dependency and ingest pipeline for
  user value that is currently zero.

Execution: drop the `/app/graph` route promotion (keep the page reachable
via a Themes sidebar tile); add a drizzle migration to drop
`ideas.graphEpisodeId`. Migration is **operator-gated** to apply.

Escape hatch: if the operator decides during P10 that they want graphiti
wired instead, swap to a "wire ingest" task — but it is a separate ADR at
that point.

### Why typed-objects after transclusion, not before

ADR-0004 + ADR-0008 already establish *that* we want typed objects. The
practical question is *which surfaces force the generalisation*. Spaced
review (P7) does fine with notes/captures/ideas. Transclusion (P8) doesn't
require typed objects. By P9, real user data will show which kinds matter
(Book? Person? Project?) and we shape the kinds JSON-schema to that.

Shipping the typed-objects framework before transclusion means designing
the JSON schema in the abstract — premature abstraction (ladder rung 1).
Two real cards' worth of P7+P8 user feedback shapes P9 better.

## Consequences

- **Pro**: each step is independently shippable on web + mobile.
- **Pro**: dead schema (`graphEpisodeId`) is finally either honoured or
  removed, not perpetually deferred.
- **Pro**: SM-2 is the simplest review algorithm that works.
- **Con**: typed-objects after transclusion delays power-user value of
  e.g. "Book" entities by one phase. Acceptable — early users have Notes
  + Ideas + Captures already.

## Alternatives considered

- **Wire graphiti first**: rejected — high-cost, low-visible-value path
  given the audit shows zero graphiti dependency in retrieval. Reconsider
  when there's a concrete user ask.
- **FSRS scheduler**: rejected over SM-2 — needs tuned params per user and
  more code; defer until SM-2 engagement data justifies it.
- **Typed objects first**: rejected — premature abstraction without P7+P8
  shipping to inform the kinds schema.

## Operator decisions still required

- Ratify de-emphasise path for the graph (vs wire-graphiti).
- Approve `review_queue` migration before P7 commits.
- Approve `typed_objects` + `typed_object_kinds` migration before P9
  commits.
- Approve drop-`graphEpisodeId` migration before P10 commits.
