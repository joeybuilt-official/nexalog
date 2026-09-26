/**
 * ClaimCapture / ResolveReview — the Hermes-side and operator-side transitions.
 *
 * ClaimCapture atomically flips inbox → processing (the commit is the lock).
 * ResolveReview applies an operator accept/reject to a review proposal.
 */

import { Capture } from "../domain/capture";
import { CaptureNotFoundError } from "../domain/errors";
import { Ulid } from "../domain/ulid";
import { BrainStore, Clock } from "../ports";

export class ClaimCapture {
  constructor(
    private readonly store: BrainStore,
    private readonly clock: Clock,
  ) {}

  async execute(input: { captureId: Ulid; by: string }): Promise<void> {
    const state = await this.store.getCapture(input.captureId);
    if (!state) throw new CaptureNotFoundError(input.captureId.value);
    const capture = new Capture(state);
    capture.claim(input.by, this.clock.now());
    await this.store.updateCapture(capture);
  }
}

export class ResolveReview {
  constructor(private readonly store: BrainStore) {}

  /**
   * Apply the operator's decision to a `status: review` capture.
   *
   * Accept and reject leave through the capture's own methods so the review
   * guard lives in exactly one place: accept must NOT go through
   * `markProcessed()` (that transition is `processing → processed`, and a
   * review capture would — correctly — be refused by it).
   */
  async execute(input: { captureId: Ulid; accept: boolean }): Promise<void> {
    const state = await this.store.getCapture(input.captureId);
    if (!state) throw new CaptureNotFoundError(input.captureId.value);
    const capture = new Capture(state);
    if (input.accept) {
      capture.acceptReview();
    } else {
      capture.reject();
    }
    await this.store.updateCapture(capture);
  }
}
