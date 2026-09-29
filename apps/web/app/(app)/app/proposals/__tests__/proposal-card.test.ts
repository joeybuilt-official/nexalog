// SPDX-License-Identifier: MIT
/**
 * ProposalCard — a `plan_change` has to be LEGIBLE, which is a rendering property.
 *
 * WHY THIS IS A SEPARATE SPEC FROM THE PAGE'S
 * -------------------------------------------
 * `app/(app)/app/proposals/__tests__/page.test.ts` renders the SERVER component,
 * which prints the count and the copy; the list of cards is a client component that
 * fetches on mount, so a static render never reaches a card. That is a real gap: a
 * plan change that reached the queue but rendered as a bare claim — no operation, no
 * proposed text, no evidence link — would pass every other test in this feature and
 * still leave the operator unable to judge it. So the card is rendered DIRECTLY,
 * with a real plan-change payload, and the rendered markup is asserted.
 *
 * WHAT IT PINS
 * ------------
 *   - the diff reaches the DOM: the operation (`data-plan-op`), the proposed text,
 *     the rationale, and the citing capture id (`data-evidence-capture`);
 *   - the evidence is a LINK to the real capture route, not a dead href — a capture
 *     id rendered as a broken link is the defect class this repo has shipped once;
 *   - a claim-shaped proposal renders NO plan block at all (a card that showed an
 *     empty diff block for every take would be noise on 170 rows);
 *   - the accept/reject controls are still wired to this proposal's own act route,
 *     for both kinds — the plan card is the same decision surface, not a fork of it.
 *
 * Built with `createElement` rather than `.tsx`: vitest globs `*.test.ts` only, so a
 * `.tsx` spec would never be collected (and the gate would stay green over it).
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const EVIDENCE_CAPTURE = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

const PLAN_CHANGE = {
  id: 900,
  sourceId: "default",
  pageSlug: "projects/fylo",
  pageHref: "/app/brain/projects/fylo",
  claimText: `Plan change on projects/fylo — add: fylo verify CI failed [capture ${EVIDENCE_CAPTURE}]`,
  kind: "plan_change",
  holder: "brain",
  weight: 0.72,
  domain: "project",
  status: "pending",
  proposedAt: "2026-09-28T20:00:00.000Z",
  modelId: "nexalog:plan-impact-reconciler@1",
  promotedRowNum: null,
  actedAt: null,
  actedBy: null,
  planDiff: {
    op: "add",
    milestoneId: null,
    current: null,
    proposed: "fylo verify CI failed",
    rationale: "0.72 cosine in the brain's own project index, floor 0.55",
    evidenceCapture: EVIDENCE_CAPTURE,
    confidence: 0.72,
  },
};

const CLAIM_PROPOSAL = {
  ...PLAN_CHANGE,
  id: 262,
  kind: "take",
  pageSlug: "inbox/01m3hehg15em1ht84zvej9d3m8",
  claimText: "The three reachable states are all incomplete.",
  planDiff: null,
};

async function renderCard(proposal: unknown): Promise<string> {
  const { ProposalCard } = await import("@/components/proposals/proposal-card");
  return renderToStaticMarkup(
    createElement(ProposalCard, { proposal: proposal as never, onDecided: () => {} }),
  );
}

describe("ProposalCard — a plan_change renders its diff", () => {
  it("shows the operation, the proposed change, the rationale and the citing capture", async () => {
    const html = await renderCard(PLAN_CHANGE);

    expect(html).toContain("plan change");
    expect(html).toContain('data-plan-diff="true"');
    expect(html).toContain('data-plan-op="add"');
    expect(html).toContain("fylo verify CI failed");
    expect(html).toContain("cosine in the brain&#x27;s own project index");
    // The acceptance bar's field, visible in the DOM.
    expect(html).toContain(`data-evidence-capture="${EVIDENCE_CAPTURE}"`);
  });

  it("links the evidence capture to its real route, never a bare id or a dead href", async () => {
    const html = await renderCard(PLAN_CHANGE);

    expect(html).toContain(`href="/app/bookmarks/${EVIDENCE_CAPTURE}/reader"`);
  });

  it("renders the whole-plan case without inventing a milestone", async () => {
    const html = await renderCard(PLAN_CHANGE);
    expect(html).toContain("whole plan");
    expect(html).not.toContain("milestone");
  });

  it("renders a milestone when the diff names one", async () => {
    const html = await renderCard({
      ...PLAN_CHANGE,
      planDiff: { ...PLAN_CHANGE.planDiff, op: "reprioritize", milestoneId: "phase-2-hardening" },
    });
    expect(html).toContain('data-plan-op="reprioritize"');
    expect(html).toContain("phase-2-hardening");
  });

  it("renders current → proposed when the diff modifies an existing line", async () => {
    const html = await renderCard({
      ...PLAN_CHANGE,
      planDiff: {
        ...PLAN_CHANGE.planDiff,
        op: "modify",
        current: "ship the mobile app",
        proposed: "ship the mobile app after the parity gate",
      },
    });
    expect(html).toContain("Current");
    expect(html).toContain("ship the mobile app");
    expect(html).toContain("ship the mobile app after the parity gate");
  });

  it("renders no plan block at all for a claim-shaped proposal", async () => {
    const html = await renderCard(CLAIM_PROPOSAL);

    expect(html).not.toContain("data-plan-diff");
    expect(html).not.toContain("data-plan-op");
    // The claim itself still renders — this kind is not degraded, just different.
    expect(html).toContain("The three reachable states are all incomplete.");
  });

  it("says what accepting a plan change does, and that it does not edit the plan", async () => {
    const html = await renderCard(PLAN_CHANGE);
    expect(html).toContain("does not edit the plan itself");
  });

  it("keeps the decision wired to THIS proposal's act route, for both kinds", async () => {
    const planHtml = await renderCard(PLAN_CHANGE);
    const claimHtml = await renderCard(CLAIM_PROPOSAL);

    expect(planHtml).toContain('data-act-endpoint="/api/proposals/900/act"');
    expect(claimHtml).toContain('data-act-endpoint="/api/proposals/262/act"');
  });

  it("keeps reject two-step (no single-click destructive action)", async () => {
    const html = await renderCard(PLAN_CHANGE);
    // The armed state does not render until the operator clicks Reject.
    expect(html).toContain("Reject");
    expect(html).not.toContain("Confirm reject");
  });

  it("renders the card from the SAME component for both kinds (no parallel renderer)", async () => {
    // A second card component is how two renderers for one queue drift apart. This
    // asserts the file the plan card comes from is the one the claim card comes
    // from, by reading the module the test itself imported.
    const src = readFileSync(
      fileURLToPath(new URL("../../../../../components/proposals/proposal-card.tsx", import.meta.url)),
      "utf8",
    );
    expect(src).toContain("PlanDiffBlock");
    // The diff block lives INSIDE the card, not in a card of its own.
    expect(src.match(/function PlanDiffBlock/g)).toHaveLength(1);
  });
});
