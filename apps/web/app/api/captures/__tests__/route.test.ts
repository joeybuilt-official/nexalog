// SPDX-License-Identifier: MIT
/**
 * Endpoint test for GET /api/captures — the JSON list a non-web client (today:
 * the native mobile app) reads so it can show the operator which captures
 * await a decision.
 *
 * Asserts, per `.claude/rules/testing.md` → "What an endpoint test asserts":
 *   - success with the exact response shape (field names, types, nesting) —
 *     including the normalized proposal, which is the whole reason the client
 *     can judge a capture without a second request;
 *   - filtering (`?status=`) and the limit, plus the counts being over the
 *     WHOLE inbox rather than the returned page;
 *   - every validation failure (bad status, bad limit, misspelled parameter)
 *     and the status each produces;
 *   - the unauthorized path;
 *   - the unexpected-failure path — a 500 with a typed body and a log line,
 *     never a silent or partial success.
 *
 * The use case is faked at the composition root (`@/composition`) and auth is
 * mocked to a fixed user, so nothing here boots Next, touches the brain repo,
 * or re-tests auth (testing.md → "Mocking").
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { execute, getAuthUser, logEvent, getComposition } = vi.hoisted(() => ({
  execute: vi.fn(),
  getAuthUser: vi.fn(),
  logEvent: vi.fn(),
  getComposition: vi.fn(),
}));

vi.mock("@/composition", () => ({ getComposition }));
vi.mock("@/lib/auth/server", () => ({ getAuthUser }));
vi.mock("@/lib/logger", () => ({ logEvent }));

import { GET } from "@/app/api/captures/route";

const USER = { id: "user-1" };

/** One capture summary exactly as `ListInbox` returns it. */
function summary(over: Record<string, unknown> = {}) {
  return {
    id: "0123456789ABCDEFGHJKMNPQRS",
    title: "voice note about the pricing page",
    status: "review",
    kind: "audio",
    source: "pwa-share",
    capturedAt: "2026-09-25T18:03:05.000Z",
    hasAttachments: true,
    proposal: null,
    ...over,
  };
}

const PROPOSAL = {
  pages: ["people/jane-doe", { slug: "concepts/pricing", title: "Pricing" }],
  links: [["people/jane-doe", "concepts/pricing"]],
  summary: "Extracted 1 person, 1 concept",
  confidence: 0.42,
};

const ROWS: Array<Record<string, unknown>> = [];

function call(query = "") {
  const request = new Request(`http://localhost/api/captures${query}`, { method: "GET" });
  return GET(request);
}

beforeEach(() => {
  ROWS.length = 0;
  execute.mockReset();
  execute.mockImplementation(async () => ROWS);
  getAuthUser.mockReset();
  getAuthUser.mockResolvedValue(USER);
  logEvent.mockReset();
  getComposition.mockReset();
  getComposition.mockReturnValue({ listInbox: { execute } });
});

describe("GET /api/captures", () => {
  it("lists the inbox with a normalized proposal and per-status counts", async () => {
    ROWS.push(
      summary({ proposal: PROPOSAL }),
      summary({ id: "0123456789ABCDEFGHJKMNPQRT", status: "processed", proposal: null }),
    );

    const response = await call();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      captures: [
        {
          id: "0123456789ABCDEFGHJKMNPQRS",
          title: "voice note about the pricing page",
          status: "review",
          kind: "audio",
          source: "pwa-share",
          capturedAt: "2026-09-25T18:03:05.000Z",
          hasAttachments: true,
          proposal: {
            summary: "Extracted 1 person, 1 concept",
            confidence: 0.42,
            pages: [
              {
                slug: "people/jane-doe",
                dir: "people",
                label: "Jane Doe",
                type: "person",
                typeLabel: "Person",
                href: "/app/graph?slug=people%2Fjane-doe",
              },
              {
                slug: "concepts/pricing",
                dir: "concepts",
                label: "Pricing",
                type: "concept",
                typeLabel: "Concept",
                href: "/app/graph?slug=concepts%2Fpricing",
              },
            ],
            links: [
              {
                from: {
                  slug: "people/jane-doe",
                  dir: "people",
                  label: "Jane Doe",
                  type: "person",
                  typeLabel: "Person",
                  href: "/app/graph?slug=people%2Fjane-doe",
                },
                to: {
                  slug: "concepts/pricing",
                  dir: "concepts",
                  label: "Pricing",
                  type: "concept",
                  typeLabel: "Concept",
                  href: "/app/graph?slug=concepts%2Fpricing",
                },
              },
            ],
          },
        },
        {
          id: "0123456789ABCDEFGHJKMNPQRT",
          title: "voice note about the pricing page",
          status: "processed",
          kind: "audio",
          source: "pwa-share",
          capturedAt: "2026-09-25T18:03:05.000Z",
          hasAttachments: true,
          proposal: null,
        },
      ],
      counts: { inbox: 0, processing: 0, review: 1, processed: 1, rejected: 0 },
    });
    expect(getAuthUser).toHaveBeenCalledTimes(1);
  });

  it("filters by status but still counts the whole inbox", async () => {
    ROWS.push(
      summary({ id: "0123456789ABCDEFGHJKMNPQRS", status: "review" }),
      summary({ id: "0123456789ABCDEFGHJKMNPQRT", status: "processed" }),
      summary({ id: "0123456789ABCDEFGHJKMNPQRV", status: "review" }),
    );

    const response = await call("?status=review");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.captures.map((c: { id: string }) => c.id)).toEqual([
      "0123456789ABCDEFGHJKMNPQRS",
      "0123456789ABCDEFGHJKMNPQRV",
    ]);
    // The processed row is filtered OUT of the list but still counted — the
    // count answers "how much is in the inbox", not "how much did I return".
    expect(body.counts).toEqual({ inbox: 0, processing: 0, review: 2, processed: 1, rejected: 0 });
  });

  it("applies the limit to the returned page only", async () => {
    for (let i = 0; i < 5; i += 1) {
      ROWS.push(summary({ id: `0123456789ABCDEFGHJKMNPQ${i}${i}${i}` }));
    }

    const response = await call("?limit=2");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.captures).toHaveLength(2);
    expect(body.counts.review).toBe(5);
  });

  it("reads the store once per request — the list and its counts cannot disagree", async () => {
    ROWS.push(summary({ status: "review" }));

    await call("?status=review");

    // A second read for the counts could observe a different inbox (the worker
    // commits while the operator looks) and report a count the list contradicts.
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({});
  });

  it("returns an empty list and zero counts for an empty inbox", async () => {
    const response = await call();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.captures).toEqual([]);
    expect(body.counts).toEqual({ inbox: 0, processing: 0, review: 0, processed: 0, rejected: 0 });
  });

  it("401s without a session, and never reads the inbox", async () => {
    getAuthUser.mockResolvedValue(null);

    const response = await call();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("400s on an unknown status", async () => {
    const response = await call("?status=needs_review");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_query" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("400s on a misspelled parameter instead of ignoring the intent", async () => {
    const response = await call("?stat=review");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_query" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("400s on a limit that is zero, negative, fractional, over the cap, or not a number", async () => {
    for (const limit of ["0", "-1", "2.5", "501", "abc"]) {
      const response = await call(`?limit=${limit}`);
      expect(response.status, limit).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_query" });
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it("400s on a repeated parameter rather than silently taking one of them", async () => {
    const response = await call("?status=review&status=processed");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_query" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("still lists the capture when the worker wrote a malformed proposal", async () => {
    ROWS.push(summary({ proposal: { pages: ["has space", 7], links: ["nope"], summary: "kept" } }));

    const response = await call();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.captures[0].proposal).toEqual({
      summary: "kept",
      confidence: null,
      pages: [],
      links: [],
    });
    expect(body.captures[0].title).not.toBeUndefined();
  });

  it("reports no proposal as null, not an empty object", async () => {
    ROWS.push(summary({ proposal: { pages: [], links: [], summary: "" } }));

    const response = await call();
    const body = await response.json();

    expect(body.captures[0].proposal).toBeNull();
  });

  it("500s loudly on an unexpected failure — typed body, logged, no partial list", async () => {
    execute.mockRejectedValue(new Error("inbox directory on fire"));

    const response = await call("?status=review");

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "captures_failed" });
    expect(logEvent).toHaveBeenCalledWith(
      "captures.list.failed",
      expect.objectContaining({ status: "review", limit: 200, error: "inbox directory on fire" }),
    );
  });

  it("500s (not a framework crash) when the composition root itself cannot build", async () => {
    getComposition.mockImplementation(() => {
      throw new Error("BRAIN_REPO env is required (absolute path to the brain repo)");
    });

    const response = await call();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "captures_failed" });
    expect(logEvent).toHaveBeenCalledWith(
      "captures.list.failed",
      expect.objectContaining({ status: null }),
    );
  });
});
