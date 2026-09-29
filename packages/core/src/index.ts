/**
 * Package barrel — the only surface consumers (adapters, web) import from.
 */

// domain
export { Ulid } from "./domain/ulid";
export { Slug } from "./domain/slug";
export { Capture, type CaptureState, type Proposal, type Attachment } from "./domain/capture";
export { CaptureNotFoundError, CaptureTransitionError } from "./domain/errors";
export {
  PAGE_TYPES,
  PAGE_TYPE_LABELS,
  type PageType,
  isPageType,
} from "./domain/page-type";
export {
  CAPTURE_STATUSES,
  CAPTURE_KINDS,
  CAPTURE_SOURCES,
  type CaptureStatus,
  type CaptureKind,
  type CaptureSource,
  isCaptureStatus,
} from "./domain/capture-status";
export {
  ATTACHMENT_KINDS,
  deriveAttachmentKind,
  captureKindFromAttachments,
  isAttachmentKind,
  type AttachmentKind,
} from "./domain/attachment-kind";
export {
  TAKE_KINDS,
  PROPOSAL_STATUSES,
  coerceProposalKind,
  nextTakeRowNum,
  unsafeFenceCellReason,
  unpromotableReason,
  promotionSource,
  type TakeKind,
  type ProposalStatus,
  type TakeProposal,
  type ProposalStatusCounts,
  type PromotedTake,
} from "./domain/take-proposal";

// contracts
export {
  serializeCapture,
  parseCapture,
  CAPTURE_SCHEMA_VERSION,
} from "./contracts/frontmatter";

// ports
export type {
  IdGen,
  Clock,
  BrainStore,
  BrainIndex,
  AppStateRepo,
  Transcoder,
  CaptureIndexRow,
  InboxIndexFilter,
  InboxIndexPage,
  ApiTokenCreated,
  ApiTokenView,
  GBrainClient,
  GBrainSearchHit,
  GBrainPage,
  GBrainPageSummary,
  GBrainPageSort,
  GBrainListPagesOptions,
  GBrainLink,
  GBrainEntity,
  ProposalFailureCode,
  ProposalPage,
  ProposalQueue,
} from "./ports";
// ProposalQueueError is a class (value + type), so it leaves the `export type`
// block — a value imported through a type-only export is unusable at runtime.
export { ProposalQueueError } from "./ports";

// application
export { CreateCapture, type CreateCaptureInput, type CreateCaptureOutput } from "./application/create-capture";
export { ListInbox, type ListInboxInput, type CaptureSummary, type CaptureProposalBlock } from "./application/list-inbox";
export { ClaimCapture, ResolveReview } from "./application/review";
export { ReindexRepo, toIndexRow, type ReindexRepoResult, type BodyHasher } from "./application/reindex-repo";
export {
  AdjudicateProposal,
  describeStrandedProposal,
  type AdjudicateProposalInput,
  type AdjudicateProposalResult,
} from "./application/adjudicate-proposal";
