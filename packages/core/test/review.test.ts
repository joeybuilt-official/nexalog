// SPDX-License-Identifier: MIT
/**
 * Review transitions — the operator side of a `status: review` capture.
 *
 * These tests pin the two things the review API route depends on:
 *
 *   1. `Capture.acceptReview()` — the explicit `review → processed`
 *      transition. Before it existed, `ResolveReview` implemented "accept" by
 *      calling `markProcessed()`, whose guard only accepts `processing` — so
 *      accepting a capture that was actually IN review threw, and the operator
 *      had no working accept path at either end (use case or HTTP surface).
 *   2. the failure types the route maps to statuses — `CaptureNotFoundError`
 *      (→ 404) and `CaptureTransitionError` (→ 409) — so the transport can pick
 *      a status without string-matching a message.
 *
 * Pure in-process tests: the `BrainStore` port is faked in memory (no fs, no
 * db, no git), which is only possible because the use case depends on the port.
 */

import { describe, it, expect } from "vitest";
import { Capture, CaptureState } from "../src/domain/capture";
import { CaptureNotFoundError, CaptureTransitionError } from "../src/domain/errors";
import { ResolveReview } from "../src/application/review";
import { BrainStore } from "../src/ports";
import { Ulid } from "../src/domain/ulid";

const ID = "0123456789ABCDEFGHJKMNPQRS";

function baseState(overrides: Partial<CaptureState> = {}): CaptureState {
  return {
    id: Ulid.of(ID),
    title: "Voice note",
    body: "hello",
    type: "note",
    status: "inbox",
    kind: "audio",
    source: "pwa-share",
    capturedAt: new Date("2026-09-23T06:41:00Z"),
    claimedBy: null,
    claimedAt: null,
    attachments: [],
    originUrl: null,
    proposal: null,
    ...overrides,
  };
}

/** A review capture: the worker was unsure and escalated it to the operator. */
function reviewState(): CaptureState {
  return baseState({
    status: "review",
    claimedBy: "agent-primary",
    claimedAt: new Date("2026-09-23T06:42:00Z"),
    proposal: { pages: [], links: [], confidence: 0.4 },
  });
}

/** In-memory BrainStore — the port is the seam that keeps this test hermetic. */
class FakeBrainStore implements BrainStore {
  captures = new Map<string, CaptureState>();
  updates: CaptureState[] = [];

  async saveCapture(capture: Capture): Promise<void> {
    this.captures.set(capture.id.value, capture.state);
  }
  async getCapture(id: Ulid): Promise<CaptureState | null> {
    return this.captures.get(id.value) ?? null;
  }
  async listCaptures(): Promise<CaptureState[]> {
    return [...this.captures.values()];
  }
  async updateCapture(capture: Capture): Promise<void> {
    this.updates.push(capture.state);
    this.captures.set(capture.id.value, capture.state);
  }
  async getPage(): Promise<null> {
    return null;
  }
  async savePage(): Promise<void> {
    throw new Error("not used");
  }
  async saveAttachment(): Promise<{ path: string }> {
    throw new Error("not used");
  }
}

describe("Capture.acceptReview", () => {
  it("moves a review capture to processed", () => {
    const c = new Capture(reviewState());
    c.acceptReview();
    expect(c.status).toBe("processed");
  });

  it("keeps the proposal on the state (the record of what was accepted)", () => {
    const c = new Capture(reviewState());
    c.acceptReview();
    expect(c.state.proposal).toEqual({ pages: [], links: [], confidence: 0.4 });
  });

  it("refuses a capture that is not in review", () => {
    for (const status of ["inbox", "processing", "processed", "rejected"] as const) {
      const c = new Capture(baseState({ status }));
      expect(() => c.acceptReview()).toThrow(CaptureTransitionError);
    }
  });

  it("refuses a second accept (review is the only entry)", () => {
    const c = new Capture(reviewState());
    c.acceptReview();
    expect(() => c.acceptReview()).toThrow(CaptureTransitionError);
  });
});

describe("ResolveReview", () => {
  it("accepts a review capture: review → processed, and persists it", async () => {
    const store = new FakeBrainStore();
    store.captures.set(ID, reviewState());

    await new ResolveReview(store).execute({ captureId: Ulid.of(ID), accept: true });

    expect(store.captures.get(ID)?.status).toBe("processed");
    expect(store.updates.map((s) => s.status)).toEqual(["processed"]);
  });

  it("rejects a review capture: review → rejected, and persists it", async () => {
    const store = new FakeBrainStore();
    store.captures.set(ID, reviewState());

    await new ResolveReview(store).execute({ captureId: Ulid.of(ID), accept: false });

    expect(store.captures.get(ID)?.status).toBe("rejected");
    expect(store.updates.map((s) => s.status)).toEqual(["rejected"]);
  });

  it("refuses to accept a capture that is still processing", async () => {
    const store = new FakeBrainStore();
    store.captures.set(
      ID,
      baseState({ status: "processing", claimedBy: "agent-primary", claimedAt: new Date() }),
    );

    await expect(
      new ResolveReview(store).execute({ captureId: Ulid.of(ID), accept: true }),
    ).rejects.toThrow(CaptureTransitionError);
    expect(store.updates).toEqual([]);
  });

  it("refuses to resolve a capture that was never claimed", async () => {
    const store = new FakeBrainStore();
    store.captures.set(ID, baseState({ status: "inbox" }));

    await expect(
      new ResolveReview(store).execute({ captureId: Ulid.of(ID), accept: true }),
    ).rejects.toThrow(CaptureTransitionError);
    await expect(
      new ResolveReview(store).execute({ captureId: Ulid.of(ID), accept: false }),
    ).rejects.toThrow(CaptureTransitionError);
    expect(store.updates).toEqual([]);
  });

  it("refuses to resolve twice", async () => {
    const store = new FakeBrainStore();
    store.captures.set(ID, reviewState());
    const useCase = new ResolveReview(store);

    await useCase.execute({ captureId: Ulid.of(ID), accept: false });
    await expect(useCase.execute({ captureId: Ulid.of(ID), accept: false })).rejects.toThrow(
      CaptureTransitionError,
    );
  });

  it("reports a missing capture as CaptureNotFoundError, carrying the id", async () => {
    const store = new FakeBrainStore();

    await expect(
      new ResolveReview(store).execute({ captureId: Ulid.of(ID), accept: true }),
    ).rejects.toThrow(CaptureNotFoundError);
    await expect(
      new ResolveReview(store).execute({ captureId: Ulid.of(ID), accept: true }),
    ).rejects.toMatchObject({ captureId: ID });
  });
});
