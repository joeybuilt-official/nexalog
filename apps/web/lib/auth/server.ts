import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import type { User } from "./types";

export async function getAuthUser(): Promise<User | null> {
  try {
    const requestHeaders = await headers();

    // Bearer support for the native mobile client (ADR-0002). better-auth's
    // bearer() plugin verifies the token signature as base64urlnopad, but the
    // cookie/`set-auth-token` value it issues is signed base64-standard — so a
    // valid mobile token is rejected by the plugin and getSession returns null.
    // The same value DOES validate as a session cookie, so when an
    // Authorization: Bearer header is present we resolve the session by
    // injecting the token as the session cookie and dropping the bearer header
    // (so the broken plugin hook can't interfere). One getSession call — reuses
    // better-auth's own verification, same trust model as the cookie path.
    let authHeaders: Headers = requestHeaders as unknown as Headers;
    const authz = requestHeaders.get("authorization");
    if (authz && authz.slice(0, 7).toLowerCase() === "bearer ") {
      const token = authz.slice(7).trim();
      if (token) {
        const secure = (process.env.BETTER_AUTH_URL ?? "").startsWith("https");
        const cookieName =
          (secure ? "__Secure-" : "") + "better-auth.session_token";
        const h = new Headers();
        requestHeaders.forEach((v, k) => {
          if (k.toLowerCase() !== "authorization" && k.toLowerCase() !== "cookie") {
            h.set(k, v);
          }
        });
        const existing = requestHeaders.get("cookie");
        h.set(
          "cookie",
          existing ? `${existing}; ${cookieName}=${token}` : `${cookieName}=${token}`,
        );
        authHeaders = h;
      }
    }

    const session = await auth.api.getSession({ headers: authHeaders });
    if (!session?.user) return null;
    const user = session.user as User;
    // Universal Plexo auto-connect — debounced, fire-and-forget.
    // First call per user per hour ensures their workspace exists and
    // this app is registered as an installed connection + bridge.
    return user;
  } catch {
    return null;
  }
}
