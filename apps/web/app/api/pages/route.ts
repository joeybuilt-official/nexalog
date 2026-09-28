// SPDX-License-Identifier: MIT
/**
 * GET /api/pages — the brain's page index.
 *
 * Why this exists: search could FIND brain pages and nothing could OPEN them.
 * A brain hit carries a slug as its id, every result link assumed a capture
 * uuid, and no route listed the pages at all — so the brain was write-only from
 * the app's point of view.
 *
 * Auth is identical to the neighbouring `/api/search` (a session is required;
 * an unauthenticated caller is a 401 before any read happens). Brain pages are
 * global to the deployment — one brain repo, one GBrain index — so the session
 * IS the isolation boundary here; there is no workspace column to scope by.
 *
 * Degradation is the same honest ladder `/api/graph` uses: a GBrain outage
 * returns 200 with `source: "local"` (read from the brain repo, the system of
 * record) or `source: "none"` plus a `note` explaining why — never a 500 and
 * never a blank screen.
 *
 * Query params: `limit` (1..100, default 50), `offset`, `type`, `sort`.
 */

export const dynamic = "force-dynamic";

import { getAuthUser } from "@/lib/auth/server";
import { logEvent } from "@/lib/logger";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, readPages } from "@/lib/pages/read";

const SORTS = ["updated_desc", "updated_asc", "created_desc", "slug"] as const;

function positiveInt(raw: string | null, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(MAX_PAGE_LIMIT, positiveInt(url.searchParams.get("limit"), DEFAULT_PAGE_LIMIT)));
  const offset = positiveInt(url.searchParams.get("offset"), 0);
  const type = url.searchParams.get("type")?.trim() || undefined;
  const sortRaw = url.searchParams.get("sort");
  const sort = SORTS.find((s) => s === sortRaw);

  logEvent("route.start", { route: "/api/pages", method: "GET", limit, offset });

  const payload = await readPages({ limit, offset, ...(type ? { type } : {}), ...(sort ? { sort } : {}) });
  return Response.json(payload);
}
