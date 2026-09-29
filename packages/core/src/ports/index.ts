/**
 * Ports — the interfaces `core`'s use cases depend on. Adapters implement
 * these; `core` imports nothing concrete. This is the Clean Architecture wall:
 * no fs, no fetch, no db, no git in this package.
 */

import { Capture, CaptureState } from "../domain/capture";
import { CaptureStatus } from "../domain/capture-status";
import { AttachmentKind } from "../domain/attachment-kind";
import { Slug } from "../domain/slug";
import { Ulid } from "../domain/ulid";
import {
  PromotedTake,
  ProposalStatusCounts,
  TakeProposal,
} from "../domain/take-proposal";

/** Generate IDs (ULIDs) and timestamps. Injectable for deterministic tests. */
export interface IdGen {
  newUlid(): Ulid;
  newCapturedAt(): Date;
}

export interface Clock {
  now(): Date;
}

/**
 * BrainStore — read/write markdown pages + attachments in the brain git repo.
 * Implemented by FsGitBrainStore (bind-mounted repo, single-writer commit).
 */
export interface BrainStore {
  /** Persist a new capture as inbox/<id>.md and commit. */
  saveCapture(capture: Capture): Promise<void>;

  /** Read one capture by id, or null if absent. */
  getCapture(id: Ulid): Promise<CaptureState | null>;

  /** List inbox captures (optionally filtered by status). */
  listCaptures(filter?: { status?: CaptureState["status"] }): Promise<CaptureState[]>;

  /** Update an existing capture (status/claim/review transitions) and commit. */
  updateCapture(capture: Capture): Promise<void>;

  /** Read a page by slug (markdown frontmatter + body), or null. */
  getPage(slug: Slug): Promise<{ slug: Slug; frontmatter: Record<string, unknown>; body: string } | null>;

  /** Write a page by slug and commit. */
  savePage(slug: Slug, frontmatter: Record<string, unknown>, body: string): Promise<void>;

  /**
   * Persist an attachment and return its repo-relative path. `kind` is the
   * per-file kind derived by `deriveAttachmentKind` — the implementation uses it
   * to name the stored file (audio is always opus after normalization, so it
   * must not keep a `.m4a`/`.wav` extension).
   */
  saveAttachment(input: {
    name: string;
    kind: AttachmentKind;
    bytes: Uint8Array;
  }): Promise<{ path: string }>;
}

/**
 * BrainIndex — search + graph + entity over the brain. Implemented by
 * GBrainIndex (MCP) and NullIndex (frontmatter scan fallback).
 */
export interface BrainIndex {
  search(query: string, opts?: { limit?: number }): Promise<Array<{ slug: string; title: string; snippet: string }>>;
  entity(name: string): Promise<{ slug: string; type: string } | null>;
  graphNeighborhood(slug: Slug, opts?: { depth?: number }): Promise<{ nodes: unknown[]; edges: unknown[] }>;
  sync(): Promise<void>;
}

// ── GBrain (MCP) capabilities ──────────────────────────────────────────────

/**
 * One search hit returned by GBrain's hybrid search. Shape mirrors the
 * `search`/`query` tools (`content[0].text` JSON). Plain data only — no MCP
 * wire types cross this wall.
 */
export interface GBrainSearchHit {
  slug: string;
  title: string;
  /** gbrain page type (person/company/project/concept/note/…). */
  type: string;
  /** The retrieved chunk text (may be truncated per snippet budget). */
  chunkText: string;
  score: number | null;
  sourceId: string | null;
  effectiveDate: string | null;
}

/** A read of one brain page (get_page). */
export interface GBrainPage {
  slug: string;
  title: string;
  type: string;
  /** Markdown body (compiled_truth or raw content where present). */
  body: string;
}

/**
 * One row of the brain's page index (list_pages) — identity only, NO body.
 * Browsing needs the catalogue, not every page's markdown; a reader that wants
 * the body asks for that one page (getPage).
 */
export interface GBrainPageSummary {
  slug: string;
  title: string;
  /** gbrain page type (person/company/project/concept/atom/note/…). */
  type: string;
  /** Which gbrain source the page belongs to (null when the tool omits it). */
  sourceId: string | null;
  /** Last update instant, ISO-8601 (null when the tool omits it). */
  updatedAt: string | null;
}

/** Sort orders `list_pages` accepts. Defaults to `updated_desc`. */
export type GBrainPageSort = "updated_desc" | "updated_asc" | "created_desc" | "slug";

export interface GBrainListPagesOptions {
  limit?: number;
  offset?: number;
  /** Filter to one page type. */
  type?: string;
  sort?: GBrainPageSort;
}

/** A directed link between two pages (traverse_graph / get_backlinks / get_links). */
export interface GBrainLink {
  fromSlug: string;
  toSlug: string;
  linkType: string;
  context: string | null;
  /** 1-based hop distance from the traversal seed (null for backlinks). */
  depth: number | null;
}

/** entity() resolution — never throws on a miss; `found` gates the payload. */
export interface GBrainEntity {
  found: boolean;
  slug: string | null;
  type: string | null;
}

/**
 * GBrainClient — the read-only capabilities Nexalog needs from GBrain's MCP
 * server. GBrain owns index/graph/retrieval/embeddings; Nexalog only calls it
 * (it makes zero LLM calls of its own — and, per the revised boundary, no
 * PROVIDER calls of its own either: the model leg is a separate port, see
 * `ChatRuntime` below). Implemented by the MCP HTTP adapter in
 * `packages/adapters`; the `BrainIndex`/`NullIndex` path remains the fs
 * frontmatter fallback when GBrain is unreachable.
 *
 * Methods throw on transport/auth failure — callers catch and degrade.
 */
export interface GBrainClient {
  /** Cheap hybrid search (vector+keyword+RRF), no LLM expansion. */
  search(query: string, opts?: { limit?: number; types?: string[] }): Promise<GBrainSearchHit[]>;
  /** Hybrid search with multi-query expansion (concept/synonym recall). */
  query(query: string, opts?: { limit?: number; types?: string[] }): Promise<GBrainSearchHit[]>;
  /** Read one page by slug, or null when absent. */
  getPage(slug: string): Promise<GBrainPage | null>;
  /**
   * List the brain's pages (identity only — no bodies), newest first by
   * default. A result of exactly `limit` rows may be truncated: page with
   * `offset` rather than assuming the list is whole.
   */
  listPages(opts?: GBrainListPagesOptions): Promise<GBrainPageSummary[]>;
  /** Incoming links to a page. */
  getBacklinks(slug: string): Promise<GBrainLink[]>;
  /** Walk the link graph from a page (outgoing/ingoing/both, up to depth). */
  traverseGraph(slug: string, opts?: { depth?: number; direction?: "in" | "out" | "both" }): Promise<GBrainLink[]>;
  /** Resolve one named person/company/project card (never throws on miss). */
  entity(name: string): Promise<GBrainEntity>;
  /**
   * Session-boundary bundle for a set of standing entities (`context_pack`):
   * entity cards + hot facts, SERVER-side packed under `budgetTokens`. Zero
   * LLM, sub-second — the cheap entry point a turn starts from.
   */
  contextPack(input: GBrainContextPackInput): Promise<GBrainContextPack>;
  /**
   * The memory read verb (`recall`): hot-memory facts for an entity, plus a
   * hybrid-search arm when `query` is given, packed server-side under
   * `budgetTokens`. Also zero-LLM.
   */
  recall(input: GBrainRecallInput): Promise<GBrainRecall>;
  /**
   * Push-based relevance (`volunteer_context`): pages the ROLLING WINDOW of
   * recent turns names, confidence-gated. Used as a safety net for what the
   * turn's own phrasing would miss.
   */
  volunteerContext(input: GBrainVolunteerInput): Promise<GBrainVolunteeredPage[]>;
}

// ── GBrain memory verbs (context_pack / recall / volunteer_context) ─────────
//
// Shapes verified against the live MCP server (2026-09-28). They are the cheap,
// zero-LLM entry points a chat turn assembles from — deliberately NOT
// `synthesize`/`think`, whose own schemas mark them expensive/slow and which
// are background work, never in-turn.

/** One typed edge on a context-pack card. */
export interface GBrainContextEdge {
  type: string;
  direction: "in" | "out";
  slug: string;
  context: string | null;
}

/** One standing-entity card in a context pack. */
export interface GBrainContextCard {
  slug: string;
  title: string;
  type: string;
  summary: string;
  edges: GBrainContextEdge[];
  backlinkCount: number;
}

/** One hot-memory fact (context_pack / recall share this row shape). */
export interface GBrainContextFact {
  fact: string;
  kind: string;
  entitySlug: string | null;
  confidence: number | null;
}

export interface GBrainContextPackInput {
  /** Entity names/slugs to bundle. The server caps this at 8. */
  entities: string[];
  /** Server-side token budget; the response reports what it used and dropped. */
  budgetTokens?: number;
}

export interface GBrainContextPack {
  cards: GBrainContextCard[];
  facts: GBrainContextFact[];
  /** The server-packed text bundle — already fitted to the budget. */
  text: string;
  budgetUsed: number | null;
  droppedCount: number | null;
}

/** One page hit from recall's hybrid-search arm. */
export interface GBrainRecallResult {
  slug: string;
  title: string;
  chunk: string;
  /** How the match was made (`keyword_exact`, …) — gbrain's own label. */
  evidence: string | null;
  provenance: string | null;
}

export interface GBrainRecallInput {
  /** Free-text retrieval across pages (the hybrid-search arm). */
  query?: string;
  /** Entity slug — returns that entity's facts, newest first. */
  entity?: string;
  budgetTokens?: number;
  /** Per-arm cap on facts AND results. */
  limit?: number;
}

export interface GBrainRecall {
  facts: GBrainContextFact[];
  results: GBrainRecallResult[];
  budgetUsed: number | null;
  droppedCount: number | null;
}

/** One page volunteered for the current conversation window. */
export interface GBrainVolunteeredPage {
  slug: string;
  title: string;
  confidence: number | null;
  /** Which matcher fired (`title`, `alias`, `slug-suffix`, …). */
  arm: string | null;
  rationale: string | null;
  synopsis: string | null;
}

export interface GBrainVolunteerInput {
  /** Recent turns, oldest → newest, as `user:` / `assistant:` prefixed lines. */
  window: string;
  maxPages?: number;
  /** Confidence gate; slug-suffix matches need an explicitly lower one. */
  minConfidence?: number;
}

// ── Chat (the turn) ─────────────────────────────────────────────────────────

/** One prior turn handed to the runtime as conversation history. */
export interface ChatHistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRuntimeRequest {
  /**
   * The assembled brain context, already framed as DATA (see
   * `renderContextBlock`). It is a separate field — not a message the caller
   * appended — so an adapter can decide where the endpoint wants it (system
   * prompt, prefix, or dropped) without parsing prose.
   */
  context: string;
  /** The user's turn, verbatim. */
  message: string;
  /** Prior turns, oldest first, already trimmed by the caller. */
  history: ChatHistoryTurn[];
  /**
   * Continuity key for an endpoint that keeps its own session state. Sent as
   * the endpoint's own header when it declares one; ignored otherwise.
   */
  sessionId?: string;
  /** Aborted when the client disconnects — a stream nobody reads must stop. */
  signal?: AbortSignal;
}

/**
 * One streaming event. Adapters translate their vendor's wire format into
 * exactly these three; nothing inward of the adapter ever sees a vendor shape.
 */
export type ChatRuntimeEvent =
  | { type: "delta"; text: string }
  | { type: "done"; finishReason: string | null }
  | { type: "error"; message: string; status: number | null };

/**
 * ChatRuntime — the ONE chat port. Nexalog hosts the SURFACE (this session,
 * the stream, the citations); whatever is behind this port hosts the TURN.
 *
 * Two adapters satisfy it from the same OpenAI-compatible wire, selected in the
 * composition root and never in a feature: the Hermes agent endpoint (the
 * decided deployment — it owns the agent loop, tools and writeback, and
 * continues a session via its own id header) and the LiteLLM gateway (the
 * standalone tier). A feature must not know which one answered; the router
 * reports the leg it used as data, exactly as the graph/page ladders report
 * `source`.
 */
export interface ChatRuntime {
  /** Stable id of the configured leg, for the surface's own honesty banner. */
  readonly id: string;
  /** Model label the endpoint reports or was configured with. */
  readonly model: string;
  /** Stream one turn. Throws only on a transport failure BEFORE any event. */
  streamTurn(request: ChatRuntimeRequest): AsyncIterable<ChatRuntimeEvent>;
}

// ── Proposal queue (gbrain `take_proposals`) ────────────────────────────────

/** What an accept/reject attempt is told about why it could not proceed. */
export type ProposalFailureCode = "not_found" | "not_pending";

/**
 * ProposalQueueError — a business-rule failure, not a transport one.
 *
 * `proposalId` is carried so a route can name the row in its response, and
 * `code` is the stable value a client branches on (never the message text).
 * `hint` is the repair instruction when there is one — the stranded-accepted
 * shape is repairable, and saying so beats a dead end.
 */
export class ProposalQueueError extends Error {
  readonly code: ProposalFailureCode;
  readonly proposalId: number;
  readonly hint?: string;

  constructor(input: {
    code: ProposalFailureCode;
    proposalId: number;
    message: string;
    hint?: string;
  }) {
    super(input.message);
    this.name = "ProposalQueueError";
    this.code = input.code;
    this.proposalId = input.proposalId;
    this.hint = input.hint;
  }
}

/** One page of the pending queue, plus the whole-queue counts. */
export interface ProposalPage {
  proposals: TakeProposal[];
  counts: ProposalStatusCounts;
  /** Pass back as `offset` for the next slice; null when the queue is exhausted. */
  nextOffset: number | null;
}

/**
 * ProposalQueue — read the pending queue and act on one proposal.
 *
 * Implemented by `GbrainProposalQueue` (a parameterized read/write against
 * gbrain's own `take_proposals` / `takes` tables). gbrain owns those tables and
 * its MCP surface exposes no adjudication verb — its `takes_*` ops are read +
 * add/update/resolve, and `takes propose --accept` exists only as a local CLI —
 * so reaching the same tables directly is the only way an operator can drain
 * the queue from the app. This port is the boundary that keeps that fact out of
 * the domain.
 *
 * The contract that matters is the CAS: `act` must claim the row with a guarded
 * UPDATE whose row count it CHECKS, then perform the promote. Check-then-write
 * would let two operators both pass the pending check and both append the take.
 */
export interface ProposalQueue {
  /** Pending proposals, newest first, with whole-queue status counts. */
  list(input: { limit: number; offset: number }): Promise<ProposalPage>;

  /**
   * Adjudicate one proposal. On accept the take is appended to the page and the
   * row is stamped `accepted` + `promoted_row_num` + `acted_*`; on reject the
   * row is stamped `rejected` + `acted_*` and nothing is written to the page.
   */
  act(input: {
    proposalId: number;
    accept: boolean;
    /** Who acted — recorded verbatim in `acted_by`. */
    actedBy: string;
  }): Promise<{ proposal: TakeProposal; promoted: PromotedTake | null }>;
}

// ── AppState: derived index + tokens + read state ───────────────────────────

/**
 * One row of the derived capture index (DB table `nexalog.capture_index`).
 * Parity with the frontmatter contract (nexalog.schema=1) plus repo
 * bookkeeping. Plain data only — no drizzle types cross this wall.
 */
export interface CaptureIndexRow {
  /** Capture identity; equals the `<ulid>` stem of the source markdown file. */
  ulid: string;
  /** Repo-relative path of the source file, e.g. `inbox/01J8….md`. */
  path: string;
  /** gbrain-base-v2 page type (top-level frontmatter `type:`). */
  type: string;
  /** nexalog.schema version of the source file. */
  schemaVersion: number;
  status: CaptureStatus;
  kind: string;
  source: string;
  capturedAt: Date;
  processedAt: Date | null;
  claimedBy: string | null;
  attachments: string[];
  originUrl: string | null;
  hasProposal: boolean;
  title: string;
  /** sha256 of body markdown ONLY — detects file changes content-free. */
  bodySha256: string | null;
  reindexedAt: Date;
}

export interface InboxIndexFilter {
  /** Omit to list all statuses. */
  status?: CaptureStatus;
  /** Max rows to return. */
  limit?: number;
  /** Opaque cursor from a previous page (`nextCursor`), for keyset paging. */
  cursor?: string;
}

export interface InboxIndexPage {
  rows: CaptureIndexRow[];
  /** Pass as `cursor` for the next page; null when exhausted. */
  nextCursor: string | null;
}

/**
 * Issued API-token material. The plaintext token is returned exactly once at
 * creation; only its sha256 hex is ever persisted.
 */
export interface ApiTokenCreated {
  id: string;
  name: string;
  /** First 8 chars of the plaintext token, for display/rotation UX. */
  tokenPrefix: string;
  /** The plaintext bearer token — show once; storage keeps only the hash. */
  token: string;
  tokenHash: string;
  createdAt: Date;
}

/** A stored (non-secret) view of an API token. */
export interface ApiTokenView {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

/**
 * AppStateRepo — non-content state: the derived inbox index, api tokens, and
 * read state. Implemented by DrizzleAppStateRepo (Postgres, app-state only).
 *
 * Invariants the implementation must honor:
 *  - the DB never stores body CONTENT (only its sha256, when present);
 *  - plaintext bearer tokens never reach storage — callers receive the token
 *    from createApiToken, the repo persists only its sha256 hex;
 *  - verifyApiToken compares sha256 hex constant-time and bumps last_used.
 */
export interface AppStateRepo {
  // ── derived capture index ────────────────────────────────────────────────
  /** Insert-or-update (keyed by ulid) a batch of index rows. */
  upsertCaptureIndex(rows: CaptureIndexRow[]): Promise<void>;

  /** Paged read of the derived index, most recent capture first. */
  listInboxIndex(filter?: InboxIndexFilter): Promise<InboxIndexPage>;

  /** Remove index rows for files that no longer exist (orphans). */
  deleteCaptureIndex(ulids: string[]): Promise<void>;

  /** Remove every index row (TRUNCATE-and-rebuild support). */
  clearCaptureIndex(): Promise<void>;

  /** Fetch one row by capture id, or null. */
  getCaptureIndexRow(ulid: string): Promise<CaptureIndexRow | null>;

  // ── read state ───────────────────────────────────────────────────────────
  markRead(captureId: Ulid, readAt: Date, userId?: string): Promise<void>;
  isRead(captureId: Ulid, userId?: string): Promise<boolean>;

  // ── api tokens ───────────────────────────────────────────────────────────
  /**
   * Create a token for `name`. The plaintext token comes back exactly once;
   * the implementation stores only sha256(token) hex as `tokenHash`.
   */
  createApiToken(name: string): Promise<ApiTokenCreated>;

  /**
   * Verify a bearer token: sha256 it, constant-time-compare against stored
   * hashes, bump last_used_at on a match. Null when no active match.
   */
  verifyApiToken(token: string): Promise<ApiTokenView | null>;

  /** Soft-revoke (sets revoked_at); verify rejects revoked tokens. */
  revokeApiToken(name: string): Promise<void>;

  listApiTokens(): Promise<ApiTokenView[]>;
}

/** Normalize audio to opus (ffmpeg). Implemented by the media adapter. */
export interface Transcoder {
  toOpus(bytes: Uint8Array): Promise<Uint8Array>;
}
