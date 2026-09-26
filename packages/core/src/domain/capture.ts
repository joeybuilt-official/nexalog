/**
 * Capture — the aggregate root for an inbox item.
 *
 * A capture is a single markdown file `inbox/<ulid>.md` in the brain repo. The
 * domain object holds the full state that file encodes; serialization to/from
 * the `nexalog` frontmatter block lives in `contracts` (shared with adapters),
 * not here — the entity is pure state + invariants.
 */

import { Ulid } from "./ulid";
import {
  CaptureStatus,
  CaptureKind,
  CaptureSource,
} from "./capture-status";
import { CaptureTransitionError } from "./errors";
import { PageType } from "./page-type";

export interface Proposal {
  pages: Array<{ slug: string; type: PageType; title: string }>;
  links: string[];
  confidence: number; // 0..1
}

export interface Attachment {
  path: string; // relative to repo root, e.g. attachments/2026/09/01J8….opus
  kind: CaptureKind;
  sizeBytes: number;
  mimeType?: string;
}

export interface CaptureState {
  id: Ulid;
  title: string;
  body: string; // text, URL, or transcript once processed
  type: PageType; // GBrain type; Hermes may retype on processing
  status: CaptureStatus;
  kind: CaptureKind;
  source: CaptureSource;
  capturedAt: Date;
  claimedBy: string | null;
  claimedAt: Date | null;
  attachments: Attachment[];
  originUrl: string | null;
  proposal: Proposal | null;
}

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB body guard
const MAX_TITLE_LEN = 200;

export class Capture {
  constructor(readonly state: CaptureState) {}

  get id(): Ulid {
    return this.state.id;
  }
  get status(): CaptureStatus {
    return this.state.status;
  }

  /** Claim the capture for processing. The commit is the lock (see plan §1.6). */
  claim(by: string, at: Date): void {
    if (this.state.status !== "inbox") {
      throw new CaptureTransitionError({
        captureId: this.state.id.value,
        from: this.state.status,
        to: "processing",
        rule: `Cannot claim capture in status "${this.state.status}" (only "inbox")`,
      });
    }
    if (!by.trim()) throw new Error("claimed_by must be non-empty");
    this.state.status = "processing";
    this.state.claimedBy = by;
    this.state.claimedAt = at;
  }

  /** Mark processed (original kept 30 days per D6). */
  markProcessed(): void {
    if (this.state.status !== "processing") {
      throw new CaptureTransitionError({
        captureId: this.state.id.value,
        from: this.state.status,
        to: "processed",
        rule: "Only a processing capture can be marked processed",
      });
    }
    this.state.status = "processed";
  }

  /**
   * Operator accepts a review proposal — the `review → processed` transition.
   *
   * Distinct from `markProcessed()` on purpose: that guard accepts only
   * `processing`, so an accepted review needs its own entry point rather than a
   * loosened guard. Review has exactly two exits (accept → processed, reject →
   * rejected), so this is deliberately NOT a general status setter.
   */
  acceptReview(): void {
    if (this.state.status !== "review") {
      throw new CaptureTransitionError({
        captureId: this.state.id.value,
        from: this.state.status,
        to: "processed",
        rule: "Only a review capture can be accepted",
      });
    }
    this.state.status = "processed";
  }

  /** Send to review with a proposal (Hermes was unsure). */
  markReview(proposal: Proposal): void {
    if (this.state.status !== "processing") {
      throw new CaptureTransitionError({
        captureId: this.state.id.value,
        from: this.state.status,
        to: "review",
        rule: "Only a processing capture can be sent to review",
      });
    }
    if (proposal.confidence < 0 || proposal.confidence > 1) {
      throw new Error("proposal.confidence must be within 0..1");
    }
    this.state.status = "review";
    this.state.proposal = proposal;
  }

  /** Operator rejects a review proposal. */
  reject(): void {
    if (this.state.status !== "review") {
      throw new CaptureTransitionError({
        captureId: this.state.id.value,
        from: this.state.status,
        to: "rejected",
        rule: "Only a review capture can be rejected",
      });
    }
    this.state.status = "rejected";
  }

  static validate(s: CaptureState): void {
    if (!s.title.trim()) throw new Error("capture.title is required");
    if (s.title.length > MAX_TITLE_LEN)
      throw new Error(`capture.title exceeds ${MAX_TITLE_LEN} chars`);
    if (s.body.length > MAX_BODY_BYTES)
      throw new Error("capture.body exceeds 10 MB");
    if (s.claimedBy !== null && !s.claimedBy.trim())
      throw new Error("claimed_by must be null or non-empty");
    if ((s.claimedBy === null) !== (s.claimedAt === null))
      throw new Error("claimed_by and claimed_at must be set together");
  }
}
