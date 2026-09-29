// SPDX-License-Identifier: MIT
/**
 * The chat session rail — server-side session state, in process memory.
 *
 * WHY IN MEMORY, AND WHY THAT IS STATED HERE
 * ------------------------------------------
 * There is no Postgres table for chat sessions and this change deliberately does
 * not add one. The repo carries the evidence for why: `chat_messages` exists in
 * the ORM schema and is unreachable by construction — `/api/search` is a closed
 * hand-written union with no dynamic table discovery, so a new table's rows are
 * invisible to every retrieval leg, and the 4,107 unreachable `ideas` rows are
 * the same defect one generation back. A second content store would also
 * duplicate gbrain, whose own tables are the durable record of everything the
 * brain knows. So a CHAT SESSION is a presentation-scoped object: it holds the
 * turn list the rail renders and the rolling window `volunteer_context` reads.
 * It is not content, and losing it costs the user a scrollback, not a fact.
 *
 * The deployment is a single Next.js server process in one container, so a
 * process-local store is correct there. What it is NOT is durable: a restart
 * clears the rail (the brain pages a turn produced are unaffected — they live in
 * gbrain). `SESSION_STORE_NOTE` says exactly that, and the route reports the
 * store's own health so a future reader is never told the rail survives a
 * restart when it does not.
 *
 * BOUNDING IS PART OF THE CONTRACT. An unbounded Map keyed by a client-supplied
 * id is a memory leak with a remote trigger, so the store caps both the number
 * of sessions and the turns per session, evicting the least-recently-used. The
 * caps are small on purpose: this is a scrollback, and the newest turns are the
 * only ones `volunteer_context` is given.
 */

import { randomUUID } from "node:crypto";

/** How many sessions one process keeps. Beyond this, the LRU is evicted. */
export const MAX_SESSIONS = 200;

/** How many turns one session keeps. The volunteer window reads the newest 3. */
export const MAX_TURNS_PER_SESSION = 60;

export const SESSION_STORE_NOTE =
  "Sessions live in this server process (no database table is created for them). " +
  "A restart clears the rail; the pages a turn touched stay in the brain.";

export interface ChatTurnRecord {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  /**
   * Citations for an assistant turn, as reader hrefs. Computed server-side at
   * answer time — the client never derives a route from an id (that mistake is
   * what made every brain search hit a 404; see `lib/search/result-href.ts`).
   */
  citations?: ChatCitation[];
  /** Reads that failed while grounding this turn, by name. */
  degradedReads?: string[];
  /** True when the stream ended before a `done` event — a partial answer. */
  partial?: boolean;
}

/** One citation: a resolved reader href plus the label to render. */
export interface ChatCitation {
  /** In-app reader route, produced by `brainPageHref`. */
  href: string;
  slug: string;
  title: string;
  /** Why this page is in the answer (`page`, `recall`, `volunteered`, `search`). */
  via: string;
}

export interface ChatSession {
  id: string;
  /** Owner — the authenticated user's id. Sessions are per user, always. */
  userId: string;
  /** The brain page this rail is scoped to, or null for a bare session. */
  scope: string | null;
  createdAt: string;
  updatedAt: string;
  turns: ChatTurnRecord[];
}

/** What the route needs to know about the store, as data. */
export interface SessionStoreStatus {
  /** Number of sessions this process holds. */
  sessions: number;
  /** Cap on sessions. */
  maxSessions: number;
  /** Cap on turns per session. */
  maxTurnsPerSession: number;
  /** Why the rail is not durable, in the surface's own words. */
  note: string;
}

export class ChatSessionStore {
  private readonly sessions = new Map<string, ChatSession>();

  /**
   * Create a session owned by `userId`. The scope is the brain page the rail is
   * opened from; it is stored so every turn of the session grounds on the same
   * page even if the user navigates within the reader.
   */
  create(userId: string, scope: string | null): ChatSession {
    this.evictIfNeeded();
    const now = new Date().toISOString();
    const session: ChatSession = {
      id: randomUUID(),
      userId,
      scope,
      createdAt: now,
      updatedAt: now,
      turns: [],
    };
    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * Fetch a session for a user. Returns null for an unknown id AND for a
   * session owned by someone else — the caller cannot tell the two apart, which
   * is the point: another user's session id must not be probeable.
   */
  get(userId: string, id: string): ChatSession | null {
    const session = this.sessions.get(id);
    if (!session || session.userId !== userId) return null;
    // LRU refresh: a read is a use.
    this.sessions.delete(id);
    this.sessions.set(id, session);
    return session;
  }

  /** Append a turn, trimming the oldest past the per-session cap. */
  append(userId: string, id: string, turn: Omit<ChatTurnRecord, "id" | "createdAt"> & Partial<Pick<ChatTurnRecord, "id" | "createdAt">>): ChatTurnRecord | null {
    const session = this.get(userId, id);
    if (!session) return null;
    const record: ChatTurnRecord = {
      id: turn.id ?? randomUUID(),
      role: turn.role,
      content: turn.content,
      createdAt: turn.createdAt ?? new Date().toISOString(),
      ...(turn.citations ? { citations: turn.citations } : {}),
      ...(turn.degradedReads ? { degradedReads: turn.degradedReads } : {}),
      ...(turn.partial ? { partial: turn.partial } : {}),
    };
    session.turns.push(record);
    if (session.turns.length > MAX_TURNS_PER_SESSION) {
      session.turns.splice(0, session.turns.length - MAX_TURNS_PER_SESSION);
    }
    session.updatedAt = record.createdAt;
    return record;
  }

  status(): SessionStoreStatus {
    return {
      sessions: this.sessions.size,
      maxSessions: MAX_SESSIONS,
      maxTurnsPerSession: MAX_TURNS_PER_SESSION,
      note: SESSION_STORE_NOTE,
    };
  }

  /** Insertion order IS recency order (every read re-inserts), so this is LRU. */
  private evictIfNeeded(): void {
    while (this.sessions.size >= MAX_SESSIONS) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) return;
      this.sessions.delete(oldest);
    }
  }
}

/**
 * The process-wide store. A module-level singleton because Next.js route
 * handlers are per-request closures but the process is one — and because the
 * alternative (constructing a store per request) would give every request its
 * own empty rail, which is a working-looking chat that forgets everything.
 *
 * `globalThis` keeps it across dev-mode module reloads, the same trick the
 * existing db client uses.
 */
const globalForChat = globalThis as unknown as { __nexalogChatSessions?: ChatSessionStore };

export function getChatSessionStore(): ChatSessionStore {
  if (!globalForChat.__nexalogChatSessions) {
    globalForChat.__nexalogChatSessions = new ChatSessionStore();
  }
  return globalForChat.__nexalogChatSessions;
}
