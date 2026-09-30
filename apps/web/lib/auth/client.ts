// SPDX-License-Identifier: MIT
import { createAuthClient } from "better-auth/react";

/**
 * The browser auth client talks to the host that SERVED the page, by design.
 *
 * Both hostnames are one deployment, and `app/api/auth/[...all]/route.ts` is
 * reachable on either. An absolute `baseURL` (the old
 * `NEXT_PUBLIC_APP_URL` wiring) forced every request from a page served on
 * nexalog.com to be a CROSS-ORIGIN request to app.nexalog.com — and better-auth
 * serves no CORS headers, so the browser blocked the login outright. An empty
 * `baseURL` makes better-auth resolve `window.location.origin` and post to
 * `/api/auth/*` same-origin, so a login taken on the front host works with no
 * CORS surface at all.
 *
 * The session cookie is still valid on both hosts: it is written with the shared
 * `Domain` when a host split is configured (see `lib/auth.ts`).
 */
const _authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_AUTH_URL ?? "",
});

export function useSession() {
  return _authClient.useSession();
}

export async function signIn(email: string, password: string) {
  return _authClient.signIn.email({ email, password });
}

export async function signUp(email: string, password: string, name: string) {
  return _authClient.signUp.email({ email, password, name });
}

export async function signOut() {
  return _authClient.signOut();
}

export async function updateUser(fields: { name?: string; image?: string }) {
  return _authClient.updateUser(fields);
}

export async function changePassword(currentPassword: string, newPassword: string) {
  return _authClient.changePassword({ currentPassword, newPassword });
}

export async function signInWithGoogle() {
  return _authClient.signIn.social({
    provider: "google",
    // Resolved against the auth baseURL, i.e. the app host — so the OAuth
    // round trip ends inside the app rather than back on the marketing site.
    callbackURL: "/app/today",
  });
}
