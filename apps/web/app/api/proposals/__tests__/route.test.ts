// SPDX-License-Identifier: MIT
/**
 * Endpoint tests for the take-proposal review API — the write path that did not
 * exist, which is why 170 proposals sat pending with zero ever promoted.
 *
 * What these assert, per `.claude/rules/testing.md` → "What an endpoint test
 * asserts":
 *
 *   - success with the exact response shape, for both the list and the decision;
 *   - every validation failure (bad id, body not JSON, wrong type, extra field)
 *     and the status each produces;
 *   - the unauthorized path;
 *   - not-found (a real id with no row behind it) and conflict (the row is not
 *     pending any more) — the two failures an operator actually hits;
 *   - the unconfigured path, which is a 503 naming the missing configuration
 *     rather than an empty queue pretending there is nothing to review;
 *   - an unexpected failure being a typed 500 with a log line.
 *
 * `acted_by` deserves its own note: the route must record the SESSION's user id,
 * never anything from the body. A body could name any user, and an audit column a
 * caller can set is not an audit column — so one test asserts the body cannot
 * reach it.
 *
 * The queue is faked through the port (the repo's composition-root pattern), so
 * nothing here boots Postgres or GBrain.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProposalQueueError } from "@nexalog/core";

const { getAuthUser, logEvent, getProposalQueue } = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  logEvent: vi.fn(),
  getProposalQueue: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({ getAuthUser }));
vi.mock("@/lib/logger", () => ({ logEvent }));
vi.mock("@/lib/proposals/queue", () => ({ getProposalQueue }));

import { GET } from "@/app/api/proposals/route";
import { POST } from "@/app/api/proposals/[id]/act/route";

const USER = { id: "user-1" };

const DOMAIN_PROPOSAL = {
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

function fakeQueue(over: Partial<Record<"list" | "act", unknown>> = {}) {
  const list = vi.fn(async () => ({
    proposals: [DOMAIN_PROPOSAL],
    counts: { pending: 1, accepted: 0, rejected: 0, superseded: 0 },
    nextOffset: null,
  }));
  const act = vi.fn(async () => ({
    proposal: { ...DOMAIN_PROPOSAL, status: "accepted" as const, promotedRowNum: 1, actedAt: new Date(), actedBy: USER.id },
    promoted: { pageSlug: DOMAIN_PROPOSAL.pageSlug, rowNum: 1 },
  }));
  // The returned spies ARE the ones handed to the route, overrides included —
  // a helper that returns the default when an override was supplied makes every
  // `toHaveBeenCalledWith` assertion read the wrong function.
  const listFn = (over.list ?? list) as typeof list;
  const actFn = (over.act ?? act) as typeof act;
  return {
    queue: { list: listFn, act: actFn },
    list: listFn,
    act: actFn,
  };
}

beforeEach(() => {
  getAuthUser.mockReset();
  getAuthUser.mockResolvedValue(USER);
  logEvent.mockReset();
  getProposalQueue.mockReset();
  getProposalQueue.mockReturnValue(fakeQueue().queue);
});

function list() {
  return GET(new Request("http://localhost/api/proposals?limit=25", { method: "GET" }));
}

function act(id: string, body?: unknown, init: RequestInit = {}) {
  const request = new Request(`http://localhost/api/proposals/${id}/act`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    ...init,
  });
  return POST(request, { params: Promise.resolve({ id }) });
}

describe("GET /api/proposals", () => {
  it("returns the list shape with whole-queue counts", async () => {
    const response = await list();

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      proposals: Array<Record<string, unknown>>;
      counts: Record<string, number>;
      nextOffset: number | null;
    };
    expect(body.proposals).toHaveLength(1);
    expect(body.counts).toEqual({ pending: 1, accepted: 0, rejected: 0, superseded: 0 });
    expect(body.nextOffset).toBeNull();

    const dto = body.proposals[0];
    // The wire shape a client builds its request from: every field present, the
    // timestamps ISO-8601 instants, and the page route resolved server-side.
    expect(Object.keys(dto).sort()).toEqual(
      [
        "actedAt",
        "actedBy",
        "claimText",
        "domain",
        "holder",
        "id",
        "kind",
        "modelId",
        "pageHref",
        "pageSlug",
        "promotedRowNum",
        "proposedAt",
        "sourceId",
        "status",
        "weight",
      ].sort(),
    );
    expect(dto.id).toBe(262);
    expect(dto.proposedAt).toBe("2026-09-28T09:24:07.013Z");
    expect(dto.pageHref).toBe("/app/brain/inbox/01m3hehg15em1ht84zvej9d3m8");
    expect(dto.actedAt).toBeNull();
  });

  it("encodes each slug segment in the page route", async () => {
    const { queue, list: listFn } = fakeQueue();
    listFn.mockResolvedValueOnce({
      proposals: [{ ...DOMAIN_PROPOSAL, pageSlug: "people/a b/c+d" }],
      counts: { pending: 1, accepted: 0, rejected: 0, superseded: 0 },
      nextOffset: null,
    });
    getProposalQueue.mockReturnValue(queue);

    const body = (await (await list()).json()) as { proposals: Array<{ pageHref: string }> };

    expect(body.proposals[0].pageHref).toBe("/app/brain/people/a%20b/c%2Bd");
  });

  it("401s without a session, and never touches the queue", async () => {
    getAuthUser.mockResolvedValue(null);

    const response = await list();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(getProposalQueue).not.toHaveBeenCalled();
  });

  it("503s with a named cause when the deployment has no gbrain database", async () => {
    getProposalQueue.mockReturnValue(null);

    const response = await list();

    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string; code: string; message: string };
    expect(body.error).toBe("gbrain_unavailable");
    expect(body.code).toBe("not_configured");
    expect(body.message).toContain("GBRAIN_DATABASE_URL");
  });

  it("503s rather than 200s when the queue read fails", async () => {
    getProposalQueue.mockReturnValue(
      fakeQueue({ list: vi.fn(async () => Promise.reject(new Error("ECONNREFUSED"))) }).queue,
    );

    const response = await list();

    expect(response.status).toBe(503);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("read_failed");
    expect(logEvent).toHaveBeenCalledWith(
      "proposals.list.failed",
      expect.objectContaining({ error: "ECONNREFUSED" }),
    );
  });
});

describe("POST /api/proposals/[id]/act — accept", () => {
  it("promotes the proposal and returns the promoted take", async () => {
    const response = await act("262", { accept: true });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      proposal: { status: string; promotedRowNum: number | null };
      promoted: { pageSlug: string; rowNum: number } | null;
    };
    expect(body.ok).toBe(true);
    expect(body.proposal.status).toBe("accepted");
    expect(body.proposal.promotedRowNum).toBe(1);
    expect(body.promoted).toEqual({ pageSlug: DOMAIN_PROPOSAL.pageSlug, rowNum: 1 });
  });

  it("records the SESSION's user as acted_by, never the body's", async () => {
    const { queue, act: actFn } = fakeQueue();
    getProposalQueue.mockReturnValue(queue);

    await act("262", { accept: true, actedBy: "someone-else" });

    // The request is a 400 (strict body rejects the extra field) — asserted
    // separately — so the important half is that the queue was never asked to
    // record a caller-supplied identity.
    expect(actFn).not.toHaveBeenCalled();
  });

  it("passes the authenticated user id inward when the body is clean", async () => {
    const { queue, act: actFn } = fakeQueue();
    getProposalQueue.mockReturnValue(queue);

    await act("262", { accept: true });

    expect(actFn).toHaveBeenCalledWith({ proposalId: 262, accept: true, actedBy: USER.id });
  });

  it("rejects an attempt to smuggle actedBy in the body", async () => {
    const response = await act("262", { accept: true, actedBy: "someone-else" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_body" });
  });
});

describe("POST /api/proposals/[id]/act — reject", () => {
  it("stamps rejected and promotes nothing", async () => {
    const { queue, act: actFn } = fakeQueue({
      act: vi.fn(async () => ({
        proposal: { ...DOMAIN_PROPOSAL, status: "rejected" as const, actedAt: new Date(), actedBy: USER.id },
        promoted: null,
      })),
    });
    getProposalQueue.mockReturnValue(queue);

    const response = await act("262", { accept: false });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      proposal: { status: string };
      promoted: unknown;
    };
    expect(body.proposal.status).toBe("rejected");
    expect(body.promoted).toBeNull();
    expect(actFn).toHaveBeenCalledWith({ proposalId: 262, accept: false, actedBy: USER.id });
  });
});

describe("POST /api/proposals/[id]/act — validation and failure mapping", () => {
  it("401s without a session", async () => {
    getAuthUser.mockResolvedValue(null);

    const response = await act("262", { accept: true });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(getProposalQueue).not.toHaveBeenCalled();
  });

  it.each([
    ["not a number", "abc"],
    ["a float", "1.5"],
    ["negative", "-3"],
    ["zero", "0"],
    ["empty", ""],
  ])("400s on an id that is %s", async (_label, id) => {
    const response = await act(id, { accept: true });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_id" });
  });

  it("400s on a body that is not JSON", async () => {
    const request = new Request("http://localhost/api/proposals/262/act", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{nope",
    });
    const response = await POST(request, { params: Promise.resolve({ id: "262" }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_body" });
  });

  it("400s on an empty body and on a wrong-typed accept", async () => {
    expect((await act("262")).status).toBe(400);
    expect((await act("262", { accept: "yes" })).status).toBe(400);
    expect((await act("262", {})).status).toBe(400);
  });

  it("404s when no proposal has that id", async () => {
    const { queue } = fakeQueue({
      act: vi.fn(async () => {
        throw new ProposalQueueError({
          code: "not_found",
          proposalId: 999,
          message: "No take proposal #999.",
        });
      }),
    });
    getProposalQueue.mockReturnValue(queue);

    const response = await act("999", { accept: true });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "not_found",
      message: "No take proposal #999.",
    });
  });

  it("409s when the row is no longer pending — the concurrent-accept case", async () => {
    const { queue } = fakeQueue({
      act: vi.fn(async () => {
        throw new ProposalQueueError({
          code: "not_pending",
          proposalId: 262,
          message: "Proposal #262 was acted on concurrently.",
        });
      }),
    });
    getProposalQueue.mockReturnValue(queue);

    const response = await act("262", { accept: true });

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe("not_pending");
    expect(body.message).toContain("concurrently");
  });

  it("409s with the repair hint when a row is stranded", async () => {
    const { queue } = fakeQueue({
      act: vi.fn(async () => {
        throw new ProposalQueueError({
          code: "not_pending",
          proposalId: 262,
          message: "Proposal #262 is stranded: marked accepted but no take was promoted.",
          hint: "repair_then_retry",
        });
      }),
    });
    getProposalQueue.mockReturnValue(queue);

    const response = await act("262", { accept: true });

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string; hint?: string; message: string };
    expect(body.hint).toBe("repair_then_retry");
    expect(body.message).toContain("stranded");
  });

  it("503s when the deployment has no gbrain database", async () => {
    getProposalQueue.mockReturnValue(null);

    const response = await act("262", { accept: true });

    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("gbrain_unavailable");
  });

  it("500s with a typed body and a log line on an unexpected failure", async () => {
    const { queue } = fakeQueue({
      act: vi.fn(async () => {
        throw new Error("driver exploded");
      }),
    });
    getProposalQueue.mockReturnValue(queue);

    const response = await act("262", { accept: true });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "promote_failed" });
    expect(logEvent).toHaveBeenCalledWith(
      "proposals.act.failed",
      expect.objectContaining({ proposalId: 262, error: "driver exploded" }),
    );
  });
});
