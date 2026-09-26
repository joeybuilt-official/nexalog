# ADR 0001 — Nexalog Projects (container · grouping · Jex contract · lifecycle · living-doc)

Status: **PROPOSED — awaiting operator approval (Phase 2 hard stop)**
Date: 2026-06-12 · Initiative: NEXALOG-PROJECTS

## Context
Add a first-class **Project** to Nexalog: a container that GROUPS existing atomic units (notes, bookmarks) BY REFERENCE, carries a LIVING DOCUMENT + an AI BRAINSTORM thread, and has a LIFECYCLE STATE. Nexalog owns the canonical project record. Execution (brainstorm/AI) runs in Plexo over the Jex boundary; Plexo attaches Work history to the project ID. No Plexo Core changes; no second registry; no local AI pipeline; no creator canvas.

Phase 0 (audit-findings.md) + Phase 1 (OSS benchmark, top-5 by live stars) inform every decision below.

## Benchmark first principles applied
1. Atomic units are addressable by stable ID; references point at IDs, never copy (AFFiNE/SiYuan/Logseq/Trilium).
2. **Grouping ≠ ownership** — Project is a reference-set, never a folder that owns notes. One unit lives in many projects.
3. Living-doc storage = markdown text for portability; runtime block-tree is optional sugar, and CRDT/block-tree lock-in is *unearned for single-user PKM*.
4. **Lifecycle is the field's blind spot** — only Outline ships real container states. First-class lifecycle is our differentiator (design it as an enum on the container, not a tag).

## Expert panel (conflicts surfaced — operator decisions D1–D5)
- **Security ↔ UX:** Sec requires every grouped `itemId` be validated as same-workspace before linking (IDOR risk: grouping another user's note by raw ID). UX wants frictionless "add to project" quick-actions app-wide. → Resolved by batched ownership validation (single `IN` query) so the guard is cheap; UX keeps the quick-action. (No operator decision needed; recorded.)
- **Performance ↔ PKM-domain (D1):** Perf wants living-doc as plain markdown `text` (cheap store/diff, paginate grouped items). Domain wants a rich block-tree. → **D1.**
- **Maintainability ↔ PKM-domain (D2):** Maint + the "no generic container framework" guardrail want static explicit references only. Domain wants dynamic saved-query "smart" membership (AFFiNE Collections style). → **D2.**
- **Maintainability ↔ UX (brainstorm):** Maint wants the chat route's context-graining extracted into one shared lib reused by both chat and project brainstorm (no divergence). UX wants project brainstorm to auto-scope to project context and feel distinct. → Resolved: extract `lib/context-graining.ts`, project brainstorm passes project digest via `sessionContext.activeView`. (Recorded.)

## Decisions (one-way doors — require approval)

### D1 — Living-doc storage  ⚠ one-way
**Recommend: `livingDoc text` (markdown) + `livingDocUpdatedAt timestamptz`.** Lightweight, portable, diff-able, matches "no premature abstraction"; benchmark says CRDT/block-tree is unearned single-user. A JSONB block-tree can be added later additively without dropping the column. Editor = simple markdown textarea/MD editor in v1.
- Alt rejected: JSONB block-tree / CRDT (heavy, Rust bindings, hard egress, multi-user-only payoff).

### D2 — Grouping membership model  ⚠ one-way
**Recommend: static explicit references via `project_items` junction** — `(id uuid, projectId uuid, itemKind text CHECK in ('note','bookmark'), itemId uuid, addedAt timestamptz)`, unique `(projectId,itemKind,itemId)`, indices both directions. Mirrors existing junction pattern exactly. Group by reference, never copy. Dynamic saved-query membership deferred (additive later — would add a `project_smart_rules` table, not change this one).
- Alt rejected for v1: query-defined dynamic membership (premature; guardrail forbids generic container framework).

### D3 — Jex contract (brainstorm Work + context read + history write-back)  ⚠ one-way
**Recommend: route brainstorm through SDK `chatMessage(workspaceId, userId, opts)` via one new `lib/plexo.ts` export** (e.g. `plexoProjectBrainstorm`). Mapping:
- **Project handle → Plexo Work thread:** `channelRef = { channel: "nexalog-project", channelId: <projectId>, chatId: <projectId> }`. Plexo holds the conversation/Work history server-side keyed by this — **no registry copy in Plexo**, only a reference + history attached to projectId.
- **Context read:** `sessionContext.activeView = { type: "project", id: projectId, summary: <living-doc digest + grouped-knowledge digest> }`; bulk context (grouped unit titles/snippets) in `sessionContext.appState`.
- **History write-back:** Plexo returns `{ reply, conversationId, sessionId, taskId }`; Nexalog persists only the `sessionId`/`taskId` pointer on the project (NOT a copy of history) and reads history back via `getConversations(workspaceId)` filtered to the project session. Brainstorm transcript of record lives Plexo-side.
- Domain depends on a small **port interface** `ProjectIntelligencePort` (methods: `brainstorm`, `readWorkHistory`), implemented once by the Jex client. AI concerns never leak into domain/route logic beyond the port.
- Alt rejected: reuse local `aiComplete` graining (stateless, no Work threading, no taskId, violates "writes Work history back over Jex").

### D4 — Lifecycle states  ⚠ one-way
**Recommend enum `lifecycleState`: `draft → active → archived`** (Outline-validated), default `active`, stored as `text` with CHECK (matches existing `lifecycleState`/`state` columns in schema). Optional 4th `paused` if operator wants an explicit hold state.
- Transitions enforced in domain layer (pure fn), not free-text.

### D5 — Which units are groupable (v1 scope)  — **APPROVED: notes + bookmarks + journal**
`itemKind in ('note','bookmark','journal')`. Ownership guard validates each kind against its table (`notes` / `captureSources` / `journalEntries`) by `workspaceId`+`userId`. journal has no title → graining uses `entryDate` + `body` snippet.

## UPDATE 2026-06-12 — pre-mortem #3 FIRED (fallback applied)
Live prod smoke showed `chatMessage` (channelRef Work threading) returns an **empty reply + no sessionId** on this Plexo deployment — `chat/message` has never been exercised by Nexalog (existing chat uses `aiComplete`). Per the pre-mortem #3 fallback, brainstorm now runs over **`aiComplete`** (proven path) grounded in the project digest, and the **transcript persists in Nexalog's existing `chatSessions`/`chatMessages`** (project.plexoSessionId → session id), mirroring the chat feature. Still all-Plexo inference, no local AI, no new table. The `ProjectIntelligencePort` surface is preserved (now pure inference; route owns persistence) so a future Plexo Work primitive can be reinstated without touching the route/UI. Contract note: storing brainstorm turns in Nexalog matches how the app already stores chat — it is NOT a duplicated project *registry*.

## APPROVED DECISIONS (Phase 2 gate passed 2026-06-12)
D1 = markdown `text` · D2 = static `project_items` junction · D3 = Jex `chatMessage` channelRef=projectId · D4 = `draft/active/archived` · D5 = notes+bookmarks+journal.

## Schema (proposed `0012_projects.sql`)
```
projects (
  id uuid pk default gen_random_uuid(),
  workspaceId uuid not null, userId text not null,
  name text not null, description text,
  lifecycleState text not null default 'active' check (lifecycleState in ('draft','active','archived'[, 'paused' if D4]) ),
  livingDoc text, livingDocUpdatedAt timestamptz,
  plexoSessionId text,           -- pointer to Plexo Work thread (NOT history copy)
  createdAt timestamptz default now(), updatedAt timestamptz default now(), deletedAt timestamptz
)  -- indices: (workspaceId,userId), (lifecycleState)

project_items (
  id uuid pk default gen_random_uuid(),
  projectId uuid not null references projects(id),
  itemKind text not null check (itemKind in ('note','bookmark')),
  itemId uuid not null,
  addedAt timestamptz default now()
)  -- unique (projectId,itemKind,itemId); index (projectId), (itemKind,itemId)
```
No FK from project_items.itemId to notes/captureSources (polymorphic by itemKind) — integrity enforced in the validated insert path (batched ownership check), consistent with existing polymorphic junction usage.

## Pre-mortem (assume it failed)
1. **Drift: a project registry/copy leaks into Plexo.** Cause — brainstorm convenience pushes project metadata into Plexo memory/graph as the source of truth. *Fallback:* port interface only ever sends a *digest* via `sessionContext`, never persists project rows Plexo-side; ADR + a code-review checklist item assert "Plexo holds pointer+history, never registry." Grep guard for accidental `addEpisode` of full project records.
2. **IDOR / cross-workspace grouping.** Cause — `project_items` insert trusts client-supplied `itemId`. *Fallback:* every link path runs a single batched `SELECT id FROM notes/captureSources WHERE id IN (...) AND workspaceId = $ws AND userId = $u`; reject any id not returned. Covered by a test.
3. **Brainstorm contract mismatch — `chatMessage` Work threading not as assumed** (e.g. `channelRef`/`taskId` semantics differ on the live Plexo). Cause — SDK type ≠ deployed Plexo behavior. *Fallback:* probe the live endpoint in Phase 3 before wiring UI; if Work threading is absent, degrade to `aiComplete` + store transcript pointer only in `plexoSessionId`, keep the same `ProjectIntelligencePort` surface so UI is unaffected. Flag as a discovery if it fires.

## Consequences
- Adds 2 tables + 1 migration (0012, manual prod apply — operator-gated).
- Extends `lib/plexo.ts` with one port-implementing export; extracts `lib/context-graining.ts` shared with chat.
- New routes `app/api/projects/*` + UI `app/(app)/app/projects/{page,[id]}`.
- Deferred (additive, not built now): dynamic smart membership, journal grouping, block-tree living-doc, real-time collab.
