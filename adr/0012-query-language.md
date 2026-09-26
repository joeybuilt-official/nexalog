# ADR-0012 — Query language for saved smart-views

- **Status**: Proposed
- **Date**: 2026-06-27
- **Phase**: P4
- **Owner**: orchestrator (audit-driven)
- **Related**: audit-2026-06-27 §3 T2

## Context

Search today is a single string + tag/kind facets in the UI. There is no
DSL, no saved views, no scaffolding for "show me all unread videos from
@kind:watch added in the last 7d tagged #ai". As the corpus grows past a
few hundred items, single-string + facets stops scaling.

The PKMS prior art:
- **Obsidian**: Dataview (mini-SQL-ish).
- **Logseq**: Datalog queries.
- **Tana**: explicit query builder UI.
- **Reflect / Mem**: AI-driven search (no DSL).

We are not Datalog. We are also not "just LLM it" — we already have RRF +
FTS + pgvector; a learnable DSL on top of that infrastructure beats either
extreme.

## Decision

### A tiny query grammar (`niql` — Nexalog Inline Query Language)

EBNF:

```
query    ::= clause (WS clause)*
clause   ::= ("-")? (filter | term)
filter   ::= field ":" value
field    ::= "kind" | "tag" | "in" | "before" | "after" | "has" | "from"
value    ::= bareword | quoted
term     ::= bareword | quoted | "[[" wikilink "]]"
```

Examples:

- `kind:watch tag:ai -has:transcript before:2026-06-01`
- `from:project:second-brain [[second brain]] kind:note`
- `kind:capture has:audio after:2026-06-20`

The grammar:
- Is line-noise free for "just type" users — bare words become FTS terms,
  no DSL pollution.
- Is small enough to **parse with a 40-line regex split** — no parser
  generator dep. (Ladder rung 6.)
- Maps 1:1 to existing search filters; a clause becomes a SQL `AND`.

### Saved views = `query_views` table

```sql
CREATE TABLE query_views (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   text NOT NULL REFERENCES workspaces(id),
  user_id        text NOT NULL,
  name           text NOT NULL,
  query          text NOT NULL,
  icon           text,
  sort_order     integer DEFAULT 0,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);
CREATE INDEX query_views_workspace_user_idx
  ON query_views(workspace_id, user_id, sort_order);
```

Surface:

- `/app/today` — "Smart views" rail under the daily brief.
- `/app/search` — save current query as view.
- Mobile parity card on Today.

### Parsing module — `lib/query/parse.ts`

Pure function `parseNiql(input: string): NiqlClause[]`. Returns clauses; the
existing search handler maps clauses → SQL/RRF inputs. **No new search
backend**; the DSL is a frontend onto the existing RRF retrieval.

### Why not Lucene / Linq / PEG?

- Lucene grammar is overkill (group/boost/fuzzy operators we won't honour).
- PEG/parser-generator adds a build-time dep and a 5KB+ runtime; we don't
  need ambiguity recovery, we control the grammar.
- Linq-ish C#-style would be over-engineered for "find my notes".

40-line regex tokeniser → typed clauses → existing search filter shape. One
line of behaviour per clause.

### LLM fallback

When a query returns < 3 results, render an "Ask AI" link that runs the
same query through chat-grounding (which already uses RRF post-M2). This
**does not** auto-rewrite the user's query — that's a trust antipattern.

## Consequences

- **Pro**: saved views finally let power users carve their backlog into
  named lenses.
- **Pro**: zero new search backend — DSL is a parser onto today's RRF.
- **Pro**: degrades gracefully — typing a single word still works as before
  (bare words become FTS terms).
- **Con**: any future search backend change requires updating both the
  parser-to-filter map and the search route. Mitigation: extract a single
  `applyClauses(clauses, baseQuery)` function in `lib/search/`.
- **Con**: small UX risk that users discover the colon syntax accidentally
  and get confusing errors. Mitigation: unknown fields fall through as bare
  text terms.

## Alternatives considered

- **AI-only natural-language search** (Mem/Reflect): rejected — opaque, hard
  to debug, expensive per query, no saveable view shape.
- **Tana-style explicit query builder UI**: deferred — chips above the search
  bar can grow into this later; ship the DSL first because it's the lazier
  win and powers the UI either way.
- **Dataview-style multi-line block queries** embedded in notes: rejected —
  doubles editor complexity and we don't have block-level evaluation
  semantics. Revisit after P8 (block transclusion).

## Operator decisions still required

- Approve `query_views` migration before P4 commits.
- Confirm field names (kind/tag/in/before/after/has/from) — alternative
  proposals welcome before the parser is reused beyond P4.
