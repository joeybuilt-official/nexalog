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
 *
 * The `gbrain` client is wired for SEARCH + GRAPH (Phase 2b) and exposed on
 * `Composition` so route handlers can reach it directly for graph/entity reads
 * beyond the `BrainIndex` surface. It is never used for LLM calls — Nexalog
 * only calls GBrain's MCP tools.
 */

import {
  CreateCapture,
  ListInbox,
  ClaimCapture,
  ResolveReview,
  BrainStore,
  BrainIndex,
  GBrainClient,
  IdGen,
  Clock,
  Transcoder,
} from "@nexalog/core";
import {
  FsGitBrainStore,
  NullIndex,
  GBrainMcpClient,
  SystemIdGen,
  SystemClock,
  FfmpegTranscoder,
} from "@nexalog/adapters";

const DEFAULT_GBRAIN_MCP_URL = "https://gbrain.example.com/mcp";

export interface Composition {
  brainStore: BrainStore;
  brainIndex: BrainIndex;
  /** Read-only GBrain MCP client (search/graph/entity). Null when unconfigured. */
  gbrain: GBrainClient | null;
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

  cached = {
    brainStore,
    brainIndex,
    gbrain,
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
