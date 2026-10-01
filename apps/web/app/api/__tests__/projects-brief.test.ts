// SPDX-License-Identifier: MIT
/**
 * Route tests for `GET|POST /api/projects/[id]/brief`.
 *
 * The claims that can only be made through the route: auth is required, another
 * workspace's project is a 404 (never a 403), a malformed id is a 400 before any
 * query runs, and — the point of the feature — an unconfigured model is a 200
 * with a LABELLED fallback, never a 5xx. A missing table degrades to the repo's
 * 503 `surface_unavailable` rather than an unhandled 500.
 *
 * The auth module, the workspace lookup, the brief store and the port resolver
 * are injected; the pure assembly and the use case run for real, so the response
 * shape is the production one.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAuthUser, getUserWorkspaces, getProjectBriefSource, resolveIntelligence, logEvent } =
  vi.hoisted(() => ({
    getAuthUser: vi.fn(),
    getUserWorkspaces: vi.fn(),
    getProjectBriefSource: vi.fn(),
    resolveIntelligence: vi.fn(),
    logEvent: vi.fn(),
  }));

vi.mock("@/lib/auth/server", () => ({ getAuthUser }));
vi.mock("@/lib/workspace", () => ({ getUserWorkspaces }));
vi.mock("@/lib/projects/store", () => ({ getProjectBriefSource }));
vi.mock("@/lib/intelligence/resolve", () => ({ resolveIntelligence }));
vi.mock("@/lib/logger", () => ({ logEvent }));

import { GET, POST } from "../projects/[id]/brief/route";
import type { ProjectBriefSource } from "@/lib/projects/brief";

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

function call(handler: typeof GET, id: string): Promise<Response> {
  return handler(new Request("http://localhost/api/projects/x/brief"), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthUser.mockResolvedValue({ id: "user-1" });
  getUserWorkspaces.mockResolvedValue([{ id: WS }]);
  getProjectBriefSource.mockResolvedValue(source());
  resolveIntelligence.mockReturnValue(null);
});

describe("GET /api/projects/[id]/brief", () => {
  it("requires a session", async () => {
    getAuthUser.mockResolvedValue(null);
    const res = await call(GET, PROJECT);
    expect(res.status).toBe(401);
    expect(getProjectBriefSource).not.toHaveBeenCalled();
  });

  it("rejects a malformed id before any query runs", async () => {
    const res = await call(GET, "not-a-uuid");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_id" });
    expect(getProjectBriefSource).not.toHaveBeenCalled();
  });

  it("answers 404 for a project the caller cannot see", async () => {
    getProjectBriefSource.mockResolvedValue(null);
    const res = await call(GET, PROJECT);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("degrades to a LABELLED fallback with no model configured — never a 5xx", async () => {
    const res = await call(GET, PROJECT);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as { brief: Record<string, unknown> };
    expect(body.brief.state).toBe("fallback");
    expect(body.brief.reason).toBe("model_unconfigured");
    expect(body.brief.model).toBeNull();
    expect(String(body.brief.markdown)).toContain("Not synthesized");
    expect(body.brief.summary).toMatchObject({ notesTotal: 1, notesShown: 1, subProjectsTotal: 1 });
  });

  it("returns the synthesized brief when a model is configured", async () => {
    resolveIntelligence.mockReturnValue({
      id: "fake",
      model: "fake-model",
      complete: vi.fn(async () => ({ text: "# Alpha\n\n## Current state\n- live", model: "fake-model" })),
    });

    const res = await call(GET, PROJECT);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { brief: Record<string, unknown> };
    expect(body.brief.state).toBe("synthesized");
    expect(body.brief.model).toBe("fake-model");
    expect(body.brief.reason).toBeNull();
    expect(String(body.brief.markdown)).toContain("## Current state");
    expect(body.brief.summary).toMatchObject({ themes: ["Agents"] });
  });

  it("degrades to the fallback when the model fails, without leaking the error", async () => {
    resolveIntelligence.mockReturnValue({
      id: "fake",
      model: "fake-model",
      complete: vi.fn(async () => {
        throw new Error("upstream secret payload");
      }),
    });

    const res = await call(GET, PROJECT);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { brief: Record<string, unknown> };
    expect(body.brief.state).toBe("fallback");
    expect(body.brief.reason).toBe("model_failed");
    expect(JSON.stringify(body)).not.toContain("upstream secret payload");
    expect(logEvent).toHaveBeenCalledWith("brief.synthesis_failed", expect.objectContaining({ code: "unknown" }));
  });
});

describe("POST /api/projects/[id]/brief — the regenerate verb", () => {
  it("answers with the same shape as GET", async () => {
    const res = await call(POST, PROJECT);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { brief: Record<string, unknown> };
    expect(body.brief.state).toBe("fallback");
    expect(body.brief.promptVersion).toBeTruthy();
    expect(logEvent).toHaveBeenCalledWith(
      "brief.responded",
      expect.objectContaining({ method: "POST", state: "fallback" }),
    );
  });
});

describe("missing relation", () => {
  it("degrades to 503 surface_unavailable instead of an unhandled 500", async () => {
    const error = Object.assign(new Error('relation "nexalog.notes" does not exist'), { code: "42P01" });
    getProjectBriefSource.mockRejectedValue(error);

    const res = await call(GET, PROJECT);

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.error).toBe("surface_unavailable");
    expect(body.code).toBe("missing_relation");
  });
});
