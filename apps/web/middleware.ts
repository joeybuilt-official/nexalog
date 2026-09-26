// SPDX-License-Identifier: MIT
import { type NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = new Set(["/", "/login", "/signup", "/privacy", "/terms", "/cookie", "/refund"]);
// /api/plexo/*  — service-key auth in handler (timing-safe Bearer)
// /api/cron/*   — X-Cron-Secret auth in handler
// Both are public at the middleware layer so the request reaches the
// per-route handler where the real auth gate lives.
const PUBLIC_PREFIXES = ["/api/auth", "/api/health", "/api/plexo", "/api/cron", "/_next", "/favicon"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  // Protected routes — check session cookie presence for edge redirect.
  // Full session validation happens in layout server components.
  const sessionCookie =
    request.cookies.get("better-auth.session_token") ??
    request.cookies.get("__Secure-better-auth.session_token");

  // The native mobile client authenticates with `Authorization: Bearer <token>`
  // and sends no session cookie. Let those requests through to the route
  // handler, where getAuthUser validates the bearer token (ADR-0002). Without
  // this the edge gate 401'd every mobile API call before the handler ran → the
  // app synced nothing and showed no content.
  const hasBearer = request.headers
    .get("authorization")
    ?.toLowerCase()
    .startsWith("bearer ");

  if (!sessionCookie && !hasBearer) {
    // API clients (the browser extension) must get a real 401 — not a 307 to
    // the /login page, which a POST would follow and then 405 on the GET-only
    // page route. Pages still redirect so the browser lands on the login form.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
