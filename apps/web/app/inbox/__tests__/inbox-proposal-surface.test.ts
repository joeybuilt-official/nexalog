// SPDX-License-Identifier: MIT
/**
 * Render proof for the proposal review surface — asserts the markup a server
 * render actually produces, not just the normalizer's output:
 *
 *   - a proposal's page paths become real anchors to the EXISTING Garden
 *     surface (`/app/graph?slug=…`, the page-focus parameter `/api/graph`
 *     already reads) — no new route invented;
 *   - `status: review` is visually distinguishable from `processed` (different
 *     border + badge treatment), because review means "a human must decide";
 *   - a review row carries the actual decision — Accept / Reject controls wired
 *     to `POST /api/captures/[id]/review` (the client component, so the router
 *     it refreshes through is mocked here);
 *   - a capture with no proposal renders no proposal block at all.
 *
 * Co-located with the page it renders (not under `lib/`) so the test can import
 * the server component without crossing the `web-lib-no-ui` architecture rule:
 * `lib/` must never reach into `app/`.
 */

import { describe, it, expect, vi } from "vitest";
import { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { reviewEndpoint } from "@/app/inbox/review-actions";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const rows: Array<Record<string, unknown>> = [];

vi.mock("@/composition", () => ({
  getComposition: () => ({
    listInbox: {
      execute: async () =>
        rows.map((r) => ({ hasAttachments: false, proposal: null, ...r })),
    },
  }),
}));

async function renderInbox(): Promise<string> {
  const { default: InboxPage } = await import("@/app/inbox/page");
  const element = await InboxPage({ searchParams: Promise.resolve({}) });
  return renderToStaticMarkup(element as ReactElement);
}

const PROCESSED_WITH_PAGES = {
  id: "01M38ZNA67JAGSYCGSJDYDM3DD",
  title: "e2e prod smoke",
  status: "processed",
  kind: "note",
  source: "pwa-share",
  capturedAt: "2026-09-24T05:54:20.487Z",
  proposal: {
    pages: ["people/jane-doe", "concepts/foo"],
    links: [["people/jane-doe", "companies/acme"]],
    summary: "Extracted 1 person, 1 concept",
  },
};

describe("inbox proposal review surface", () => {
  it("renders proposal page paths as links to the existing Garden surface", async () => {
    rows.length = 0;
    rows.push(PROCESSED_WITH_PAGES);

    const html = await renderInbox();

    expect(html).toContain("Worker proposal");
    expect(html).toContain("Extracted 1 person, 1 concept");
    // Real anchors, pointed at the page-focus parameter /api/graph already reads.
    expect(html).toContain('href="/app/graph?slug=people%2Fjane-doe"');
    expect(html).toContain('href="/app/graph?slug=concepts%2Ffoo"');
    expect(html).toContain('href="/app/graph?slug=companies%2Facme"');
    // Human labels + type chips, not raw slugs.
    expect(html).toContain("Jane Doe");
    expect(html).toContain("Person");
    expect(html).toContain("Company");
  });

  it("distinguishes a review capture from a processed one", async () => {
    rows.length = 0;
    rows.push(
      PROCESSED_WITH_PAGES,
      { ...PROCESSED_WITH_PAGES, id: "01M38ZNA67JAGSYCGSJDYDM3DE", status: "review" },
    );

    const html = await renderInbox();

    // The review row gets the primary border + the "Needs review" badge.
    expect(html).toContain("Needs review");
    expect(html).toContain("Processed");
    expect(html).toContain("border-primary");
    expect(html).not.toContain(">review<"); // the raw status never leaks into the badge
    // The banner calls the operator to the decision and links the review filter.
    expect(html).toContain("awaiting an operator decision");
    expect(html).toContain('href="/inbox?status=review"');
  });

  it("offers the accept/reject decision on a review row only", async () => {
    rows.length = 0;
    rows.push(
      PROCESSED_WITH_PAGES,
      { ...PROCESSED_WITH_PAGES, id: "01M38ZNA67JAGSYCGSJDYDM3DE", status: "review" },
    );

    const html = await renderInbox();

    // The decision is on the row, labelled, one click each (reject arms first).
    expect(html).toContain("Decide");
    expect(html).toContain(">Accept<");
    expect(html).toContain(">Reject<");
    // Exactly once — the processed row above it must not offer one.
    expect(html.match(/>Accept</g)).toHaveLength(1);
    expect(html.match(/>Reject</g)).toHaveLength(1);
  });

  it("wires the decision to the review row's own capture, never a lookalike", async () => {
    rows.length = 0;
    const reviewId = "01M38ZNA67JAGSYCGSJDYDM3DE";
    rows.push({ ...PROCESSED_WITH_PAGES, id: reviewId, status: "review" });

    const html = await renderInbox();

    // The endpoint the buttons POST to, carried on the rendered control: the
    // row's own capture id, so the decision cannot land on a neighbour.
    expect(html).toContain(`data-review-endpoint="${reviewEndpoint(reviewId)}"`);
    expect(html).not.toContain(reviewEndpoint(PROCESSED_WITH_PAGES.id));
  });

  it("offers no decision controls when no capture awaits one", async () => {
    rows.length = 0;
    rows.push(PROCESSED_WITH_PAGES);
    const html = await renderInbox();
    expect(html).not.toContain(">Accept<");
    expect(html).not.toContain(">Reject<");
  });

  it("shows no review banner when nothing is awaiting a decision", async () => {
    rows.length = 0;
    rows.push(PROCESSED_WITH_PAGES);
    const html = await renderInbox();
    expect(html).not.toContain("awaiting an operator decision");
  });

  it("renders no proposal block for a capture the worker has not touched", async () => {
    rows.length = 0;
    rows.push({ ...PROCESSED_WITH_PAGES, status: "inbox", proposal: null });
    const html = await renderInbox();
    expect(html).not.toContain("Worker proposal");
  });

  it("degrades to no block when the worker wrote an empty proposal object", async () => {
    rows.length = 0;
    rows.push({ ...PROCESSED_WITH_PAGES, proposal: { pages: [], links: [], summary: "" } });
    const html = await renderInbox();
    expect(html).not.toContain("Worker proposal");
  });

  it("survives a malformed proposal without dropping the capture row", async () => {
    rows.length = 0;
    rows.push({
      ...PROCESSED_WITH_PAGES,
      title: "malformed",
      proposal: { pages: ["has space", 7], links: ["nope"], summary: "still shown" },
    });
    const html = await renderInbox();
    expect(html).toContain("malformed");
    expect(html).toContain("still shown");
    expect(html).not.toContain("has space");
  });
});
