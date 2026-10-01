// SPDX-License-Identifier: MIT
/**
 * THE PUBLISH CONTRACT — the rules a published brief must obey, in tests.
 *
 * WHAT THIS PINS, AND WHY EACH ONE MATTERS
 * ----------------------------------------
 *   - **A fallback is REFUSED, not skipped.** This is requirement #2 of the
 *     feature and the one with the worst failure mode: publishing a mechanical
 *     digest would put un-synthesized text into the brain as if a model had
 *     written it, and afterwards nothing distinguishes it from a real claim. The
 *     test asserts the refusal is TYPED (`not_synthesized`) so the route can turn
 *     it into a 409 rather than a silent no-op.
 *   - **The queue's own key is the idempotency.** The publisher keeps no ledger:
 *     it derives every field deterministically so the queue's unique index
 *     (`source_id, page_slug, content_hash, prompt_version, md5(claim_text)`)
 *     refuses the second row. The fake queue below keys its storage EXACTLY the
 *     way that index does — if this suite passes while the real index would not,
 *     the fake is wrong.
 *   - **A RE-SYNTHESIZED brief is a NEW proposal.** The opposite property, and
 *     just as deliberate: the earlier brief describes a project that has since
 *     changed, so suppressing the newer text would silently lose an update. The
 *     content hash is what makes "the same" and "newer" distinguishable without a
 *     memo or a clock comparison.
 *   - **Provenance is present and is not the operator's voice.** The project, the
 *     model, the instant and the note titles must reach the row, in the claim (a
 *     human reads it) and in the `brief/1` payload (a program reads it). The claim
 *     names the model, because synthesized text presented as the operator's own
 *     words is the thing this whole feature must never do.
 *   - **The claim is a safe fence cell.** A promoted claim becomes a markdown
 *     fence cell in the brain; a newline or the `gbrain:takes` marker in it would
 *     corrupt the page. `unsafeFenceCellReason` from the take domain is the gate,
 *     reused rather than reimplemented, and a project NAME carrying a newline is
 *     refused before any row exists.
 *
 * Pure: no database, no network, no clock, no model.
 */

import { describe, it, expect, vi } from "vitest";

import {
  BRIEF_DIFF_EVIDENCE_MAX,
  BRIEF_PROPOSAL_KIND,
  BRIEF_PUBLISH_PROMPT_VERSION,
  BriefPublishError,
  PublishProjectBrief,
  assertPublishable,
  briefContentHash,
  briefPreview,
  briefProposalClaim,
  briefPublishRefusal,
  buildBriefPublishRow,
  fnv1a64,
  parseBriefDiff,
  parsePlanDiff,
  singleLineExcerpt,
  unsafeFenceCellReason,
  type PublishableBrief,
  type PublishableProject,
  type ProposeInput,
  type ProposalQueue,
  type TakeProposal,
} from "../src/index";

const PROJECT_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

const SYNTHESIZED = `# Project Alpha — brief

## Current state
- One linked note, recently updated.
`;

function brief(over: Partial<PublishableBrief> = {}): PublishableBrief {
  return {
    state: "synthesized",
    markdown: SYNTHESIZED,
    model: "auto",
    generatedAt: "2026-10-01T12:00:00.000Z",
    promptVersion: "project-brief-v1",
    ...over,
  };
}

function project(over: Partial<PublishableProject> = {}): PublishableProject {
  return {
    id: PROJECT_ID,
    name: "Project Alpha",
    pageSlug: "projects/project-alpha",
    sourceId: "default",
    ...over,
  };
}

/**
 * An in-memory stand-in for the REAL queue, keyed exactly the way
 * `take_proposals_idempotency_idx` keys it. A second call with the same tuple
 * returns `created: false` — which IS the idempotency contract.
 */
function fakeQueue() {
  const stored: Array<{ key: string; proposal: TakeProposal }> = [];
  let nextId = 900;
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
      proposedAt: new Date("2026-10-01T12:00:00Z"),
      modelId: input.modelId,
      promotedRowNum: null,
      actedAt: null,
      actedBy: null,
      planDiff: parseBriefDiff(input.planDiff),
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

describe("PublishProjectBrief — a synthesis is published, a digest is refused", () => {
  it("publishes a synthesized brief and reports the row it created", async () => {
    const { queue, propose } = fakeQueue();
    const result = await new PublishProjectBrief(queue).execute({
      brief: brief(),
      project: project(),
      evidenceNoteTitles: ["Kickoff", "Scope review"],
    });

    expect(result.created).toBe(true);
    expect(result.pageSlug).toBe("projects/project-alpha");
    expect(result.modelId).toBe("auto");
    expect(result.generatedAt).toBe("2026-10-01T12:00:00.000Z");
    expect(propose).toHaveBeenCalledTimes(1);

    const input = propose.mock.calls[0][0];
    expect(input.kind).toBe(BRIEF_PROPOSAL_KIND);
    expect(input.pageSlug).toBe("projects/project-alpha");
    expect(input.promptVersion).toBe(BRIEF_PUBLISH_PROMPT_VERSION);
    expect(input.contentHash.startsWith("brief:")).toBe(true);
  });

  it("REFUSES a fallback with a typed code and writes nothing", async () => {
    const { queue, propose, stored } = fakeQueue();

    await expect(
      new PublishProjectBrief(queue).execute({
        brief: brief({ state: "fallback", model: null }),
        project: project(),
      }),
    ).rejects.toBeInstanceOf(BriefPublishError);

    try {
      await new PublishProjectBrief(queue).execute({
        brief: brief({ state: "fallback", model: null }),
        project: project(),
      });
    } catch (err) {
      expect(err).toBeInstanceOf(BriefPublishError);
      expect((err as BriefPublishError).code).toBe("not_synthesized");
      expect((err as BriefPublishError).notSynthesized).toBe(true);
    }

    // The load-bearing half: NOTHING reached the queue.
    expect(propose).not.toHaveBeenCalled();
    expect(stored).toHaveLength(0);
  });

  it("refuses a fallback even when its markdown is long and plausible", async () => {
    const { queue, propose } = fakeQueue();
    const digest = brief({
      state: "fallback",
      model: null,
      markdown: "# Alpha — project brief\n\n> **Not synthesized.** …\n\n## Current state\n",
    });
    expect(briefPublishRefusal({ brief: digest, project: project(), claim: "x" })?.code).toBe(
      "not_synthesized",
    );
    await expect(
      new PublishProjectBrief(queue).execute({ brief: digest, project: project() }),
    ).rejects.toBeInstanceOf(BriefPublishError);
    expect(propose).not.toHaveBeenCalled();
  });

  it("refuses an unknown state as not_synthesized rather than publishing it", async () => {
    const { queue, propose } = fakeQueue();
    await expect(
      new PublishProjectBrief(queue).execute({
        brief: brief({ state: "synthesised" }), // a typo, not a synthesis
        project: project(),
      }),
    ).rejects.toMatchObject({ code: "not_synthesized" });
    expect(propose).not.toHaveBeenCalled();
  });

  it("refuses a brief with no project to address", async () => {
    const { queue } = fakeQueue();
    await expect(
      new PublishProjectBrief(queue).execute({ brief: brief(), project: null }),
    ).rejects.toMatchObject({ code: "missing_project" });
  });
});

describe("PublishProjectBrief — provenance", () => {
  it("carries the project, the model and the instant, in the claim AND in the payload", async () => {
    const { queue, propose } = fakeQueue();
    await new PublishProjectBrief(queue).execute({
      brief: brief(),
      project: project(),
      evidenceNoteTitles: ["Kickoff"],
    });

    const input = propose.mock.calls[0][0];
    // The claim a human reads: labelled, and it names the model that wrote it.
    expect(input.claimText).toContain("Nexalog project brief for Project Alpha");
    expect(input.claimText).toContain("auto");
    // It never reads as the operator's own words.
    expect(input.claimText.toLowerCase()).not.toContain("i think");
    expect(input.claimText).not.toContain("the operator");

    // The payload a program reads.
    const diff = parseBriefDiff(input.planDiff);
    expect(diff).not.toBeNull();
    expect(diff!.projectId).toBe(PROJECT_ID);
    expect(diff!.pageSlug).toBe("projects/project-alpha");
    expect(diff!.modelId).toBe("auto");
    expect(diff!.generatedAt).toBe("2026-10-01T12:00:00.000Z");
    expect(diff!.promptVersion).toBe("project-brief-v1");
    expect(diff!.markdown).toBe(SYNTHESIZED);
    expect(diff!.evidenceNoteTitles).toEqual(["Kickoff"]);

    // The queue's own columns carry the same identity.
    expect(input.modelId).toBe("auto");
  });

  it("carries no note BODY — only titles, and a bounded number of them", async () => {
    const { queue, propose } = fakeQueue();
    const titles = Array.from({ length: BRIEF_DIFF_EVIDENCE_MAX + 5 }, (_, i) => `Note ${i}`);
    await new PublishProjectBrief(queue).execute({
      brief: brief(),
      project: project(),
      evidenceNoteTitles: titles,
    });

    const diff = parseBriefDiff(propose.mock.calls[0][0].planDiff)!;
    expect(diff.evidenceNoteTitles).toHaveLength(BRIEF_DIFF_EVIDENCE_MAX);
    expect(diff.evidenceNoteTitles[0]).toBe("Note 0");
  });

  it("flattens a title that carries a newline, because a stored field is one line", async () => {
    const { queue, propose } = fakeQueue();
    await new PublishProjectBrief(queue).execute({
      brief: brief(),
      project: project(),
      evidenceNoteTitles: ["Kickoff\nwith a second line"],
    });
    const diff = parseBriefDiff(propose.mock.calls[0][0].planDiff)!;
    expect(diff.evidenceNoteTitles[0]).toBe("Kickoff with a second line");
  });

  it("a missing model or instant degrades to 'unknown' rather than an empty string", async () => {
    const { queue, propose } = fakeQueue();
    await new PublishProjectBrief(queue).execute({
      brief: brief({ model: null, generatedAt: null }),
      project: project(),
    });
    const input = propose.mock.calls[0][0];
    expect(input.modelId).toBe("unknown");
    const diff = parseBriefDiff(input.planDiff)!;
    expect(diff.generatedAt).toBe("unknown");
  });
});

describe("PublishProjectBrief — idempotency", () => {
  it("publishing the SAME brief twice creates ONE row and reports the second as a duplicate", async () => {
    const { queue, propose, stored } = fakeQueue();
    const publisher = new PublishProjectBrief(queue);

    const first = await publisher.execute({ brief: brief(), project: project() });
    const second = await publisher.execute({ brief: brief(), project: project() });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.proposalId).toBe(first.proposalId);
    // The queue was really asked twice — the pass ran — and holds one row.
    expect(propose).toHaveBeenCalledTimes(2);
    expect(stored).toHaveLength(1);
  });

  it("builds a byte-identical idempotency tuple across two publishes of one brief", async () => {
    const { queue, propose } = fakeQueue();
    const publisher = new PublishProjectBrief(queue);
    await publisher.execute({ brief: brief(), project: project() });
    await publisher.execute({ brief: brief(), project: project() });

    const [a, b] = [propose.mock.calls[0][0], propose.mock.calls[1][0]];
    expect(a.sourceId).toBe(b.sourceId);
    expect(a.pageSlug).toBe(b.pageSlug);
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.promptVersion).toBe(b.promptVersion);
    expect(a.claimText).toBe(b.claimText);
  });

  it("a RE-SYNTHESIZED brief is a NEW proposal, because the project it describes changed", async () => {
    const { queue, propose, stored } = fakeQueue();
    const publisher = new PublishProjectBrief(queue);

    await publisher.execute({ brief: brief(), project: project() });
    const second = await publisher.execute({
      brief: brief({
        markdown: `${SYNTHESIZED}\n## Open questions\n- One new question.\n`,
        generatedAt: "2026-10-02T09:00:00.000Z",
      }),
      project: project(),
    });

    expect(second.created).toBe(true);
    expect(stored).toHaveLength(2);
    expect(propose.mock.calls[0][0].contentHash).not.toBe(propose.mock.calls[1][0].contentHash);
  });

  it("the content hash does not collide on shuffled boundaries", () => {
    const a = briefContentHash({
      projectId: "ab",
      modelId: "c",
      generatedAt: "d",
      markdown: "e",
    });
    const b = briefContentHash({
      projectId: "a",
      modelId: "bc",
      generatedAt: "d",
      markdown: "e",
    });
    expect(a).not.toBe(b);
    expect(fnv1a64("project brief")).toBe(fnv1a64("project brief"));
    expect(fnv1a64("project brief")).not.toBe(fnv1a64("project-brief"));
  });
});

describe("the claim is a safe fence cell", () => {
  it("refuses a project name that would break the brain's markdown fence", () => {
    const hostile = project({ name: "Alpha\n## Injected heading" });
    const claim = briefProposalClaim({
      projectName: hostile.name,
      modelId: "auto",
      excerpt: briefPreview(SYNTHESIZED),
    });
    // The builder flattens the newline, so the result is safe — and the guard
    // agrees, which is the assertion that matters.
    expect(unsafeFenceCellReason(claim)).toBeNull();
    expect(claim).not.toContain("\n");
  });

  it("still refuses a claim that carries the takes marker, by any route", () => {
    const claim = "Nexalog project brief for gbrain:takes";
    const refusal = briefPublishRefusal({
      brief: brief(),
      project: project(),
      claim,
    });
    expect(refusal?.code).toBe("unsafe_claim");
    expect(() => assertPublishable({ brief: brief(), project: project(), claim })).toThrow(
      BriefPublishError,
    );
  });

  it("refuses an empty brief even when its state claims to be synthesized", () => {
    expect(
      briefPublishRefusal({ brief: brief({ markdown: "   \n " }), project: project(), claim: "x" })
        ?.code,
    ).toBe("empty_brief");
  });
});

describe("the stored brief block is disjoint from a plan diff", () => {
  it("parsePlanDiff refuses a brief block and parseBriefDiff refuses a plan diff", () => {
    const row = buildBriefPublishRow({ brief: brief(), project: project() });
    expect(parsePlanDiff(row.briefDiff)).toBeNull();
    expect(parseBriefDiff(row.briefDiff)).not.toBeNull();

    const planDiff = {
      op: "add",
      milestone_id: null,
      current: null,
      proposed: "Add a milestone",
      rationale: "…",
      evidence_capture: PROJECT_ID,
      confidence: 0.6,
    };
    expect(parseBriefDiff(planDiff)).toBeNull();
    expect(parsePlanDiff(planDiff)).not.toBeNull();
  });

  it("refuses a hand-edited brief block missing its markdown", () => {
    expect(parseBriefDiff({ type: "brief/1", markdown: "  " })).toBeNull();
    expect(parseBriefDiff({ type: "brief/1" })).toBeNull();
    expect(parseBriefDiff("brief/1")).toBeNull();
  });

  it("tolerates an older block written before the evidence field existed", () => {
    const legacy = {
      type: "brief/1",
      project_id: PROJECT_ID,
      page_slug: "projects/project-alpha",
      generated_at: "2026-10-01T12:00:00.000Z",
      model_id: "auto",
      prompt_version: "project-brief-v1",
      markdown: SYNTHESIZED,
    };
    const parsed = parseBriefDiff(legacy);
    expect(parsed).not.toBeNull();
    expect(parsed!.evidenceNoteTitles).toEqual([]);
  });
});

describe("small rules", () => {
  it("singleLineExcerpt flattens whitespace and cuts on code points", () => {
    expect(singleLineExcerpt("a\nb\tc", 10)).toBe("a b c");
    // A UTF-16 slice would leave half of this emoji at the cut point.
    const cut = singleLineExcerpt("🙂🙂🙂🙂", 2);
    expect([...cut].slice(0, 2).join("")).toBe("🙂🙂");
    expect(cut.endsWith("…")).toBe(true);
  });

  it("briefPreview strips heading markers so the claim reads as a sentence", () => {
    const preview = briefPreview("# Alpha — brief\n\n## Current state\n- One note");
    expect(preview.startsWith("Alpha — brief")).toBe(true);
    expect(preview).not.toContain("#");
  });
});
