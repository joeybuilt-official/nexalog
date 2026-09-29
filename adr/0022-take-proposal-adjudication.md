# ADR-0022 — Take-proposal adjudication: the queue gets an exit

- **Status**: Accepted
- **Date**: 2026-09-28
- **Phase**: P2 (resurfacing) / second-brain remediation
- **Related**: ADR-0011 (active resurfacing design), ADR-0003 (embeddings/clustering
  ownership), ADR-0017 (retire Plexo-exclusive intelligence)

## Context

gbrain's `propose_takes` cycle phase scans brain pages and writes candidate claims
into its own `take_proposals` table. Measured 2026-09-28:

| status | rows |
| --- | --- |
| pending | 170 |
| rejected | 92 |
| accepted | **0** |

Zero had ever been promoted, and the `acted_at` / `acted_by` / `promoted_row_num`
columns — designed for exactly this decision — were `NULL` on every row in the
table. The cause was not a bug: **there was no adjudication path anywhere.**

- Nexalog had no surface, no route, and no write path for proposals (grep: zero
  hits for a proposals surface in `apps/web/components` and `apps/web/app`).
- gbrain's **MCP surface** — the only gbrain endpoint Nexalog calls — exposes no
  accept verb. Its `takes_*` operations are read plus `takes_add` /
  `takes_update` / `takes_resolve`, and the deployed token's holder allow-list is
  `["world"]`, which refuses the `brain` holder that 169 of the 170 pending rows
  carry.
- gbrain's actual accept path, `gbrain takes propose --accept <id>`, exists only
  as a **local CLI** inside the gbrain container. There is no HTTP route to it.

So the only remote path to a decision is a direct connection to gbrain's
database. The alternative — "wait for gbrain to expose an HTTP accept verb" — is
the state that produced 170 pending rows and zero promotions, and it is not a
plan.

## Decision

**Accept a direct, parameterized read/write against gbrain's `take_proposals` and
`takes` tables, behind a port, and say why out loud.**

1. **A port, not a route.** `ProposalQueue` (`packages/core/src/ports/index.ts`)
   declares `list` and `act`. The rules live in pure `core`
   (`domain/take-proposal.ts`, `application/adjudicate-proposal.ts`); the SQL lives
   in the adapter (`packages/adapters/src/gbrain-proposals/gbrain-proposal-queue.ts`).
   A route holding this SQL directly would put a rule in the framework layer and
   make it untestable without a database.

2. **Claim first, then promote, in ONE transaction.** The row is claimed with a
   guarded `pending → accepted|rejected` UPDATE whose rowcount is CHECKED; only
   the claim winner promotes. Check-then-write would let two operators both pass
   the pending check and both append the take. gbrain's own accept does these as
   two steps with a best-effort compensation between them, because its step 2 is a
   **filesystem** write that cannot join its transaction; here both are SQL in the
   same database, so the pair is atomic and no compensation is needed.

3. **Append-only row numbering.** A promoted take's `row_num` is (max existing on
   that page) + 1. gbrain's markdown fences are append-only and `slug#N`
   references are stable forever, so renumbering would silently rewrite what a
   cross-page reference points at. A gap in the middle is not reused.

4. **Refuse unpromotable rows before claiming them.** gbrain's three fence-cell
   guards (control characters/newlines, the `gbrain:takes` marker text, wholesale
   strikethrough) are applied ahead of the claim, so a hostile or garbled claim
   cannot become an `accepted` row with no take behind it.

5. **`acted_by` is the session's user id, never a request field.** An audit column
   a caller can set is not an audit column; a body-supplied one is a 400.

6. **Provenance both ways.** A promoted take carries
   `source = 'nexalog:proposal#<id>'`, and the proposal carries
   `promoted_row_num`, so queue-row → take-row is followable in both directions.

## Consequences

- **Pro**: the queue finally has an exit. The decision the columns were designed
  for can now be made, recorded, and audited.
- **Pro**: strictly stronger atomicity than gbrain's own local accept.
- **Pro**: the stranded shape (`accepted` with no `promoted_row_num` — a crash
  between claim and promote) is detected and NAMED with its repair SQL, rather
  than being invisible because the row left the pending list.
- **Con — stated plainly, not buried**: a promoted take is written to the **DB
  plane**. gbrain's markdown takes fence is the source of truth and `takes` is
  reconciled FROM it, so a fence-driven rebuild for a page can drop a DB-only row.
  Nexalog cannot write the fence: the brain repo is bind-mounted **read-only** to
  the web container's user, and writing it directly would bypass gbrain's page
  lock and writer protocol — the exact class of write gbrain's own guards exist to
  refuse. Mitigation: provenance is stamped (so the gap is followable), the review
  page states it in its own copy, and closing it is a gbrain-side change
  (`gbrain extract takes` after a fence write, or an accept verb on the MCP
  surface).
- **Con**: the deployment must be able to reach gbrain's Postgres and must be
  given `GBRAIN_DATABASE_URL`. Neither is true of the current compose (the two
  containers sit on different Docker networks). Until the operator adds that
  route, the surface answers `503 gbrain_unavailable` naming the missing
  configuration — never an empty list, which would read as "nothing to review".

## Alternatives considered

- **Wait for an MCP accept verb.** Rejected: that is the status quo that produced
  0 promotions, and it is not a plan.
- **Shell into the gbrain container and run the CLI.** Rejected: the web app
  cannot execute commands in another container, and making that possible would be
  a far larger and less auditable hole than a scoped database role.
- **Write the markdown fence from the web app.** Rejected: bypasses gbrain's page
  lock and managed-writer protocol, and the repo is read-only to the web user —
  the write would fail, and making it succeed would mean weakening a guard that
  exists to prevent exactly this.
- **A new proposals table on the app side, mirrored from gbrain.** Rejected: two
  homes for one queue, and the mirror can drift from the table gbrain's extractor
  actually writes. (It is also the shape of an earlier decision that left 4,107
  `ideas` rows unreachable — do not repeat it.)

## Operator steps this ADR does not perform

1. Give the web service `GBRAIN_DATABASE_URL` (the deploy env-file, not inline).
2. Put the two containers on a network where the app can resolve and reach
   gbrain's Postgres.
3. Optionally, grant that connection a role scoped to the tables this reads and
   writes rather than the owner role.
