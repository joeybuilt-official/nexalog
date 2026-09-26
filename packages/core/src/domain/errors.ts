// SPDX-License-Identifier: MIT
/**
 * Domain errors — failures a caller can branch on.
 *
 * Capture transitions fail for reasons the operator-facing surfaces must be
 * able to distinguish: "this capture does not exist" (the operator is looking
 * at a stale row) versus "this capture is not in a state that allows that
 * transition" (the worker or another tab moved it underneath them). Both are
 * business-rule failures, so they are named domain types raised by `core` —
 * never an HTTP status, never a framework exception (`error-handling.md`:
 * "errors belong to the layer that raised them"). Mapping them onto transport
 * statuses is the route's job, and the stable `code` is what a client branches
 * on — never the message text.
 */

/** Thrown when a capture id has no `inbox/<ulid>.md` behind it. */
export class CaptureNotFoundError extends Error {
  readonly code = "capture_not_found";
  /** The ULID that was looked up — safe to log and to return to the caller. */
  readonly captureId: string;

  constructor(captureId: string) {
    super(`Capture ${captureId} not found`);
    this.name = "CaptureNotFoundError";
    this.captureId = captureId;
  }
}

/**
 * Thrown when a transition is illegal for the capture's current status.
 * Carries both endpoints so the caller can report what actually happened —
 * e.g. accepting a review the worker has already resolved.
 */
export class CaptureTransitionError extends Error {
  readonly code = "invalid_transition";
  readonly captureId: string;
  /** Status the capture was in when the transition was attempted. */
  readonly from: string;
  /** Status the caller asked for. */
  readonly to: string;

  constructor(input: { captureId: string; from: string; to: string; rule: string }) {
    super(input.rule);
    this.name = "CaptureTransitionError";
    this.captureId = input.captureId;
    this.from = input.from;
    this.to = input.to;
  }
}
