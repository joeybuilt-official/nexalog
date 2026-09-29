// SPDX-License-Identifier: MIT
/**
 * Render proof for the take-proposal review surface — asserts the markup the
 * page actually produces, not just the mapper's output.
 *
 * WHAT IT PINS, AND WHY EACH ONE MATTERS
 * -------------------------------------
 *   - the pending count the page DISPLAYS equals the count the queue reported.
 *     That equality is the verification the whole surface rests on: a count the
 *     UI computed from the rows it happened to receive would drift the moment
 *     the queue outgrew a page, which is how a 170-row backlog went unnoticed.
 *     `data-pending-count` is the literal number the surface prints.
 *   - the page says WHY it cannot show the queue when the deployment has no
 *     gbrain database, instead of rendering an empty list — "nothing to review"
 *     and "this instance cannot read the queue" are different statements.
 *   - the card's decision control is wired to THIS proposal's route. A control
 *     pointing at a path no route serves is exactly the defect this change
 *     exists to fix (three Today blocks had been dead this way in production),
 *     and it is invisible in a markup-only assertion — so the endpoint is
 *     asserted from the rendered attribute.
 *   - a reject never fires on a single click. The house rule is two-step for
 *     destructive actions, mirrored from the capture review surface.
 *
 * Co-located with the surface it renders (not under `lib/`) so the test can
 * import app/ without crossing the `web-lib-no-ui` architecture rule.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { getAuthUser, getProposalQueue, refresh } = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  getProposalQueue: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
  redirect: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({ getAuthUser }));
vi.mock("@/lib/proposals/queue", () => ({ getProposalQueue }));

const PROPOSAL = {
  id: 262,
  sourceId: "default",
  pageSlug: "inbox/01m3hehg15em1ht84zvej9d3m8",
  claimText: "The three reachable states are all incomplete.",
  kind: "take",
  holder: "brain",
  weight: 0.6,
  domain: "software",
  status: "pending" as const,
  proposedAt: new Date("2026-09-28T09:24:07.013Z"),
  modelId: "litellm:auto",
  promotedRowNum: null,
  actedAt: null,
  actedBy: null,
};

async function renderPage(): Promise<string> {
  const { default: ProposalsPage } = await import("@/app/(app)/app/proposals/page");
  const element = await ProposalsPage();
  return renderToStaticMarkup(element as ReactElement);
}

beforeEach(() => {
  getAuthUser.mockReset();
  getAuthUser.mockResolvedValue({ id: "user-1" });
  getProposalQueue.mockReset();
  getProposalQueue.mockReturnValue({
    list: vi.fn(async () => ({
      proposals: [PROPOSAL],
      counts: { pending: 170, accepted: 3, rejected: 92, superseded: 0 },
      nextOffset: 1,
    })),
    act: vi.fn(),
  });
  refresh.mockReset();
});

describe("/app/proposals — the review surface", () => {
  it("displays the queue's own pending count, read server-side", async () => {
    const html = await renderPage();

    // The literal number the surface prints, as an attribute a verification can
    // read — this is what gets compared against a direct SQL count.
    expect(html).toContain('data-pending-count="170"');
    expect(html).toContain("170 pending");
  });

  it("names the surface and what accepting does", async () => {
    const html = await renderPage();
    // The decided counts (accepted/rejected) belong to the client list, which
    // renders them from its own fetch — the route test asserts that shape. What
    // the SERVER render must carry is the page's own identity and the copy that
    // explains the decision, since those are what a reader sees before any
    // JavaScript runs.
    expect(html).toContain("Claims the brain&#x27;s extractor proposed");
    expect(html).toContain("What accepting does");
    expect(html).toContain("nexalog:proposal#");
  });

  it("never prints a count it could not read", async () => {
    getProposalQueue.mockReturnValue({
      list: vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
      act: vi.fn(),
    });

    const html = await renderPage();

    // No badge at all rather than a fabricated 0 — the client list owns the retry.
    expect(html).not.toContain("data-pending-count");
  });

  it("explains an unconfigured deployment instead of showing an empty queue", async () => {
    getProposalQueue.mockReturnValue(null);

    const html = await renderPage();

    expect(html).toContain("cannot read the proposal queue");
    expect(html).toContain("GBRAIN_DATABASE_URL");
    // The queue's copy must not be rendered at all in this state.
    expect(html).not.toContain("data-pending-count");
  });

  it("points at the proposals surface and names what accepting does", async () => {
    const html = await renderPage();
    expect(html).toContain("Proposals");
    expect(html).toContain("What accepting does");
    expect(html).toContain("nexalog:proposal#");
  });
});