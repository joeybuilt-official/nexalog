/**
 * Adapters barrel — infra implementations. Depends on `core` only.
 */

export { FsGitBrainStore, type FsGitBrainStoreOptions } from "./brain-fs-git/fs-git-brain-store";
export { NullIndex } from "./gbrain-null/null-index";
export { SystemIdGen, SystemClock } from "./system/id-gen";
export { FfmpegTranscoder } from "./media/ffmpeg-transcoder";
export {
  GBrainMcpClient,
  GBrainMcpError,
  type GBrainMcpClientOptions,
} from "./gbrain-mcp/gbrain-mcp-client";
export {
  DrizzleAppStateRepo,
  sha256Hex,
  type DrizzleAppStateRepoOptions,
} from "./db-drizzle/drizzle-app-state-repo";
export {
  GbrainProposalQueue,
  type GbrainProposalQueueOptions,
} from "./gbrain-proposals/gbrain-proposal-queue";
export {
  OpenAiCompatChatRuntime,
  ChatRuntimeUnreachableError,
  parseSseStream,
  type OpenAiCompatChatRuntimeOptions,
} from "./chat-openai/openai-compat-chat-runtime";
