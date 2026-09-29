// SPDX-License-Identifier: MIT
/**
 * The proposal adjudication rules, pinned.
 *
 * The defect these tests describe: gbrain's `take_proposals` queue had 170
 * pending rows, 92 rejected, and ZERO ever promoted — no surface, no write
 * path. What made that state survivable is that the rules for draining it were
 * never written down anywhere reachable, so this file states them:
 *
 *   - a promoted take APPENDS at (max row on the page) + 1, never renumbers —
 *     gbrain's fences are append-only and `slug#N` references depend on it;
 *   - the kind a legacy or hand-inserted row carries is coerced, not trusted;
 *   - a claim that would corrupt the markdown fence is refused by the same
 *     guards gbrain's own writer applies, and the reason is nameable;
 *   - an accept that produced no take is a contradiction, not a success.
 *
 * `AdjudicateProposal` is driven through an in-memory `ProposalQueue` — no
 * database, no HTTP — which is the point: the decision an operator makes is
 * domain logic and must be testable without booting infrastructure.
 */

import { describe, it, expect, vi } from "vitest";

import {
  AdjudicateProposal,
  ProposalQueueError,
  coerceProposalKind,
  describeStrandedProposal,
  nextTakeRowNum,
  promotionSource,
  unpromotableReason,
  unsafeFenceCellReason,
  type ProposalQueue,
  type TakeProposal,
} from "../src/index";

function proposal(over: Partial<TakeProposal> = {}): TakeProposal {
  return {
    id: 7,
    sourceId: "default",
    pageSlug: "notes/example-page",
    claimText: "A claim the extractor proposed.",
    kind: "take",
    holder: "brain",
    weight: 0.6,
    domain: "software",
    status: "pending",
    proposedAt: new Date("2026-09-28T09:24:07.013Z"),
    modelId: "litellm:auto",
    promotedRowNum: null,
    actedAt: null,
    actedBy: null,
    ...over,
  };
}

/** Minimal in-memory queue: records the call, returns a fixed outcome. */
function fakeQueue(
  outcome: { proposal?: TakeProposal; promoted?: { pageSlug: string; rowNum: number } | null } = {},
) {
  const act = vi.fn(async () => ({
    proposal: outcome.proposal ?? proposal({ status: "accepted", actedAt: new Date(), actedBy: "operator-1" }),
    promoted: outcome.promoted === undefined ? { pageSlug: "notes/example-page", rowNum: 1 } : outcome.promoted,
  }));
  const queue: ProposalQueue = {
    list: vi.fn(async () => ({
      proposals: [],
      counts: { pending: 0, accepted: 0, rejected: 0, superseded: 0 },
      nextOffset: null,
    })),
    act,
  };
  return { queue, act };
}

describe("accepting a proposal", () => {
  it("asks the queue to act, and returns the promoted take", async () => {
    const { queue, act } = fakeQueue();
    const useCase = new AdjudicateProposal(queue);

    const result = await useCase.execute({ proposalId: 7, accept: true, actedBy: "operator-1" });

    expect(act).toHaveBeenCalledTimes(1);
    expect(act).toHaveBeenCalledWith({ proposalId: 7, accept: true, actedBy: "operator-1" });
    expect(result.promoted).toEqual({ pageSlug: "notes/example-page", rowNum: 1 });
  });

  it("carries the row number the promote produced back to the caller", async () => {
    const { queue } = fakeQueue({
      proposal: proposal({ status: "accepted", promotedRowNum: 4 }),
      promoted: { pageSlug: "notes/example-page", rowNum: 4 },
    });
    const result = await new AdjudicateProposal(queue).execute({
      proposalId: 7,
      accept: true,
      actedBy: "operator-1",
    });

    expect(result.proposal.promotedRowNum).toBe(4);
    expect(result.promoted?.rowNum).toBe(4);
  });

  it("refuses a success claim with no promoted take — a contradiction, not a result", async () => {
    // The failure this pins: a route that answers 200 {ok:true} for an accept
    // that wrote nothing. The operator would believe the queue drained.
    const { queue } = fakeQueue({ promoted: null });

    await expect(
      new AdjudicateProposal(queue).execute({ proposalId: 7, accept: true, actedBy: "operator-1" }),
    ).rejects.toThrow(/claimed as accepted but no take row was promoted/);
  });

  it("allows a reject to promote nothing", async () => {
    const { queue } = fakeQueue({
      proposal: proposal({ status: "rejected" }),
      promoted: null,
    });

    const result = await new AdjudicateProposal(queue).execute({
      proposalId: 7,
      accept: false,
      actedBy: "operator-1",
    });

    expect(result.promoted).toBeNull();
  });
});

describe("proposal id validation", () => {
  it.each([
    ["zero", 0],
    ["negative", -3],
    ["fractional", 1.5],
    ["not a number", Number.NaN],
  ])("rejects a %s id before touching the queue", async (_label, id) => {
    const { queue, act } = fakeQueue();
    const useCase = new AdjudicateProposal(queue);

    await expect(
      useCase.execute({ proposalId: id, accept: true, actedBy: "operator-1" }),
    ).rejects.toBeInstanceOf(ProposalQueueError);
    expect(act).not.toHaveBeenCalled();
  });

  it("surfaces the queue's typed failure unchanged", async () => {
    const act = vi.fn(async () => {
      throw new ProposalQueueError({
        code: "not_pending",
        proposalId: 7,
        message: "Proposal #7 is already 'rejected'.",
      });
    });
    const useCase = new AdjudicateProposal({ list: vi.fn(), act });

    const err = await useCase
      .execute({ proposalId: 7, accept: true, actedBy: "operator-1" })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ProposalQueueError);
    expect((err as ProposalQueueError).code).toBe("not_pending");
    expect((err as ProposalQueueError).proposalId).toBe(7);
  });
});

describe("take row numbering is append-only", () => {
  it("starts at 1 on a page with no takes", () => {
    expect(nextTakeRowNum([])).toBe(1);
  });

  it("appends past the highest existing row", () => {
    expect(nextTakeRowNum([1, 2, 3])).toBe(4);
    // Order is not assumed: gbrain's fences are append-only but a rebuild can
    // hand the rows over in any order.
    expect(nextTakeRowNum([3, 1, 2])).toBe(4);
  });

  it("never renumbers, even when a row is missing from the middle", () => {
    // The invariant that keeps `slug#N` cross-page references valid: a gap is
    // not reused, because reusing it would silently rewrite what #2 refers to.
    expect(nextTakeRowNum([1, 3])).toBe(4);
  });

  it("ignores non-finite values rather than poisoning the row number", () => {
    expect(nextTakeRowNum([1, Number.NaN, Number.POSITIVE_INFINITY])).toBe(2);
  });
});

describe("kind coercion", () => {
  it("passes the four canonical kinds through", () => {
    for (const kind of ["fact", "take", "bet", "hunch"] as const) {
      expect(coerceProposalKind(kind)).toBe(kind);
    }
  });

  it("maps the raw extractor spelling 'prediction' to 'bet'", () => {
    expect(coerceProposalKind("prediction")).toBe("bet");
  });

  it("collapses an unknown kind to 'take' rather than trusting the column", () => {
    expect(coerceProposalKind("nonsense")).toBe("take");
    expect(coerceProposalKind("")).toBe("take");
  });
});

describe("fence-cell guards", () => {
  it("accepts an ordinary single-line claim", () => {
    expect(unsafeFenceCellReason("Latency is dominated by the cold start.")).toBeNull();
  });

  it("refuses a newline — one cell must not be able to mint extra table rows", () => {
    expect(unsafeFenceCellReason("first line\nsecond line")).toMatch(/control characters/);
  });

  it("refuses the fence marker text — it would close the fence early", () => {
    expect(unsafeFenceCellReason("see gbrain:takes for details")).toMatch(/fence marker/);
  });

  it("refuses a wholly strikethrough claim — it would land inactive", () => {
    expect(unsafeFenceCellReason("~~everything is fine~~")).toMatch(/strikethrough/);
  });

  it("allows partial strikethrough, which round-trips as active", () => {
    expect(unsafeFenceCellReason("~~not~~ a strike")).toBeNull();
  });
});

describe("unpromotableReason", () => {
  it("is null for a promotable proposal", () => {
    expect(unpromotableReason({ claimText: "A fine claim.", weight: 0.6 })).toBeNull();
  });

  it("names an empty claim", () => {
    expect(unpromotableReason({ claimText: "   ", weight: 0.6 })).toMatch(/empty claim/);
  });

  it.each([
    ["above range", 1.5],
    ["below range", -0.1],
    ["not finite", Number.NaN],
  ])("names a weight that is %s", (_label, weight) => {
    expect(unpromotableReason({ claimText: "Fine.", weight })).toMatch(/weight outside/);
  });

  it("propagates the fence-guard reason for the claim", () => {
    expect(unpromotableReason({ claimText: "a\nb", weight: 0.5 })).toMatch(/control characters/);
  });
});

describe("promotion provenance", () => {
  it("names the proposal a promoted take came from", () => {
    expect(promotionSource(7)).toBe("nexalog:proposal#7");
  });
});

describe("describeStrandedProposal", () => {
  it("names the repairable accepted-with-no-row shape", () => {
    const note = describeStrandedProposal(proposal({ status: "accepted", promotedRowNum: null }));
    expect(note).toMatch(/stranded/);
    expect(note).toMatch(/UPDATE take_proposals SET status='pending'/);
  });

  it("is silent for a healthy accept", () => {
    expect(describeStrandedProposal(proposal({ status: "accepted", promotedRowNum: 3 }))).toBeNull();
  });

  it("is silent for every non-accepted status", () => {
    for (const status of ["pending", "rejected", "superseded"] as const) {
      expect(describeStrandedProposal(proposal({ status }))).toBeNull();
    }
  });
});
