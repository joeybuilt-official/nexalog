// SPDX-License-Identifier: MIT
import { type NextRequest, NextResponse } from "next/server";
import { hostConfig } from "@/lib/hosts/config";
import { requestHost, resolveHostRedirect } from "@/lib/hosts/split";

const PUBLIC_PATHS = new Set(["/", "/login", "/signup", "/privacy", "/terms", "/cookie", "/refund"]);
// /api/plexo/*       — service-key auth in handler (timing-safe Bearer)
// /api/cron/*        — X-Cron-Secret auth in handler
// /api/plan-impact/* — X-Cron-Secret auth in handler (the reconcile pass's
//                      scheduler door; `reconcile/route.ts` implements it)
// These are public at the middleware layer so the request reaches the
// per-route handler where the real auth gate lives.
//
// WHY the plan-impact entry is required, not cosmetic: this gate only admits a
// request carrying a session cookie or a bearer token, and a scheduler sends
// neither — it sends `X-Cron-Secret`. Without the prefix, the edge returned
// `{"error":"Unauthorized"}` before the handler ran, so the cron door the route
// documents was unreachable from any caller and the route's own constant-time
// check could never execute. Adding it does NOT weaken auth: the handler still
// 401s unless the secret matches or a session is present, and the secret is
// compared in constant time there.
const PUBLIC_PREFIXES = [
  "/api/auth",
  "/api/health",
  "/api/plexo",
  "/api/cron",
  "/api/plan-impact",
  "/_next",
  "/favicon",
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * NEXALOG-HOSTSPLIT — nexalog.com (the front-end host: marketing + login) and
 * app.nexalog.com (the app host: /app/*) are two hostnames on ONE deployment.
 * This middleware is the edge adapter: it reads the request host and executes
 * the answer from `lib/hosts/split.ts`, which is pure and unit-tested. No host
 * rule lives here.
 *
 * The host split resolves BEFORE the public-path short circuit, because the two
 * paths it most needs to act on for an anonymous reader — `/` and `/login` — are
 * themselves public. Every rule fires on the app host (plus the signed-in login
 * case) and lands on a request that takes the other branch, so the set cannot
 * loop: the app host never bounces an anonymous `/app/*` back to itself, and a
 * signed-in reader is never sent to a path that a host rule would redirect again.
 *
 * The host is read from `x-forwarded-host`/`host` and never from
 * `nextUrl.host`: behind the tunnel that resolves to the container's own bind
 * address, which would classify every request as an unknown host and silently
 * disable the split.
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Protected routes — check session cookie presence for edge redirect.
  // Full session validation happens in layout server components.
  const sessionCookie =
    request.cookies.get("better-auth.session_token") ??
    request.cookies.get("__Secure-better-auth.session_token");

  // The native mobile client authenticates with `Authorization: Bearer ***
  // and sends no session cookie. Let those requests through to the route
  // handler, where getAuthUser validates the bearer token (ADR-0002). Without
  // this the edge gate 401'd every mobile API call before the handler ran → the
  // app synced nothing and showed no content.
  const hasBearer = request.headers
    .get("authorization")
    ?.toLowerCase()
    .startsWith("bearer ");
  const signedIn = Boolean(sessionCookie) || Boolean(hasBearer);

  // `/api/**` is NEVER host-forwarded: a cross-host redirect would drop either
  // the method or the caller's Authorization header, and a browser fetch that
  // follows a cross-origin redirect cannot read the response. The API surface is
  // reachable on both hostnames by design, and the browser's own calls stay
  // same-origin. Assets are skipped for the obvious reason.
  const hostDecides =
    !pathname.startsWith("/api/") &&
    !pathname.startsWith("/_next") &&
    !pathname.startsWith("/favicon");

  if (hostDecides) {
    const splitTarget = resolveHostRedirect({
      origins: hostConfig(),
      host: requestHost(request.headers),
      pathname,
      search,
      hasSession: signedIn,
    });
    if (splitTarget) {
      return NextResponse.redirect(splitTarget);
    }
  }

  if (isPublic(pathname) || signedIn) {
    return NextResponse.next();
  }

  // API clients (the browser extension) must get a real 401 — not a 307 to
  // the /login page, which a POST would follow and then 405 on the GET-only
  // page route. Pages still redirect so the browser lands on the login form.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The pre-existing same-host redirect, unchanged for a single-host
  // deployment and for any front-host (or unknown-host) protected path.
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
