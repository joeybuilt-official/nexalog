// SPDX-License-Identifier: MIT
// NEXALOG-HOSTSPLIT — the pure host-decision layer for the nexalog.com /
// app.nexalog.com split. No React, no I/O, no `next/*`, no env reads: every
// input is a plain string, every output is a plain string, so the rules are
// unit-testable and the middleware / server components that hold them are thin
// adapters (clean-architecture: a conditional that encodes a rule does not live
// in a UI component or in framework wiring).
//
// The shape of the deployment this encodes — BOTH hostnames serve the SAME
// Next app:
//
//   nexalog.com      the canonical FRONT-END host: marketing landing + login
//   app.nexalog.com  the canonical APP host: /app/*
//
// Three rules, in the order they matter:
//
//   1. Login is canonical on the FRONT host. An unauthenticated request for a
//      protected path is sent to `<frontend>/login?next=<path>` whether it
//      arrived on the front host or the app host. `next` is ALWAYS an
//      app-relative path (never an absolute URL) — that is what makes it
//      open-redirect-proof by construction: there is no attacker-controlled
//      origin for the destination to point at.
//   2. After a successful login the destination is resolved against the APP
//      host, never the host the form happened to be served from.
//   3. A signed-in reader who lands on the front host's marketing page is sent
//      into the app rather than left on a page that tells them to sign in.
//
// Everything degrades to "today's behaviour" when the split is not configured
// (either origin empty, or both hosts identical): every function then returns
// an app-relative path, which is exactly what the repo did before this module
// existed. That is deliberate — a self-hoster running one host must be
// unaffected, and a misconfigured deployment must not be able to redirect a
// user off-site.

/** The canonical destination once a reader is signed in. */
export const DEFAULT_APP_PATH = "/app/today";

/** The only path a login is ever served from. */
export const LOGIN_PATH = "/login";

/**
 * The resolved origins. Either may be `""`, which means "not configured" — call
 * `isSplitConfigured` before treating the pair as a real host split.
 */
export interface HostOrigins {
  /** Front-end origin, e.g. `https://nexalog.com`. `""` when unset/ unusable. */
  frontend: string;
  /** App origin, e.g. `https://app.nexalog.com`. `""` when unset/unusable. */
  app: string;
}

export interface HostOriginsInput {
  frontendUrl?: string | null;
  appUrl?: string | null;
}

/**
 * Normalize an origin-ish string to a bare lowercase `host` or `host:port`
 * authority (no scheme, no path, no userinfo), or `""` when it carries no host.
 * Accepts a full URL (`https://app.nexalog.com/`), a bare authority
 * (`app.nexalog.com:443`), or a hostname; also the comma-joined and
 * whitespace-padded forms a deploy `env` file tolerates.
 *
 * A port is PRESERVED when it is a real one: an Origin header carries the port
 * (`http://localhost:3300`), so dropping it would stop the dev origin from
 * matching. Only the comma split takes the first entry.
 */
export function authorityOf(value: string | null | undefined): string {
  let raw = (value ?? "").split(",")[0]?.trim() ?? "";
  if (!raw) return "";
  raw = raw.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, ""); // scheme
  raw = raw.replace(/^\/+/, ""); // leading slashes
  raw = raw.split("/")[0] ?? ""; // path
  raw = raw.split("?")[0] ?? ""; // query
  raw = raw.split("#")[0] ?? ""; // fragment
  raw = raw.split("@").pop() ?? ""; // userinfo
  raw = raw.replace(/^\.+/, ""); // cookie-domain leading dot (".example.com")
  return raw.trim().toLowerCase();
}

/**
 * Normalize an origin-ish string to a bare lowercase HOSTNAME (authority minus
 * any port), or `""`. This is the form used for HOST COMPARISON — `nexalog.com`
 * and `nexalog.com:443` are the same site for the purpose of deciding which
 * side of the split a request is on.
 */
export function hostnameOf(value: string | null | undefined): string {
  const authority = authorityOf(value);
  if (!authority) return "";
  // IPv6 literals keep their brackets; only strip a real trailing port.
  if (authority.startsWith("[")) return authority.split("]")[0] + "]";
  return authority.replace(/:\d+$/, "");
}

/**
 * Normalize a value to an absolute origin (`https://host[:port]`), or `""` when
 * it is unusable. `http://` is preserved so local development works; anything
 * else defaults to `https://` because both production hosts are HTTPS and a
 * silent `http://` destination would be a downgrade.
 */
export function originOf(value: string | null | undefined): string {
  // Read the scheme from the ORIGINAL string — `authorityOf` has stripped it by
  // the time we get an authority back.
  const raw = (value ?? "").split(",")[0]?.trim() ?? "";
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(raw);
  const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : "";
  const authority = authorityOf(raw);
  if (!authority) return "";
  if (scheme === "http") return `http://${authority}`;
  return `https://${authority}`;
}

/** Resolve both origins from their env values. Never throws, never guesses. */
export function resolveOrigins(input: HostOriginsInput): HostOrigins {
  return {
    frontend: originOf(input.frontendUrl),
    app: originOf(input.appUrl),
  };
}

/**
 * Split a comma-or-whitespace separated origin list into individual origins,
 * dropping empties and de-duplicating. Deploy env files habitually carry a list
 * in one variable (`TRUSTED_ORIGIN="https://a,https://b"`), and an origin list
 * that is not split is a single malformed entry that matches nothing — the
 * failure mode this function exists to prevent.
 *
 * A single value with no separator returns a one-element list, so an existing
 * single-origin deployment is byte-identical to today.
 */
export function parseOriginList(
  value: string | string[] | null | undefined,
): string[] {
  const raw = Array.isArray(value) ? value : [value ?? ""];
  const out: string[] = [];
  for (const entry of raw) {
    for (const part of entry.split(/[,\s]+/)) {
      const trimmed = part.trim();
      if (trimmed && !out.includes(trimmed)) out.push(trimmed);
    }
  }
  return out;
}











/** Everything `resolveHostRedirect` needs about one request. */
export interface HostRedirectInput {
  origins: HostOrigins;
  /** The host the request arrived on (`requestHost`). */
  host: string | null | undefined;
  pathname: string;
  /** A leading-`?` query string, or `""`. */
  search?: string;
  /** True when the request already carries a session. */
  hasSession: boolean;
}

/**
 * The ONE decision function: where must this request go because of the host
 * split, or `null` for "the caller's own rules apply".
 *
 * Returns an absolute URL when a rule moved the request to the other host, and a
 * path-only URL when the split is unconfigured (the caller resolves it against
 * its own request — the pre-split behaviour). Five rules, loop-free BY
 * CONSTRUCTION: rules 1–3 fire only WITHOUT a session and rules 4–5 only WITH
 * one, and every target takes the other branch.
 *
 *   1. no session + app host + /app/*   → front /login?next=<path>[?query]
 *   2. no session + app host + /login   → front /login (the canonical login)
 *   3. no session + app host + /        → front `/`
 *   4. session    + front host + /      → the app's default path on the app host
 *   5. session    + front host + /app/* → the app host, same path
 *
 * There is deliberately NO "signed in + /login → app" rule here. The edge cannot
 * tell a live session from a stale cookie, and a rule keyed on a cookie alone
 * turns an expired session into a redirect loop (login → app → the layout's real
 * session check → login …). The signed-in `/login` redirect lives in the login
 * PAGE, which checks the real session.
 */
export function resolveHostRedirect(input: HostRedirectInput): string | null {
  const { origins, host, pathname, hasSession } = input;
  const search = normalizeSearch(input.search ?? "");
  if (!isSplitConfigured(origins)) return null;

  const role = classifyHost(host, origins);
  const onApp = role === "app";
  const onFront = role === "frontend";
  if (!onApp && !onFront) return null; // an unknown host decides nothing

  if (!hasSession) {
    if (!onApp) return null;
    // 1. The app's protected surface belongs behind the canonical login, and the
    //    reader returns to the app host after authenticating.
    if (isAppPath(pathname)) return loginUrl(origins, `${pathname}${search}`);
    // 2. Login itself is canonical on the front host.
    if (pathname === LOGIN_PATH) return `${origins.frontend}${LOGIN_PATH}${search}`;
    // 3. The front host owns the marketing root.
    if (pathname === "/") return `${origins.frontend}/`;
    return null;
  }

  if (!onFront) return null;
  // 4. A signed-in reader on the front host's marketing root is moved into the app.
  if (pathname === "/") return appDestination(origins, DEFAULT_APP_PATH);
  // 5. The front host's copy of the app surface is forwarded to the app host, so
  //    the app has ONE canonical origin.
  if (isAppPath(pathname)) return `${origins.app}${pathname}${search}`;
  return null;
}

/**
 * The registrable host both origins share, so a session cookie set on the front
 * host is still sent to the app host. `""` means "not derivable".
 *
 * Only one shape is accepted: one host is a strict subdomain of the other, in
 * which case the parent IS the shared domain (`app.nexalog.com` under
 * `nexalog.com` → `nexalog.com`). Two unrelated hostnames are NOT guessed at —
 * a wrong cookie domain here would either be silently dropped by the browser or
 * hand the session to an unrelated site, so the caller must fall back to
 * host-only cookies (today's behaviour) instead of inventing a suffix.
 */
export function sharedCookieHost(
  frontend: string | null | undefined,
  app: string | null | undefined,
): string {
  const f = hostnameOf(frontend);
  const a = hostnameOf(app);
  if (!f || !a || f === a) return "";
  if (a.endsWith(`.${f}`)) return f;
  if (f.endsWith(`.${a}`)) return a;
  return "";
}

/**
 * The cookie `Domain` to use for the split, or `""` for host-only cookies.
 * An explicit override (`NEXALOG_COOKIE_DOMAIN`) wins, for a deployment whose
 * two hostnames are not in a parent/child relation.
 */
export function cookieDomain(
  origins: HostOrigins,
  override?: string | null,
): string {
  const explicit = hostnameOf(override);
  if (explicit) return explicit;
  return sharedCookieHost(origins.frontend, origins.app);
}

/**
 * True when the session cookie can actually be shared across both hosts — the
 * precondition for a login taken on one host to be recognized on the other.
 * Without it, moving the login form off the app host would authenticate the
 * reader and then bounce them straight back to a logged-out state.
 */
export function isCookieShared(
  origins: HostOrigins,
  override?: string | null,
): boolean {
  return isSplitConfigured(origins) && cookieDomain(origins, override) !== "";
}

/**
 * The bare login URL on the canonical front host, or the relative `/login`
 * when no split is configured.
 */
export function loginHref(origins: HostOrigins): string {
  return `${origins.frontend}${LOGIN_PATH}`;
}


/**
 * True when a real split is configured: both origins resolve AND they are
 * different hosts. A single-host deployment (`BETTER_AUTH_URL` at the apex, no
 * front-end URL) is NOT a split, and every helper below then returns a relative
 * path — the pre-existing behaviour.
 */
export function isSplitConfigured(origins: HostOrigins): boolean {
  return origins.frontend !== "" && origins.app !== "" && origins.frontend !== origins.app;
}

/**
 * Where a request's host sits in the split. `"other"` is a host we do not
 * recognize (a preview URL, an IP, a misconfigured proxy) — callers must treat
 * it as "decide nothing", never as the app.
 */
export type HostRole = "frontend" | "app" | "other";

export function classifyHost(host: string | null | undefined, origins: HostOrigins): HostRole {
  const h = hostnameOf(host);
  if (!h) return "other";
  if (origins.app && h === hostnameOf(origins.app)) return "app";
  if (origins.frontend && h === hostnameOf(origins.frontend)) return "frontend";
  return "other";
}

/**
 * Reduce an untrusted `next` value to a safe app-relative path.
 *
 * Returns `DEFAULT_APP_PATH` unless the value is a single-leading-slash path.
 * Rejects — deliberately, and as a rule rather than a blocklist — anything that
 * could be read as an origin or a protocol-relative URL: `//evil.com`,
 * `/\evil.com`, a backslash anywhere (browsers treat `\` as `/`), a scheme
 * prefix, and any control character or newline (which can split a header). The
 * query string and fragment are kept, because a real destination has them.
 */
export function sanitizeNext(next: string | null | undefined): string {
  if (typeof next !== "string") return DEFAULT_APP_PATH;
  const value = next.trim();
  if (!value.startsWith("/")) return DEFAULT_APP_PATH;
  if (value.startsWith("//")) return DEFAULT_APP_PATH;
  if (value.includes("\\")) return DEFAULT_APP_PATH;
  if (/[\u0000-\u001f\u007f]/.test(value)) return DEFAULT_APP_PATH;
  if (/^\/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return DEFAULT_APP_PATH;
  // A nested absolute URL in the query (`/x?u=https://evil.com`) is allowed as
  // DATA — it is a query value, not the destination. The destination's origin is
  // `origins.app` and the path starts `/`, so the value cannot move it. The one
  // form that can is a query opening a protocol-relative target (`?u=//evil`),
  // which this rejects outright rather than reasoning about per-renderer rules.
  const query = value.indexOf("?");
  if (query !== -1 && value.slice(query + 1).includes("//")) {
    if (/[?&][^=&#]*=\s*\/\//.test(value)) return DEFAULT_APP_PATH;
  }
  return value;
}

/**
 * The absolute destination a signed-in reader should be sent to: the APP
 * origin plus the sanitized path. Falls back to the relative path when the app
 * origin is unconfigured, so a single-host deployment and local development
 * keep working unchanged.
 */
export function appDestination(origins: HostOrigins, next: string | null | undefined): string {
  return `${origins.app}${sanitizeNext(next)}`;
}

/**
 * The post-login destination: the app origin plus the sanitized `next` value.
 *
 * This is the ONE place the login flow's destination is composed, so the rule is
 * tested rather than living inline in the form. The origin is supplied by the
 * SERVER (the page passes the configured app origin down), which is what makes
 * the destination the app host even though the form itself is served by the
 * front host — and it is what keeps the destination's origin out of the query
 * string's control. `appOrigin` of `""` (no split configured) yields the same
 * relative path the form pushed before the split existed.
 */
export function postLoginDestination(
  appOrigin: string | null | undefined,
  next: string | null | undefined,
): string {
  return `${originOf(appOrigin)}${sanitizeNext(next)}`;
}

/**
 * The canonical login URL for an intended app path. Served by the FRONT host;
 * when that is unconfigured the caller gets the same-host relative form the
 * repo already used. `next` is always sanitized to an app-relative path, so the
 * parameter can never carry an origin into the redirect.
 */
export function loginUrl(origins: HostOrigins, next: string | null | undefined): string {
  return `${origins.frontend}${LOGIN_PATH}?next=${encodeURIComponent(sanitizeNext(next))}`;
}


/** A leading-`?` query string, or `""`. Anything else is discarded. */
export function normalizeSearch(search: string | null | undefined): string {
  if (typeof search !== "string" || !search.startsWith("?")) return "";
  // A fragment never belongs in a request line's search string, and a `#` here
  // would be re-interpreted by the browser on the way back out.
  return search.split("#")[0] ?? "";
}

/**
 * The app-surface path prefix. `/app` itself is not a page (there is no
 * `app/(app)/app/page.tsx`), so the prefix is only ever matched with a
 * separator.
 */
export function isAppPath(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/");
}


/**
 * The host a request actually arrived on, from the headers a reverse proxy sets.
 *
 * `x-forwarded-host` wins over `host`, and `nextUrl.host` is deliberately NOT
 * used: behind the tunnel it resolves to the container's bind address
 * (`localhost:3300`), which would classify every request as `"other"` and
 * silently disable the whole split. Order matters — the first non-empty value
 * that normalizes to a hostname wins.
 */
export function requestHost(headers: {
  get(name: string): string | null;
}): string {
  return (
    hostnameOf(headers.get("x-forwarded-host")) ||
    hostnameOf(headers.get("host")) ||
    ""
  );
}
