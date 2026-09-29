/**
 * Composition root — the ONLY place adapters are instantiated and injected
 * into use cases (plan §1.3). Route handlers import from here; they never
 * construct adapters or call business logic directly.
 *
 * Wiring is decided by env:
 *   BRAIN_REPO     (required) — absolute path to the bind-mounted brain repo
 *   BRAIN_INDEX     null | gbrain  — default null (standalone works with no GBrain)
 *   GBRAIN_MCP_URL  (optional) — MCP server URL (default https://gbrain.example.com/mcp)
 *   GBRAIN_API_KEY  (optional) — bearer token; when absent the GBrain client is
 *                    constructed but fails every call (search degrades to the
 *                    fs frontmatter scan).
 *   CHAT_BASE_URL   (optional) — the base URL of the leg that hosts the TURN,
 *                    without `/v1` (e.g. the Hermes agent endpoint, or the
 *                    LiteLLM gateway). Absent ⇒ `chat` is null and the chat
 *                    surface states that no turn can be taken.
 *   CHAT_API_KEY    (optional) — bearer for that leg.
 *   CHAT_MODEL      (optional) — model name to request (default
 *                    `litellm:auto`, the value already in use here).
 *   CHAT_SESSION_HEADER (optional) — session-continuity header the leg
 *                    understands; set it only for a leg that keeps its own
 *                    session state (e.g. the Hermes endpoint).
 *
 * The `gbrain` client is wired for SEARCH + GRAPH + the memory verbs
 * (`context_pack` / `recall` / `volunteer_context`) exposed to the chat
 * surface, and `chat` is wired behind the ONE chat port. Both are exposed on
 * `Composition` so route handlers can reach them without constructing an
 * adapter. Nexalog makes no PROVIDER calls of its own: the model leg is a
 * separate endpoint behind `ChatRuntime`, and retrieval/embeddings stay in
 * GBrain.
 */

import {
  CreateCapture,
  ListInbox,
  ClaimCapture,
  ResolveReview,
  BrainStore,
  BrainIndex,
  GBrainClient,
  ChatRuntime,
  AssembleTurnContext,
  IdGen,
  Clock,
  Transcoder,
} from "@nexalog/core";
import {
  FsGitBrainStore,
  NullIndex,
  GBrainMcpClient,
  OpenAiCompatChatRuntime,
  SystemIdGen,
  SystemClock,
  FfmpegTranscoder,
} from "@nexalog/adapters";

const DEFAULT_GBRAIN_MCP_URL = "https://gbrain.example.com/mcp";

/** The model value already in use in this deployment. */
const DEFAULT_CHAT_MODEL = "litellm:auto";

export interface Composition {
  brainStore: BrainStore;
  brainIndex: BrainIndex;
  /** Read-only GBrain MCP client (search/graph/entity/memory verbs). Null when unconfigured. */
  gbrain: GBrainClient | null;
  /**
   * The ONE chat port: whatever hosts the TURN. Null when no leg is configured
   * — the surface then states that, rather than rendering a chat that cannot
   * answer.
   */
  chat: ChatRuntime | null;
  /** Per-turn context assembly (gbrain reads only — no provider calls). */
  assembleTurnContext: AssembleTurnContext | null;
  idGen: IdGen;
  clock: Clock;
  transcoder: Transcoder;
  createCapture: CreateCapture;
  listInbox: ListInbox;
  claimCapture: ClaimCapture;
  resolveReview: ResolveReview;
}

let cached: Composition | null = null;

export function getComposition(): Composition {
  if (cached) return cached;

  const repoPath = process.env.BRAIN_REPO;
  if (!repoPath) {
    throw new Error("BRAIN_REPO env is required (absolute path to the brain repo)");
  }

  const brainStore = new FsGitBrainStore({ repoPath });
  const brainIndex: BrainIndex = new NullIndex(repoPath);

  // GBrain MCP client — wired when BRAIN_INDEX=gbrain (or a URL is set). It is
  // constructed optimistically; individual calls throw GBrainMcpError on
  // transport/auth failure and route handlers degrade to the fs scan.
  const gbrainUrl = process.env.GBRAIN_MCP_URL || DEFAULT_GBRAIN_MCP_URL;
  const apiKey = process.env.GBRAIN_API_KEY;
  const wantGbrain = process.env.BRAIN_INDEX === "gbrain" || Boolean(apiKey);
  const gbrain: GBrainClient | null = wantGbrain
    ? new GBrainMcpClient({ url: gbrainUrl, apiKey: apiKey ?? "" })
    : null;

  const idGen = new SystemIdGen();
  const clock = new SystemClock();
  const transcoder = new FfmpegTranscoder();

  // The ONE chat port. `CHAT_BASE_URL` names the leg that hosts the TURN; with
  // it unset there is no chat leg, and `chat: null` is the honest state the
  // surface renders instead of a composer that cannot answer. The session
  // header is configured, never assumed: a leg without sessions must not
  // receive a header it does not read.
  const chatBaseUrl = process.env.CHAT_BASE_URL;
  const chatModel = process.env.CHAT_MODEL || DEFAULT_CHAT_MODEL;
  const chatSessionHeader = process.env.CHAT_SESSION_HEADER;
  const chat: ChatRuntime | null = chatBaseUrl
    ? new OpenAiCompatChatRuntime({
        id: process.env.CHAT_LEG_ID || "chat",
        baseUrl: chatBaseUrl,
        model: chatModel,
        ...(process.env.CHAT_API_KEY ? { apiKey: process.env.CHAT_API_KEY } : {}),
        ...(chatSessionHeader ? { sessionHeader: chatSessionHeader } : {}),
      })
    : null;

  cached = {
    brainStore,
    brainIndex,
    gbrain,
    chat,
    // Context assembly is gbrain-only, so it is available exactly when gbrain is.
    assembleTurnContext: gbrain ? new AssembleTurnContext(gbrain) : null,
    idGen,
    clock,
    transcoder,
    createCapture: new CreateCapture(brainStore, idGen, clock, transcoder),
    listInbox: new ListInbox(brainStore),
    claimCapture: new ClaimCapture(brainStore, clock),
    resolveReview: new ResolveReview(brainStore),
  };
  return cached;
}
