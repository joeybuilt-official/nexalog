import { describe, expect, it } from "vitest";

import { middleware } from "../../middleware";

/**
 * The edge gate must admit a scheduler's `X-Cron-Secret` request so the handler
 * that owns the cron door can run.
 *
 * WHY THIS FILE LIVES UNDER `app/` AND NOT `lib/` — co-located with the middleware
 * it exercises, the way the render specs are co-located with the surfaces they
 * render. `middleware.ts` is an edge/UI-layer module, and `web-lib-no-ui` forbids
 * `lib/**` from importing it. The first cut of this test sat in
 * `lib/__tests__/` and the architecture gate failed it —
 * `error web-lib-no-ui: lib/__tests__/middleware-cron-door.test.ts → middleware.ts`.
 * That is the gate working: an import edge is an import edge regardless of whether
 * the importing file ships.
 *
 * WHERE THE SECURITY ACTUALLY LIVES — read this before "fixing" a test below.
 *
 * `app/api/plan-impact/reconcile/route.ts` documents two ways in: a session, or
 * `X-Cron-Secret` compared in constant time. But `middleware.ts` only admitted a
 * request carrying a session cookie or a bearer token, and a scheduler sends
 * neither. The edge therefore answered `{"error":"Unauthorized"}` before the
 * handler executed, so the documented cron door was unreachable from ANY caller
 * and the route's own check could never run.
 *
 * The fix makes `/api/plan-impact/*` middleware-public. The edge no longer
 * decides for that path; the handler's constant-time secret check and
 * `getAuthUser` do. So an assertion that "the middleware 401s a bad caller"
 * would now be asserting the wrong layer — and could no longer fail for the
 * reason it claims. The refusal property belongs in the route's own test.
 *
 * This file pins the middleware's contract: it must not synthesise its own 401
 * for the cron surface, and it must not have loosened the gate for anything else.
 */

function reconcileRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://app.nexalog.com/api/plan-impact/reconcile", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Run the middleware the way Next does, against a request. */
async function runMiddleware(request: Request): Promise<Response> {
  const { NextRequest } = await import("next/server");
  const nextRequest = new NextRequest(new URL(request.url), {
    method: request.method,
    headers: request.headers,
  });
  const result = await middleware(nextRequest);
  return result instanceof Response ? result : new Response(null, { status: 200 });
}

describe("middleware — the plan-impact cron surface reaches its handler", () => {
  it("does NOT synthesise its own 401 for an X-Cron-Secret request", async () => {
    const res = await runMiddleware(reconcileRequest({ "x-cron-secret": "any-value" }));
    expect(res.status).not.toBe(401);
    expect(await res.clone().text()).not.toContain("Unauthorized");
  });

  it("passes a credential-less request to the handler too — the edge is not the decision point", async () => {
    // The deliberate consequence of the fix, asserted so it is a recorded
    // decision rather than a surprise: the middleware no longer decides this
    // path. The handler refuses the caller. Note this means the edge is NOT a
    // second line of defence here — the prefix is what makes the documented
    // cron contract satisfiable at all.
    const res = await runMiddleware(reconcileRequest());
    expect(res.status).not.toBe(401);
  });

  it("still refuses an unrelated protected API path at the edge", async () => {
    // The fix must not have loosened the gate generally: a path outside the
    // public prefixes is still edge-refused. The cron prefix was added alongside
    // that behaviour, not in place of it.
    const { NextRequest } = await import("next/server");
    const req = new NextRequest(new URL("https://app.nexalog.com/api/projects"), {
      method: "GET",
    });
    const res = await middleware(req);
    expect(res.status).toBe(401);
    expect(await res.clone().text()).toContain("Unauthorized");
  });
});
