// SPDX-License-Identifier: MIT
/**
 * GET /api/pages/[...slug] — one brain page: title, type, body, typed links
 * out and in.
 *
 * The catch-all segment is REQUIRED, not stylistic: a brain slug is a path
 * (`concepts/litellm-gateway`, `atoms/2026-09-28/some-atom`), so a single
 * dynamic segment could never address one.
 *
 * Auth matches the neighbouring `/api/search`: a session is required. A slug
 * that does not resolve is a 404 in the repo's typed-error shape.
 *
 * `getPage` / `getBacklinks` / `traverseGraph` are the EXISTING client methods
 * (Phase 2b wired them); this route only decides which rung of the degradation
 * ladder the answer came from.
 */

export const dynamic = "force-dynamic";

import { getAuthUser } from "@/lib/auth/server";
import { logEvent } from "@/lib/logger";
import { readPage } from "@/lib/pages/read";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string[] }> },
) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { slug } = await params;
  const joined = (slug ?? []).join("/");
  if (!joined) return Response.json({ error: "missing_slug" }, { status: 400 });

  logEvent("route.start", { route: "/api/pages/[...slug]", method: "GET", slug: joined });

  const payload = await readPage(joined);
  if (!payload) return Response.json({ error: "not_found", slug: joined }, { status: 404 });

  return Response.json(payload);
}
