// SPDX-License-Identifier: MIT
/**
 * Route tests for the PUBLISH intent on `POST /api/projects/[id]/brief`.
 *
 * The claims that can only be made through the route:
 *   - publishing is an EXPLICIT intent — a bare `POST` still just regenerates,
 *     and nothing reaches the queue;
 *   - a `fallback` brief is a typed 409 (`brief_not_synthesized`), and NOTHING is
 *     proposed — the one rule the whole feature turns on;
 *   - a synthesized brief is published, and the response carries the provenance
 *     (project, model, instant) the brain needs;
 *   - the same brief published twice reports `duplicate: true` and creates one row;
 *   - no queue configured is a typed `503 gbrain_unavailable`, never a fake success.
 *
 * The auth module, the workspace lookup, the brief store and the port resolver are
 * injected. The pure assembly, the core publish rules and the pass run FOR REAL
 * against a faked queue, so the response shape and the idempotency are the
 * production ones.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  getAuthUser,
  getUserWorkspaces,
  getProjectBriefSource,
  resolveIntelligence,
  logEvent,
  getProposalQueue,
  getProjectAddress,
  getProjectNoteTitles,
  getComposition,
} = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  getUserWorkspaces: vi.fn(),
  getProjectBriefSource: vi.fn(),
  resolveIntelligence: vi.fn(),
  logEvent: vi.fn(),
  getProposalQueue: vi.fn(),
  getProjectAddress: vi.fn(),
  getProjectNoteTitles: vi.fn(),
  getComposition: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({ getAuthUser }));
vi.mock("@/lib/workspace", () => ({ getUserWorkspaces }));
vi.mock("@/lib/projects/store", () => ({
  getProjectBriefSource,
  getProjectAddress,
  getProjectNoteTitles,
}));
vi.mock("@/lib/intelligence/resolve", () => ({ resolveIntelligence }));
vi.mock("@/lib/logger", () => ({ logEvent }));
vi.mock("@/lib/proposals/queue", () => ({ getProposalQueue }));
vi.mock("@/composition", () => ({ getComposition }));

import { POST } from "../projects/[id]/brief/route";
import type { ProjectBriefSource } from "@/lib/projects/brief";
import type { ProposeInput, ProposalQueue, TakeProposal } from "@nexalog/core";

const WS = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-01T12:00:00.000Z");

function source(): ProjectBriefSource {
  return {
    project: {
      id: PROJECT,
      name: "Project Alpha",
      description: "A container.",
      lifecycleState: "active",
      livingDoc: "The living doc.",
      deletedAt: null,
    },
    notes: [
      { id: "n1", title: "Kickoff", updatedAt: NOW, contentLength: 120, embedding: [1, 0] },
    ],
    subProjects: [{ id: "s1", name: "Sub Alpha", lifecycleState: "active" }],
    themes: [{ themeId: "t1", label: "Agents", size: 12, centroid: [1, 0] }],
  };
}

/** An in-memory queue keyed exactly as `take_proposals_idempotency_idx` keys it. */
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
      proposedAt: NOW,
      modelId: input.modelId,
      promotedRowNum: null,
      actedAt: null,
      actedBy: null,
      planDiff: null,
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

function call(body?: unknown): Promise<Response> {
  const request =
    body === undefined
      ? new Request("http://localhost/api/projects/x/brief", { method: "POST" })
      : new Request("http://localhost/api/projects/x/brief", {
          method: "POST",
          body: typeof body === "string" ? body : JSON.stringify(body),
        });
  return POST(request, { params: Promise.resolve({ id: PROJECT }) });
}

const SYNTHESIZED = "# Alpha brief\n\n## Current state\n- live";

function withModel() {
  resolveIntelligence.mockReturnValue({
    id: "fake",
    model: "fake-model",
    complete: vi.fn(async () => ({ text: SYNTHESIZED, model: "fake-model" })),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthUser.mockResolvedValue({ id: "user-1" });
  getUserWorkspaces.mockResolvedValue([{ id: WS }]);
  getProjectBriefSource.mockResolvedValue(source());
  getProjectNoteTitles.mockResolvedValue(["Kickoff"]);
  getProjectAddress.mockResolvedValue({
    id: PROJECT,
    name: "Project Alpha",
    parentName: null,
  });
  resolveIntelligence.mockReturnValue(null);
  getProposalQueue.mockReturnValue(fakeQueue().queue);
  getComposition.mockReturnValue({ gbrain: null });
});

describe("POST /api/projects/[id]/brief — publishing is EXPLICIT", () => {
  it("requires a session", async () => {
    getAuthUser.mockResolvedValue(null);
    const res = await call({ intent: "publish" });
    expect(res.status).toBe(401);
    expect(getProjectAddress).not.toHaveBeenCalled();
  });

  it("a bare POST with no body still just REGENERATES — nothing reaches the queue", async () => {
    const { queue, propose } = fakeQueue();
    getProposalQueue.mockReturnValue(queue);
    withModel();

    const res = await call();

    expect(res.status).toBe(200);
    const body = (await res.json()) as { brief: Record<string, unknown> };
    expect(body.brief.state).toBe("synthesized");
    expect(body).not.toHaveProperty("proposalId");
    expect(propose).not.toHaveBeenCalled();
    expect(getProjectAddress).not.toHaveBeenCalled();
  });

  it("a body with no intent is a 400, not a guess at what the caller wanted", async () => {
    const { propose } = fakeQueue();
    const res = await call({ sourceId: "default" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "intent_required" });
    expect(propose).not.toHaveBeenCalled();
  });

  it("a misspelled intent is a 400", async () => {
    const res = await call({ intent: "publsh" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
  });

  it("a malformed id is a 400 before any query runs", async () => {
    const request = new Request("http://localhost/api/projects/x/brief", {
      method: "POST",
      body: JSON.stringify({ intent: "publish" }),
    });
    const res = await POST(request, { params: Promise.resolve({ id: "not-a-uuid" }) });
    expect(res.status).toBe(400);
    expect(getProjectBriefSource).not.toHaveBeenCalled();
    expect(getProjectAddress).not.toHaveBeenCalled();
  });
});

describe("POST /api/projects/[id]/brief — a fallback is REFUSED", () => {
  it("answers 409 brief_not_synthesized and proposes NOTHING", async () => {
    const { queue, propose, stored } = fakeQueue();
    getProposalQueue.mockReturnValue(queue);
    // No model configured ⇒ the brief is a labelled fallback.

    const res = await call({ intent: "publish" });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.error).toBe("brief_not_synthesized");
    // The brief's own reason travels with the refusal, so the UI can explain it.
    expect(body.code).toBe("model_unconfigured");

    // The load-bearing half.
    expect(propose).not.toHaveBeenCalled();
    expect(stored).toHaveLength(0);
    expect(logEvent).toHaveBeenCalledWith(
      "brief.publish_refused",
      expect.objectContaining({ projectId: PROJECT, reason: "model_unconfigured" }),
    );
  });

  it("answers 409 for a model that failed, too — a digest is a digest", async () => {
    const { propose } = fakeQueue();
    resolveIntelligence.mockReturnValue({
      id: "fake",
      model: "fake-model",
      complete: vi.fn(async () => {
        throw new Error("upstream secret payload");
      }),
    });

    const res = await call({ intent: "publish" });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "model_failed" });
    expect(propose).not.toHaveBeenCalled();
  });
});

describe("POST /api/projects/[id]/brief — a synthesized brief is PUBLISHED", () => {
  beforeEach(() => {
    withModel();
  });

  it("proposes it and reports the provenance the brain needs", async () => {
    const { queue, propose } = fakeQueue();
    getProposalQueue.mockReturnValue(queue);

    const res = await call({ intent: "publish" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.created).toBe(true);
    expect(body.duplicate).toBe(false);
    expect(body.kind).toBe("brief");
    expect(body.pageSlug).toBe("projects/project-alpha");
    expect(body.pageHref).toBe("/app/projects/project-alpha");

    const provenance = body.provenance as Record<string, unknown>;
    expect(provenance.projectId).toBe(PROJECT);
    expect(provenance.projectName).toBe("Project Alpha");
    expect(provenance.modelId).toBe("fake-model");
    // The route stamps the REAL instant it synthesized at (it owns the clock);
    // what matters is that a parseable instant reached the row.
    expect(Number.isNaN(Date.parse(String(provenance.generatedAt)))).toBe(false);
    expect(provenance.promptVersion).toBeTruthy();

    const input = propose.mock.calls[0][0];
    expect(input.kind).toBe("brief");
    expect(input.pageSlug).toBe("projects/project-alpha");
    // The claim names the model — synthesized text is never the operator's words.
    expect(input.claimText).toContain("Nexalog project brief for Project Alpha");
    expect(input.claimText).toContain("fake-model");
    expect(input.planDiff).toMatchObject({
      type: "brief/1",
      project_id: PROJECT,
      model_id: "fake-model",
      evidence_note_titles: ["Kickoff"],
    });
  });

  it("publishing the SAME brief twice reports duplicate and creates ONE row", async () => {
    const { queue, propose, stored } = fakeQueue();
    getProposalQueue.mockReturnValue(queue);
    // A STABLE instant, so both publishes really do describe ONE brief. (The
    // route stamps the clock it synthesized at — one publish, one instant — so
    // freezing time is what makes "the same brief twice" the thing under test
    // rather than the clock. That a brief re-synthesized LATER is a new proposal
    // is the opposite property, covered in the core suite.)
    vi.useFakeTimers({ now: NOW, shouldAdvanceTime: true });

    const first = (await (await call({ intent: "publish" })).json()) as Record<string, unknown>;
    const second = (await (await call({ intent: "publish" })).json()) as Record<string, unknown>;

    expect(first.created).toBe(true);
    expect(first.duplicate).toBe(false);
    expect(second.created).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.proposalId).toBe(first.proposalId);
    expect(propose).toHaveBeenCalledTimes(2);
    expect(stored).toHaveLength(1);
    vi.useRealTimers();
  });

  it("answers 404 for a project the caller cannot see, before touching the queue", async () => {
    getProjectBriefSource.mockResolvedValue(null);
    const { propose } = fakeQueue();
    const res = await call({ intent: "publish" });
    expect(res.status).toBe(404);
    expect(propose).not.toHaveBeenCalled();
  });
});

describe("POST /api/projects/[id]/brief — degrading honestly", () => {
  beforeEach(() => {
    withModel();
  });

  it("answers 503 gbrain_unavailable when this deployment has no queue", async () => {
    getProposalQueue.mockReturnValue(null);

    const res = await call({ intent: "publish" });

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; code: string; message: string };
    expect(body.error).toBe("gbrain_unavailable");
    expect(body.code).toBe("not_configured");
    expect(body.message).toContain("GBRAIN_DATABASE_URL");
  });

  it("answers 503 when the queue write itself fails, never a fake success", async () => {
    const { queue } = fakeQueue();
    (queue.propose as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("connect ECONNREFUSED"),
    );
    getProposalQueue.mockReturnValue(queue);

    const res = await call({ intent: "publish" });

    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ error: "gbrain_unavailable", code: "write_failed" });
    // The transport detail stays in the log.
    expect(text).not.toContain("ECONNREFUSED");
  });

  it("answers 404 when the project resolves for the brief but not for the address", async () => {
    getProjectAddress.mockResolvedValue(null);
    const res = await call({ intent: "publish" });
    expect(res.status).toBe(404);
  });
});
