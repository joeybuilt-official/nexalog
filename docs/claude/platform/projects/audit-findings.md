# NEXALOG-PROJECTS — Phase 0 Audit Findings (read-only)

Date: 2026-06-12 · Codebase: /srv/nexalog-v1 · Branch: main

## Stack (verified, matches request)
Next.js 15 App Router · React 19 · Tailwind v4 (`@tailwindcss/postcss`, no tailwind.config.ts) · shadcn/ui in `components/ui/` (Base UI primitives + CVA + `cn()`) · Better Auth · Drizzle (single schema file) · pgvector active. License MIT (AGENTS.md enforces header + "no direct AI SDK, Plexo-only").

## Data model (lib/db/schema.ts, schemaFilter = `nexalog`)
Atomic knowledge units — all scoped `workspaceId uuid` + `userId text`, PK `id uuid`:
- **notes** — title, content, kind, lifecycleState, date, deletedAt, embedding vector(384)
- **captureSources** (bookmarks) — url, kind, state, summary, metadata, embedding vector(384)
- **journalEntries** — entryDate, body, mood, energy
- **pageVisits** — lightweight (never enriched, ADR 0001)
- **chatSessions** + **chatMessages** (messages → sessionId)
- **NO `ideas` table** — operator's "ideas" are notes (by `kind`) / chat. Project groups notes + bookmarks (+ optionally journal).

Junction pattern (REUSE as template): `noteTags`, `captureSourceTags`, `captureSourceCollections`, `bookmarkTags` (hierarchical via parentId), `bookmarkCollections`, `noteLinks`. All: uuid PK, `addedAt`, indices on both FK cols, fine-grained (no composite PK).

Migrations: highest = `0011_pgvector_embeddings.sql`; sequential 4-digit; **NO auto-migrate** (drizzle.config has no migrations key) → **next = `0012_*`, applied MANUALLY to prod (operator-gated)**.

## Jex / Plexo wiring
**Single canonical client EXISTS:** `lib/plexo.ts` wrapping `@joeybuilt/plexo-sdk/connect` (`createPlexoClient({ appId:"nexalog", plexoUrl, serviceKey, displayName })`). This is THE Jex client to extend — do not scatter new call sites.
- Env: `PLEXO_URL`, `PLEXO_SERVICE_KEY`, `PLEXO_DB_URL` (cron only), `EMBEDDINGS_URL`.
- Workspace per user via `plexoEnsureWorkspace(userId,email)` (cached); `ensurePlexoConnection` fire-and-forget on auth.
- Existing exports: `plexoAiComplete`, `plexoAddEpisode`, `plexoMemorySearch`, `plexoGetConversations`, `plexoPublishEvent`, `plexoEmbed`, `plexoSuggestTitle`.

**"Work" primitive resolution (was the open tension):** No literal `Work` API, BUT SDK `chatMessage(workspaceId, userId, opts)` is the seam:
- `opts`: `message`, `sessionId`, `channelRef {channel, channelId, chatId}`, `sessionContext {activeView {type,id,summary}, appState}`.
- returns `{ reply, conversationId, sessionId, taskId }`.
- → Plexo holds the conversation/Work history **server-side, keyed by `channelRef.channelId = projectId`**. Context read = `sessionContext.activeView` (project summary + grouped-knowledge digest). History read-back = `getConversations(workspaceId)` filtered by session/channel.
- **This honors the contract with ZERO Plexo Core changes:** Nexalog owns the registry; Plexo references projectId + attaches Work history to it. Brainstorm = `chatMessage`, NOT local `aiComplete` graining (chat route currently uses `aiComplete` — Project brainstorm should use `chatMessage` to get server-side Work threading + taskId).

## Routes / auth / UI conventions
- Authed shell `app/(app)/app/<feature>/` — `page.tsx` (async server comp: auth + workspace + initial data) → `<feature>-client.tsx` (`"use client"`). Detail views nest under `feature/[id]`.
- Closest analog = **chat**: `app/(app)/app/chat/{page.tsx, chat-client.tsx}` + `app/api/chat/sessions/route.ts` (POST create) + `app/api/chat/[sessionId]/messages/route.ts` (GET/POST, @-ref resolution, context graining, citations).
- Auth: `middleware.ts` (cookie presence → 401 API / redirect page); `lib/auth/server.ts` `getAuthUser()` → `auth.api.getSession({headers})`. Single active workspace per user (`ensurePersonalWorkspace`).
- Data access: route handlers (`app/api/.../route.ts`) + Drizzle (`eq/and/or/desc/ilike`, FTS `@@ plainto_tsquery`). Form mutations sometimes server actions. Validation today is manual destructure (zod available in stack — use zod for new routes).

## REUSE vs ADD verdict
**REUSE:** `lib/plexo.ts` (extend with one `plexoProjectWork`-style export wrapping `chatMessage`); junction-table pattern; chat route's @-ref + context-graining logic; `page.tsx`→`client.tsx` shell; `getAuthUser` gate; `components/ui`.
**ADD:** `projects` table (registry, lifecycle, living-doc storage) + `projectItems` junction (projectId × {itemKind, itemId} by reference); migration `0012`; `app/api/projects/*` routes; `app/(app)/app/projects/{page,[id]}` UI; one Jex-port wrapper for brainstorm Work + context-read + history-readback.
**DO NOT build:** creator canvas (out of scope). No second registry in Plexo. No local AI pipeline.
