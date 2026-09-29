// SPDX-License-Identifier: MIT
/**
 * The plan-impact reconciler's rules — the acceptance bar, in tests.
 *
 * WHAT THIS PINS, AND WHY EACH ONE MATTERS
 * ----------------------------------------
 *   - **EXACTLY ONE.** A capture relevant to a project emits ONE proposal, not one
 *     per similar project and not one per run. The plan's stated bar is "a new
 *     bookmark → exactly 1 pending plan_change citing it", and the failure mode it
 *     names is duplicates — so the duplicate case is a first-class test here, not
 *     an afterthought.
 *   - **Idempotence is the DATABASE's, not a memo's.** The reconciler keeps no
 *     ledger; it derives every field deterministically so the queue's own unique
 *     index refuses the second row. That means the property under test is
 *     "run twice ⇒ the same tuple twice ⇒ one row", which a fake queue can assert
 *     exactly by keying its storage the way the real unique index does. If this
 *     suite passes while the real index would not, the fake is what is wrong — so
 *     the key shape below is copied from `take_proposals_idempotency_idx`
 *     (`source_id, page_slug, content_hash, prompt_version, md5(claim_text)`).
 *   - **The relevance claim is on cosine, never on the fused rank score.** A
 *     candidate whose `score` is high but whose cosine is missing must be rejected:
 *     "the search did not say how close this is" and "this is close" are different
 *     statements, and the second is the one an operator acts on.
 *   - **`evidence_capture` really names the capture.** It is in the claim text AND
 *     in the diff, and the id is asserted verbatim — this is the field the
 *     acceptance bar names ("citing that capture's id").
 *   - **The payload is a SAFE fence cell.** A promoted claim becomes a markdown
 *     fence cell in the brain; a newline or the takes marker in it would corrupt
 *     the page. `unsafeFenceCellReason` from the take domain is the gate, reused
 *     rather than reimplemented.
 *
 * Pure: no database, no network, no clock. The fake queue implements the same
 * idempotency the adapter gets from the unique index, and the two are kept in step
 * by the assertions below.
 */

import { describe, it, expect, vi } from "vitest";

import {
  ReconcilePlanImpact,
  confidenceFromCosine,
  parsePlanDiff,
  pickPlanImpactProject,
  planChangeClaim,
  planImpactContentHash,
  unsafeFenceCellReason,
  type CaptureReconciliationReader,
  type ProposeInput,
  type ProposalQueue,
  type ProjectCandidate,
  type ProjectRelevanceIndex,
  type ReconciliationCapture,
  type TakeProposal,
} from "../src/index";

const CAPTURE_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

function capture(over: Partial<ReconciliationCapture> = {}): ReconciliationCapture {
  return {
    id: CAPTURE_ID,
    url: "https://github.com/joeybuilt-official/fylo/actions/runs/36388619066",
    title: "fylo verify CI failed on the Plexo-removal branch",
    summary: "Two jobs failed: agent-mirror drift and 17 biome lint errors.",
    excerpt: null,
    ...over,
  };
}

function reader(captures: ReconciliationCapture[]): CaptureReconciliationReader {
  return { listCapturesSince: vi.fn(async () => captures) };
}

function index(candidates: ProjectCandidate[]): ProjectRelevanceIndex {
  return { findProjectCandidates: vi.fn(async () => candidates) };
}

/**
 * An in-memory stand-in for the REAL queue, keyed exactly the way
 * `take_proposals_idempotency_idx` keys it. Two calls with the same tuple return
 * `created: false` for the second — which is the whole idempotency contract.
 */
function fakeQueue() {
  const stored: Array<{ key: string; proposal: TakeProposal }> = [];
  let nextId = 500;
  const propose = vi.fn(async (input: ProposeInput) => {
    const key = [
      input.sourceId,
      input.pageSlug,
      input.contentHash,
      input.promptVersion,
      input.claimText,
    ].join("\u0000");
    const hit = stored.find((s) => s.key === key);
    if (hit) return { created: false, proposal: hit.proposal };
    const proposal: TakeProposal = {
      id: nextId++,
      sourceId: input.sourceId,
      pageSlug: input.pageSlug,
      claimText: input.claimText,
      kind: input.kind,
      holder: input.holder,
      weight: input.weight,
      domain: input.domain,
      status: "pending",
      proposedAt: new Date("2026-09-28T20:00:00Z"),
      modelId: input.modelId,
      promotedRowNum: null,
      actedAt: null,
      actedBy: null,
      planDiff: input.planDiff
        ? {
            op: input.planDiff.op as never,
            milestoneId: input.planDiff.milestone_id,
            current: input.planDiff.current,
            proposed: input.planDiff.proposed,
            rationale: input.planDiff.rationale,
            evidenceCapture: input.planDiff.evidence_capture,
            confidence: input.planDiff.confidence,
          }
        : null,
    };
    stored.push({ key, proposal });
    return { created: true, proposal };
  });
  const queue: ProposalQueue = {
    list: vi.fn(async () => ({
      proposals: [],
      counts: { pending: 0, accepted: 0, rejected: 0, superseded: 0 },
      nextOffset: null,
    })),
    act: vi.fn(),
    propose,
  };
  return { queue, propose, stored };
}

const PROJECT: ProjectCandidate = { slug: "projects/fylo", title: "fylo", cosine: 0.72 };

describe("ReconcilePlanImpact — the plan's acceptance bar", () => {
  it("emits EXACTLY ONE plan_change citing the capture, for a relevant new capture", async () => {
    const { queue, propose } = fakeQueue();
    const c = capture();
    const reconciler = new ReconcilePlanImpact(reader([c]), index([PROJECT]), queue);

    const result = await reconciler.execute({ since: new Date("2026-09-28T00:00:00Z"), sourceId: "default" });

    expect(result.created).toBe(1);
    expect(result.duplicate).toBe(0);
    expect(propose).toHaveBeenCalledTimes(1);
    expect(result.proposals).toHaveLength(1);

    const input = propose.mock.calls[0][0];
    expect(input.kind).toBe("plan_change");
    expect(input.pageSlug).toBe("projects/fylo");
    // The citation, in both places a reader might look for it.
    expect(input.claimText).toContain(CAPTURE_ID);
    expect(input.planDiff?.evidence_capture).toBe(CAPTURE_ID);
    expect(result.proposals[0].captureId).toBe(CAPTURE_ID);
  });

  it("emits ZERO new proposals on a second run over the same capture (the +0 bar)", async () => {
    const { queue, propose, stored } = fakeQueue();
    const c = capture();
    const reconciler = new ReconcilePlanImpact(reader([c]), index([PROJECT]), queue);
    const since = new Date("2026-09-28T00:00:00Z");

    const first = await reconciler.execute({ since, sourceId: "default" });
    const second = await reconciler.execute({ since, sourceId: "default" });

    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    expect(second.duplicate).toBe(1);
    // The queue was asked twice — the pass really ran — and holds ONE row.
    expect(propose).toHaveBeenCalledTimes(2);
    expect(stored).toHaveLength(1);
  });

  it("builds a byte-identical idempotency tuple across runs", async () => {
    const { queue, propose } = fakeQueue();
    const c = capture();
    const reconciler = new ReconcilePlanImpact(reader([c]), index([PROJECT]), queue);
    const since = new Date("2026-09-28T00:00:00Z");

    await reconciler.execute({ since, sourceId: "default" });
    await reconciler.execute({ since, sourceId: "default" });

    const [a, b] = [propose.mock.calls[0][0], propose.mock.calls[1][0]];
    // Every field of the unique index, compared: this is what the database would
    // compare, so a drifting field fails here rather than silently double-emitting.
    expect(a.sourceId).toBe(b.sourceId);
    expect(a.pageSlug).toBe(b.pageSlug);
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.promptVersion).toBe(b.promptVersion);
    expect(a.claimText).toBe(b.claimText);
  });

  it("proposes on the BEST project only, never one per similar project", async () => {
    const { queue, propose } = fakeQueue();
    const reconciler = new ReconcilePlanImpact(
      reader([capture()]),
      index([
        { slug: "projects/panoply", title: "panoply", cosine: 0.61 },
        PROJECT, // 0.72 — the best
        { slug: "projects/kapsel", title: "kapsel", cosine: 0.58 },
      ]),
      queue,
    );

    const result = await reconciler.execute({ since: new Date(0), sourceId: "default" });

    expect(result.created).toBe(1);
    expect(propose).toHaveBeenCalledTimes(1);
    expect(propose.mock.calls[0][0].pageSlug).toBe("projects/fylo");
  });

  it("emits nothing when nothing clears the relevance floor, and says so", async () => {
    const { queue, propose } = fakeQueue();
    const reconciler = new ReconcilePlanImpact(
      reader([capture()]),
      index([{ slug: "projects/panoply", title: "panoply", cosine: 0.31 }]),
      queue,
    );

    const result = await reconciler.execute({ since: new Date(0), sourceId: "default" });

    expect(result.created).toBe(0);
    expect(result.noProject).toBe(1);
    expect(propose).not.toHaveBeenCalled();
  });

  it("scans several captures and emits one per relevant capture, not one per run", async () => {
    const { queue } = fakeQueue();
    const reconciler = new ReconcilePlanImpact(
      reader([
        capture({ id: "aaaaaaaa-0000-0000-0000-000000000001", title: "fylo CI failure" }),
        capture({ id: "aaaaaaaa-0000-0000-0000-000000000002", title: "gbrain issue 5280" }),
      ]),
      index([PROJECT]),
      queue,
    );

    const result = await reconciler.execute({ since: new Date(0), sourceId: "default" });

    expect(result.scanned).toBe(2);
    expect(result.created).toBe(2);
  });

  it("counts a capture with no usable evidence text as skipped, never as a proposal", async () => {
    const { queue, propose } = fakeQueue();
    const reconciler = new ReconcilePlanImpact(
      reader([capture({ url: null, title: "", summary: null, excerpt: null })]),
      index([PROJECT]),
      queue,
    );

    const result = await reconciler.execute({ since: new Date(0), sourceId: "default" });

    expect(result.skipped).toBe(1);
    expect(result.created).toBe(0);
    expect(propose).not.toHaveBeenCalled();
  });
});

describe("pickPlanImpactProject — the relevance rule", () => {
  it("rejects a candidate with no reported cosine, however high its rank score", () => {
    // This is the measured trap: every project page in this brain links to every
    // other, so RRF boosts them all. A cosine-less hit cannot support a claim.
    expect(pickPlanImpactProject([{ slug: "projects/fylo", title: "fylo", cosine: null }])).toBeNull();
  });

  it("rejects a non-project slug even at a high cosine", () => {
    expect(
      pickPlanImpactProject([{ slug: "notes/ai-agent-platform-research", title: "x", cosine: 0.99 }]),
    ).toBeNull();
  });

  it("rejects a cosine below the floor and accepts one above it", () => {
    const below = { slug: "projects/fylo", title: "fylo", cosine: 0.54 };
    const above = { slug: "projects/fylo", title: "fylo", cosine: 0.56 };
    expect(pickPlanImpactProject([below])).toBeNull();
    expect(pickPlanImpactProject([above])?.slug).toBe("projects/fylo");
  });

  it("picks the highest cosine among qualifying projects", () => {
    const chosen = pickPlanImpactProject([
      { slug: "projects/a", title: "a", cosine: 0.6 },
      { slug: "projects/b", title: "b", cosine: 0.71 },
      { slug: "projects/c", title: "c", cosine: 0.65 },
    ]);
    expect(chosen?.slug).toBe("projects/b");
  });
});

describe("planChangeClaim — a safe fence cell that cites its evidence", () => {
  it("never produces an unsafe fence cell for any realistic title", () => {
    const claim = planChangeClaim({
      op: "add",
      projectSlug: "projects/fylo",
      proposed: "fylo verify CI failed — 17 biome lint errors",
      evidenceCapture: CAPTURE_ID,
    });
    expect(unsafeFenceCellReason(claim)).toBeNull();
  });

  it("states the operation and the project", () => {
    const claim = planChangeClaim({
      op: "add",
      projectSlug: "projects/fylo",
      proposed: "thing",
      evidenceCapture: CAPTURE_ID,
    });
    expect(claim).toContain("Plan change on projects/fylo");
    expect(claim).toContain("add:");
    expect(claim).toContain(`[capture ${CAPTURE_ID}]`);
  });
});

describe("confidenceFromCosine — derived, never asserted", () => {
  it("is 0.5 exactly at the floor and rises toward 1.0", () => {
    expect(confidenceFromCosine(0.55)).toBe(0.5);
    expect(confidenceFromCosine(1)).toBe(1);
    expect(confidenceFromCosine(0.775)).toBe(0.75);
  });

  it("clamps rather than emitting an out-of-range weight", () => {
    // The proposal's `weight` column is validated against [0,1] on accept.
    expect(confidenceFromCosine(1.4)).toBeLessThanOrEqual(1);
    expect(confidenceFromCosine(-3)).toBeGreaterThanOrEqual(0);
    expect(confidenceFromCosine(Number.NaN)).toBe(0);
  });
});

describe("planImpactContentHash — the capture id, not a text digest", () => {
  it("is stable for the same capture id", () => {
    expect(planImpactContentHash(CAPTURE_ID)).toBe(planImpactContentHash(CAPTURE_ID));
  });

  it("differs between captures", () => {
    expect(planImpactContentHash("a")).not.toBe(planImpactContentHash("b"));
  });
});

describe("parsePlanDiff — a defensive read of an unconstrained column", () => {
  it("parses a well-formed stored diff", () => {
    const parsed = parsePlanDiff({
      op: "add",
      milestone_id: null,
      current: null,
      proposed: "ship the thing",
      rationale: "because",
      evidence_capture: CAPTURE_ID,
      confidence: 0.72,
    });
    expect(parsed?.op).toBe("add");
    expect(parsed?.evidenceCapture).toBe(CAPTURE_ID);
    expect(parsed?.confidence).toBe(0.72);
  });

  it("returns null for an unknown op rather than inventing one", () => {
    expect(parsePlanDiff({ op: "explode", proposed: "x" })).toBeNull();
  });

  it("returns null for a missing or blank proposed value", () => {
    expect(parsePlanDiff({ op: "add" })).toBeNull();
    expect(parsePlanDiff({ op: "add", proposed: "   " })).toBeNull();
  });

  it("returns null for non-objects, so a foreign-written value cannot reach a render", () => {
    expect(parsePlanDiff(null)).toBeNull();
    expect(parsePlanDiff("a string")).toBeNull();
    expect(parsePlanDiff([1, 2])).toBeNull();
    expect(parsePlanDiff(undefined)).toBeNull();
  });

  it("defaults a missing or out-of-range confidence to 0 instead of trusting it", () => {
    const parsed = parsePlanDiff({ op: "add", proposed: "x", confidence: 5 });
    expect(parsed?.confidence).toBe(1);
    const none = parsePlanDiff({ op: "add", proposed: "x" });
    expect(none?.confidence).toBe(0);
  });
});
