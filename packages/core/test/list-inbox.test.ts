// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { type CaptureState } from "../src/domain/capture";
import { Ulid } from "../src/domain/ulid";
import { ListInbox } from "../src/application/list-inbox";
import type { BrainStore } from "../src/ports";

function state(over: Partial<CaptureState> = {}): CaptureState {
  return {
    id: Ulid.of("0123456789ABCDEFGHJKMNPQRS"),
    title: "A test note",
    body: "hello brain",
    type: "note",
    status: "processed",
    kind: "note",
    source: "mcp",
    capturedAt: new Date("2026-09-23T06:41:00Z"),
    claimedBy: null,
    claimedAt: null,
    attachments: [],
    originUrl: null,
    proposal: null,
    ...over,
  };
}

const storeOf = (states: CaptureState[]): BrainStore => ({
  listCaptures: async () => states,
  saveCapture: async () => {},
  getCapture: async () => null,
  updateCapture: async () => {},
  getPage: async () => null,
  savePage: async () => {},
  saveAttachment: async () => ({ path: "attachments/x" }),
});

describe("ListInbox", () => {
  it("projects the worker proposal block through untouched", async () => {
    const proposal = {
      pages: ["people/jane-doe", "concepts/foo"],
      links: [["people/jane-doe", "companies/acme"]],
      summary: "Extracted 1 person, 1 concept",
    };
    const listInbox = new ListInbox(storeOf([state({ proposal })]));

    const [row] = await listInbox.execute();
    // The block is authored externally and cast through unvalidated, so the use
    // case must not reshape it — normalizing is the view's job.
    expect(row.proposal).toEqual(proposal);
  });

  it("reports null when a capture has no proposal (inbox / processing)", async () => {
    const listInbox = new ListInbox(
      storeOf([state({ status: "inbox" }), state({ status: "processing" })]),
    );
    const rows = await listInbox.execute();
    expect(rows.map((r) => r.proposal)).toEqual([null, null]);
  });

  it("keeps a review capture's status and proposal together", async () => {
    const listInbox = new ListInbox(
      storeOf([
        state({
          status: "review",
          proposal: { pages: [], links: [], summary: "unsure about the entity" },
        }),
      ]),
    );
    const [row] = await listInbox.execute({ status: "review" });
    expect(row.status).toBe("review");
    expect(row.proposal).toEqual({
      pages: [],
      links: [],
      summary: "unsure about the entity",
    });
  });

  it("sorts newest first and honors the limit", async () => {
    const older = state({
      id: Ulid.of("0123456789ABCDEFGHJKMNPQ01"),
      capturedAt: new Date("2026-09-01T00:00:00Z"),
      title: "older",
    });
    const newer = state({
      id: Ulid.of("0123456789ABCDEFGHJKMNPQ02"),
      capturedAt: new Date("2026-09-20T00:00:00Z"),
      title: "newer",
    });
    const listInbox = new ListInbox(storeOf([older, newer]));
    const rows = await listInbox.execute({ limit: 1 });
    expect(rows.map((r) => r.title)).toEqual(["newer"]);
  });
});
