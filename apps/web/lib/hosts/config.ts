// SPDX-License-Identifier: MIT
// NEXALOG-HOSTSPLIT — the ONE place the host split reads `process.env`.
//
// `lib/hosts/split.ts` is pure and takes plain strings; this module is its only
// composition root. Keeping the two apart is what lets every rule be unit-tested
// with literals and keeps `process.env` out of the decision logic
// (clean-architecture: the env is read at the edge, never inward).
//
// The variables, and what each one means:
//
//   NEXALOG_FRONTEND_URL   the canonical FRONT-END origin (nexalog.com) — the
//                          host that serves the marketing page and the login page.
//   BETTER_AUTH_URL        the APP origin (app.nexalog.com) — already deployed,
//                          already the Better Auth base URL and the OAuth/passkey
//                          origin. Reused rather than duplicated.
//   NEXALOG_COOKIE_DOMAIN  optional override for the shared cookie Domain, for a
//                          deployment whose two hostnames are not parent/child.
//
// Both origins unset (or identical) means "no split": every helper in
// `split.ts` then returns an app-relative path, which is exactly the behaviour
// that shipped before this module existed. Nothing here throws on a missing
// value — a misconfigured deployment must degrade, not 500.

import {
  classifyHost,
  cookieDomain,
  isCookieShared,
  isSplitConfigured,
  parseOriginList,
  resolveOrigins,
  type HostOrigins,
} from "@/lib/hosts/split";

/**
 * The environment shape this module reads. Declared structurally rather than as
 * `NodeJS.ProcessEnv` so a test can pass a plain object of literals without
 * satisfying every ambient variable TypeScript's `ProcessEnv` claims exists.
 */
export type EnvLike = Record<string, string | undefined>;

/** The resolved origins plus the cookie-domain decision, read once per process. */
export interface HostConfig extends HostOrigins {
  /** The `Domain` to set on the session cookie, or `""` for host-only. */
  cookieDomain: string;
  /** True when a real two-host split is configured. */
  split: boolean;
  /** True when the session cookie can actually be shared across both hosts. */
  cookieShared: boolean;
}

/**
 * Read the split configuration from the environment. Called on the server only;
 * every value is optional and an unusable one degrades to "not configured"
 * rather than throwing.
 */
export function hostConfig(env: EnvLike = process.env): HostConfig {
  const origins = resolveOrigins({
    frontendUrl: env.NEXALOG_FRONTEND_URL,
    // `BETTER_AUTH_URL` is the app origin the deployment already carries. An
    // explicit `NEXALOG_APP_URL` wins when a deployment needs them to differ.
    appUrl: env.NEXALOG_APP_URL ?? env.BETTER_AUTH_URL,
  });
  const domain = cookieDomain(origins, env.NEXALOG_COOKIE_DOMAIN ?? null);
  return {
    ...origins,
    cookieDomain: domain,
    split: isSplitConfigured(origins),
    cookieShared: isCookieShared(origins, env.NEXALOG_COOKIE_DOMAIN ?? null),
  };
}

/**
 * The origins Better Auth must treat as trusted, as a FLAT list.
 *
 * `TRUSTED_ORIGIN` is consumed here as a comma/whitespace separated LIST rather
 * than one opaque string. That is the fix for the single most likely
 * misconfiguration of this feature: with `trustedOrigins: [BETTER_AUTH_URL,
 * TRUSTED_ORIGIN]`, a value of `"https://a,https://b"` becomes ONE malformed
 * entry that matches no Origin header at all, and every auth request carrying
 * the second host is refused with `INVALID_ORIGIN`.
 *
 * Additive by construction: the app origin is included, so a deployment that
 * sets only `BETTER_AUTH_URL` produces the same single trusted origin it has
 * today. The front-end origin is added when configured, and `TRUSTED_ORIGIN`'s
 * own entries are preserved verbatim (split, trimmed, de-duplicated).
 */
export function trustedOriginsFromEnv(env: EnvLike = process.env): string[] {
  const config = hostConfig(env);
  const out: string[] = [];
  const push = (value: string) => {
    const trimmed = value.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  };

  if (config.app) push(config.app);
  for (const entry of parseOriginList(env.TRUSTED_ORIGIN)) push(entry);
  if (config.frontend) push(config.frontend);

  return out;
}

/** Which side of the split a request host belongs to — re-exported for adapters. */
export { classifyHost };

/**
 * Every origin a WebAuthn ceremony may legitimately have occurred on. Passkey
 * verification compares the credential's `clientDataJSON.origin` against this
 * list, so with the split configured a passkey login taken on the FRONT host
 * would fail against an app-host-only value even though the RP ID (the
 * registrable domain) is already correct for both.
 *
 * Only configured origins appear, so a single-host deployment verifies exactly
 * one origin — the same value the route used before this existed.
 */
export function passkeyOrigins(env: EnvLike = process.env): string[] {
  const config = hostConfig(env);
  const origins: string[] = [];
  // `NEXT_PUBLIC_APP_URL` is the fallback the routes used before this helper
  // existed, so a self-hosted deployment that only ever set it keeps working.
  for (const origin of [config.app, config.frontend, env.NEXT_PUBLIC_APP_URL]) {
    // A WebAuthn origin must carry a scheme; `originOf` yields "" for a bare
    // host or an unset variable, and neither may reach verification.
    if (origin && origin.startsWith("http") && !origins.includes(origin)) {
      origins.push(origin);
    }
  }
  return origins.length > 0 ? origins : ["http://localhost:3000"];
}
