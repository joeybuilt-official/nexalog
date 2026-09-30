// SPDX-License-Identifier: MIT
// Tests for the pure host-split layer. No React, no Next, no env: every input is
// a literal and every expectation is a literal, so a failure names the rule that
// broke rather than a rendering detail.
import { describe, it, expect } from "vitest";
import {
  DEFAULT_APP_PATH,
  appDestination,
  postLoginDestination,
  authorityOf,
  classifyHost,
  cookieDomain,
  hostnameOf,
  isAppPath,
  isCookieShared,
  isSplitConfigured,
  loginHref,
  loginUrl,
  normalizeSearch,
  originOf,
  parseOriginList,
  requestHost,
  resolveHostRedirect,
  resolveOrigins,
  sanitizeNext,
  sharedCookieHost,
  type HostOrigins,
} from "@/lib/hosts/split";
import { hostConfig, passkeyOrigins, trustedOriginsFromEnv } from "@/lib/hosts/config";

const FRONT = "https://nexalog.com";
const APP = "https://app.nexalog.com";
const ORIGINS: HostOrigins = { frontend: FRONT, app: APP };
/** The pre-split deployment: one host does everything. */
const SINGLE: HostOrigins = { frontend: "", app: APP };

const FRONT_HOST = "nexalog.com";
const APP_HOST = "app.nexalog.com";

/** Every host decision for one request, with the two loop-prone defaults filled. */
function decide(
  overrides: Partial<Parameters<typeof resolveHostRedirect>[0]> = {},
): string | null {
  return resolveHostRedirect({
    origins: ORIGINS,
    host: APP_HOST,
    pathname: "/app/today",
    search: "",
    hasSession: false,
    ...overrides,
  });
}

describe("authorityOf / hostnameOf / originOf", () => {
  it("accepts a full URL, a bare authority and a bare hostname", () => {
    for (const input of ["https://app.nexalog.com/", "app.nexalog.com:443", "app.nexalog.com"]) {
      expect(hostnameOf(input)).toBe("app.nexalog.com");
    }
  });

  it("lowercases and strips path, userinfo, query and fragment", () => {
    expect(hostnameOf("https://APP.Nexalog.com/app/today?a=1#x")).toBe("app.nexalog.com");
    expect(hostnameOf("https://user:pw@nexalog.com/")).toBe("nexalog.com");
  });

  it("keeps a real port in the authority but drops it from the hostname", () => {
    expect(authorityOf("http://localhost:3300")).toBe("localhost:3300");
    expect(hostnameOf("http://localhost:3300")).toBe("localhost");
  });

  it("keeps IPv6 brackets and strips a trailing port", () => {
    expect(hostnameOf("http://[::1]:3300")).toBe("[::1]");
  });

  it("takes the first entry of a comma-joined list", () => {
    expect(hostnameOf("https://a.example, https://b.example")).toBe("a.example");
  });

  it("preserves http for local development and defaults everything else to https", () => {
    expect(originOf("http://localhost:3300")).toBe("http://localhost:3300");
    expect(originOf("nexalog.com")).toBe("https://nexalog.com");
    expect(originOf("https://nexalog.com/")).toBe("https://nexalog.com");
  });

  it("returns an empty string for anything with no host", () => {
    for (const input of ["", "   ", null, undefined, "https://"]) {
      expect(hostnameOf(input)).toBe("");
      expect(originOf(input)).toBe("");
    }
  });
});

describe("resolveOrigins / isSplitConfigured", () => {
  it("resolves the deployed pair", () => {
    expect(resolveOrigins({ frontendUrl: FRONT, appUrl: APP })).toEqual(ORIGINS);
  });

  it("is configured only when BOTH hosts resolve and differ", () => {
    expect(isSplitConfigured(ORIGINS)).toBe(true);
    expect(isSplitConfigured(SINGLE)).toBe(false);
    expect(isSplitConfigured({ frontend: FRONT, app: "" })).toBe(false);
    expect(isSplitConfigured({ frontend: FRONT, app: FRONT })).toBe(false);
  });
});

describe("classifyHost", () => {
  it("names each side and refuses to guess at anything else", () => {
    expect(classifyHost("nexalog.com", ORIGINS)).toBe("frontend");
    expect(classifyHost("app.nexalog.com", ORIGINS)).toBe("app");
    expect(classifyHost("https://nexalog.com", ORIGINS)).toBe("frontend");
    expect(classifyHost("127.0.0.1:3300", ORIGINS)).toBe("other");
    expect(classifyHost("www.nexalog.com", ORIGINS)).toBe("other");
    expect(classifyHost("", ORIGINS)).toBe("other");
    expect(classifyHost(null, ORIGINS)).toBe("other");
  });
});

describe("sanitizeNext", () => {
  it("keeps a real app path, with its query and fragment", () => {
    expect(sanitizeNext("/app/today")).toBe("/app/today");
    expect(sanitizeNext("/app/projects?lifecycle=active#top")).toBe(
      "/app/projects?lifecycle=active#top",
    );
  });

  it("falls back to the default for an absent or non-path value", () => {
    for (const value of ["", null, undefined, "app/today", "https://evil.example", "javascript:alert(1)"]) {
      expect(sanitizeNext(value)).toBe(DEFAULT_APP_PATH);
    }
  });

  it("refuses protocol-relative and backslash forms", () => {
    for (const value of ["//evil.example", "/\\evil.example", "/a\\b", "/\\/evil.example"]) {
      expect(sanitizeNext(value)).toBe(DEFAULT_APP_PATH);
    }
  });

  it("refuses control characters and a header-splitting newline", () => {
    expect(sanitizeNext("/app/today\r\nLocation: https://evil.example")).toBe(DEFAULT_APP_PATH);
    expect(sanitizeNext("/app/\ttoday")).toBe(DEFAULT_APP_PATH);
  });

  it("refuses a path carrying its own scheme", () => {
    expect(sanitizeNext("/javascript:alert(1)")).toBe(DEFAULT_APP_PATH);
    expect(sanitizeNext("/https://evil.example")).toBe(DEFAULT_APP_PATH);
  });

  it("keeps a nested absolute URL as query DATA but refuses a protocol-relative one", () => {
    // A query value is data, not the destination — the origin is still ours.
    expect(sanitizeNext("/app/share?url=https://example.com/a")).toBe(
      "/app/share?url=https://example.com/a",
    );
    expect(sanitizeNext("/app/share?url=//evil.example")).toBe(DEFAULT_APP_PATH);
  });
});

describe("normalizeSearch", () => {
  it("keeps a leading-? query and drops a fragment", () => {
    expect(normalizeSearch("?a=1")).toBe("?a=1");
    expect(normalizeSearch("?a=1#frag")).toBe("?a=1");
  });

  it("discards anything that is not a query string", () => {
    for (const value of ["", null, undefined, "a=1", "#frag"]) {
      expect(normalizeSearch(value)).toBe("");
    }
  });
});

describe("appDestination", () => {
  it("resolves the path against the APP origin, never the login host", () => {
    expect(appDestination(ORIGINS, "/app/projects")).toBe("https://app.nexalog.com/app/projects");
  });

  it("defaults to the app's landing path", () => {
    expect(appDestination(ORIGINS, null)).toBe(`https://app.nexalog.com${DEFAULT_APP_PATH}`);
  });

  it("falls back to a relative path when the split is not configured", () => {
    // An absent APP origin is the only case that degrades to a relative path.
    // A single-host deployment still HAS an app origin (BETTER_AUTH_URL), so it
    // resolves absolutely — to that same host, which is what "app" means there.
    expect(appDestination({ frontend: "", app: "" }, "/app/today")).toBe("/app/today");
    expect(appDestination(SINGLE, "/app/today")).toBe("https://app.nexalog.com/app/today");
  });
});

describe("loginUrl / loginHref", () => {
  it("builds the canonical login on the FRONT host", () => {
    expect(loginUrl(ORIGINS, "/app/projects")).toBe(
      "https://nexalog.com/login?next=%2Fapp%2Fprojects",
    );
  });

  it("percent-encodes the destination so it cannot widen the origin", () => {
    expect(loginUrl(ORIGINS, "//evil.example")).toBe(
      `https://nexalog.com/login?next=${encodeURIComponent(DEFAULT_APP_PATH)}`,
    );
  });

  it("falls back to the same-host relative login when unconfigured", () => {
    expect(loginUrl(SINGLE, "/app/today")).toBe("/login?next=%2Fapp%2Ftoday");
    expect(loginHref(SINGLE)).toBe("/login");
    expect(loginHref(ORIGINS)).toBe("https://nexalog.com/login");
  });
});

describe("isAppPath", () => {
  it("recognises the app prefix only at a path boundary", () => {
    expect(isAppPath("/app")).toBe(true);
    expect(isAppPath("/app/today")).toBe(true);
    expect(isAppPath("/apple")).toBe(false);
    expect(isAppPath("/")).toBe(false);
  });
});

describe("resolveHostRedirect — rule 1: unauth app host /app/* → front login", () => {
  it("sends the app's protected surface to the canonical login and keeps the query", () => {
    expect(decide({ pathname: "/app/projects", search: "?lifecycle=active" })).toBe(
      `https://nexalog.com/login?next=${encodeURIComponent("/app/projects?lifecycle=active")}`,
    );
  });

  it("covers the app's nested surfaces, not just its root", () => {
    for (const pathname of ["/app", "/app/today", "/app/notes/abc", "/app/projects/abc/items"]) {
      expect(decide({ pathname })).toBe(
        `https://nexalog.com/login?next=${encodeURIComponent(pathname)}`,
      );
    }
  });

  it("leaves non-app surfaces to the caller's existing rules", () => {
    for (const pathname of ["/privacy", "/terms", "/inbox", "/apples"]) {
      expect(decide({ pathname })).toBeNull();
    }
  });

  it("decides nothing on an unknown host — never assumes the app", () => {
    expect(decide({ host: "127.0.0.1:3300" })).toBeNull();
    expect(decide({ host: "evil.example" })).toBeNull();
    expect(decide({ host: "" })).toBeNull();
    expect(decide({ host: null })).toBeNull();
  });
});

describe("resolveHostRedirect — an anonymous reader on the app host's login", () => {
  it("moves an anonymous login on the app host to the front host", () => {
    expect(decide({ pathname: "/login" })).toBe("https://nexalog.com/login");
  });

  it("preserves the `next` parameter across the host move", () => {
    expect(decide({ pathname: "/login", search: "?next=%2Fapp%2Fnotes" })).toBe(
      "https://nexalog.com/login?next=%2Fapp%2Fnotes",
    );
  });

  it("leaves the front host's own login alone", () => {
    expect(decide({ host: FRONT_HOST, pathname: "/login" })).toBeNull();
  });
});

describe("resolveHostRedirect — the app host's own root", () => {
  it("sends an anonymous app-host root to the marketing front", () => {
    expect(decide({ pathname: "/" })).toBe("https://nexalog.com/");
  });

  it("leaves a signed-in app-host root to the app itself", () => {
    expect(decide({ pathname: "/", hasSession: true })).toBeNull();
  });
});

describe("resolveHostRedirect — an anonymous reader on the app host's login", () => {
  it("moves it to the canonical login on the front host", () => {
    expect(decide({ pathname: "/login" })).toBe("https://nexalog.com/login");
  });

  it("preserves the `next` parameter across the host move", () => {
    expect(decide({ pathname: "/login", search: "?next=%2Fapp%2Fnotes" })).toBe(
      "https://nexalog.com/login?next=%2Fapp%2Fnotes",
    );
  });
});

describe("resolveHostRedirect — a signed-in reader on the FRONT host", () => {
  it("moves a signed-in reader off the marketing root into the app", () => {
    expect(decide({ host: FRONT_HOST, pathname: "/", hasSession: true })).toBe(
      `https://app.nexalog.com${DEFAULT_APP_PATH}`,
    );
  });

  it("forwards the front host's app copy to the app host, same path and query", () => {
    expect(decide({ host: FRONT_HOST, pathname: "/app/projects", hasSession: true, search: "?x=1" })).toBe(
      "https://app.nexalog.com/app/projects?x=1",
    );
  });

  it("leaves the front host's real content pages alone", () => {
    for (const pathname of ["/privacy", "/terms", "/cookie", "/refund", "/signup"]) {
      expect(decide({ host: FRONT_HOST, pathname, hasSession: true })).toBeNull();
    }
  });

  it("never moves an anonymous reader off the marketing root", () => {
    expect(decide({ host: FRONT_HOST, pathname: "/", hasSession: false })).toBeNull();
  });

  it("never touches the front host's login page — the page itself handles a live session", () => {
    // A rule here would loop on a stale cookie. See the module docstring.
    expect(decide({ host: FRONT_HOST, pathname: "/login", hasSession: true })).toBeNull();
    expect(decide({ host: FRONT_HOST, pathname: "/login", hasSession: false })).toBeNull();
  });
});

describe("resolveHostRedirect — the set is loop-free", () => {
  it("never returns a same-host same-path target that could re-trigger a rule", () => {
    // The two rules that fire WITHOUT a session both land the reader on the
    // FRONT host, where no anonymous rule fires; the signed-in rule always lands
    // on the APP host on a path that is not `/` or `/login`.
    const cases = [
      { pathname: "/app/today", host: APP_HOST, hasSession: false },
      { pathname: "/login", host: APP_HOST, hasSession: false },
      { pathname: "/", host: APP_HOST, hasSession: false },
      { pathname: "/", host: FRONT_HOST, hasSession: true },
      { pathname: "/login", host: FRONT_HOST, hasSession: true },
      { pathname: "/app/x", host: APP_HOST, hasSession: true },
    ];
    for (const c of cases) {
      const target = decide(c);
      if (!target) continue;
      const { hostname, pathname: destPath } = new URL(target);
      // Re-deciding the destination must produce nothing.
      expect(decide({ host: hostname, pathname: destPath, hasSession: c.hasSession })).toBeNull();
    }
  });
});

describe("resolveHostRedirect — unconfigured split", () => {
  it("decides nothing at all, on any host and path", () => {
    for (const host of [FRONT_HOST, APP_HOST, "other.example"]) {
      for (const pathname of ["/", "/login", "/app/today", "/privacy"]) {
        for (const hasSession of [true, false]) {
          expect(resolveHostRedirect({ origins: SINGLE, host, pathname, hasSession })).toBeNull();
        }
      }
    }
  });
});

describe("requestHost", () => {
  // `Headers.get` is case-insensitive; the stub must be too, or the test would
  // only prove the stub's own casing rule.
  const headers = (map: Record<string, string>) => {
    const lowered = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
    return { get: (name: string) => lowered[name.toLowerCase()] ?? null };
  };

  it("prefers x-forwarded-host over host, in either header casing", () => {
    expect(requestHost(headers({ "x-forwarded-host": "nexalog.com", host: "127.0.0.1:3300" }))).toBe(
      "nexalog.com",
    );
    expect(requestHost(headers({ "X-Forwarded-Host": "app.nexalog.com" }))).toBe("app.nexalog.com");
  });

  it("falls back to host, and to empty when neither is present", () => {
    expect(requestHost(headers({ host: "nexalog.com" }))).toBe("nexalog.com");
    expect(requestHost(headers({}))).toBe("");
  });

  it("normalizes the proxy value to the same hostname classifyHost compares", () => {
    expect(requestHost(headers({ "x-forwarded-host": "Nexalog.com:443" }))).toBe("nexalog.com");
  });
});

describe("parseOriginList", () => {
  it("splits a comma-joined list and de-duplicates, preserving order", () => {
    expect(parseOriginList("https://a.example, https://b.example,https://a.example")).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("returns a single-entry list for a single value, so today's config is unchanged", () => {
    expect(parseOriginList("https://app.nexalog.com")).toEqual(["https://app.nexalog.com"]);
  });

  it("accepts whitespace-separated and array input, and drops empties", () => {
    expect(parseOriginList("https://a.example https://b.example")).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
    expect(parseOriginList(["https://a.example", "  ", ""])).toEqual(["https://a.example"]);
    expect(parseOriginList(null)).toEqual([]);
    expect(parseOriginList(undefined)).toEqual([]);
  });
});

describe("sharedCookieHost / cookieDomain", () => {
  it("derives the parent host when one host is a subdomain of the other", () => {
    expect(sharedCookieHost(FRONT, APP)).toBe("nexalog.com");
    expect(sharedCookieHost(APP, FRONT)).toBe("nexalog.com");
    expect(sharedCookieHost("nexalog.com", "www.nexalog.com")).toBe("nexalog.com");
  });

  it("refuses to guess when the two hosts are unrelated", () => {
    expect(sharedCookieHost("nexalog.com", "nexalog.example")).toBe("");
    expect(sharedCookieHost("a.example.com", "b.example.net")).toBe("");
    expect(sharedCookieHost("nexalog.com", "nexalog.com")).toBe("");
    expect(sharedCookieHost("", APP)).toBe("");
  });

  it("honours an explicit override over the derivation", () => {
    expect(cookieDomain(ORIGINS, ".nexalog.com")).toBe("nexalog.com");
    expect(cookieDomain({ frontend: "a.example.com", app: "b.example.net" }, "example.com")).toBe(
      "example.com",
    );
  });

  it("reports whether the session cookie can actually be shared", () => {
    expect(isCookieShared(ORIGINS)).toBe(true);
    expect(isCookieShared(SINGLE)).toBe(false);
    expect(isCookieShared({ frontend: "nexalog.com", app: "nexalog.example" })).toBe(false);
    expect(isCookieShared({ frontend: "nexalog.com", app: "nexalog.example" }, "nexalog.com")).toBe(
      true,
    );
  });
});

describe("hostConfig", () => {
  it("reads the deployed env shape and reports a shared cookie", () => {
    const config = hostConfig({
      NEXALOG_FRONTEND_URL: FRONT,
      BETTER_AUTH_URL: APP,
    });
    expect(config.frontend).toBe(FRONT);
    expect(config.app).toBe(APP);
    expect(config.split).toBe(true);
    expect(config.cookieDomain).toBe("nexalog.com");
    expect(config.cookieShared).toBe(true);
  });

  it("degrades to no-split when the front-end URL is absent (today's deployment)", () => {
    const config = hostConfig({ BETTER_AUTH_URL: APP });
    expect(config.frontend).toBe("");
    expect(config.split).toBe(false);
    expect(config.cookieDomain).toBe("");
    expect(config.cookieShared).toBe(false);
  });

  it("lets an explicit NEXALOG_APP_URL win over BETTER_AUTH_URL", () => {
    const config = hostConfig({
      NEXALOG_FRONTEND_URL: FRONT,
      BETTER_AUTH_URL: APP,
      NEXALOG_APP_URL: "https://app2.nexalog.com",
    });
    expect(config.app).toBe("https://app2.nexalog.com");
  });
});

describe("trustedOriginsFromEnv", () => {
  it("produces a FLAT list from a comma-joined TRUSTED_ORIGIN", () => {
    const origins = trustedOriginsFromEnv({
      NEXALOG_FRONTEND_URL: FRONT,
      BETTER_AUTH_URL: APP,
      TRUSTED_ORIGIN: `${APP}, ${FRONT}`,
    });
    expect(origins).toEqual([APP, FRONT]);
  });

  it("is byte-identical to today when only the app origin is configured", () => {
    expect(trustedOriginsFromEnv({ BETTER_AUTH_URL: APP, TRUSTED_ORIGIN: APP })).toEqual([APP]);
  });

  it("keeps an unrelated third origin, and never emits an empty or duplicate entry", () => {
    const origins = trustedOriginsFromEnv({
      NEXALOG_FRONTEND_URL: FRONT,
      BETTER_AUTH_URL: APP,
      TRUSTED_ORIGIN: " https://other.example ,, ",
    });
    expect(origins).toEqual([APP, "https://other.example", FRONT]);
    expect(origins).not.toContain("");
  });

  it("returns an empty list when nothing is configured", () => {
    expect(trustedOriginsFromEnv({})).toEqual([]);
  });
});

describe("passkeyOrigins", () => {
  it("returns both configured hosts once the split is on", () => {
    expect(
      passkeyOrigins({
        NEXALOG_FRONTEND_URL: FRONT,
        BETTER_AUTH_URL: APP,
        NEXT_PUBLIC_RP_ID: "nexalog.com",
      }),
    ).toEqual([APP, FRONT]);
  });

  it("returns ONE origin for a single-host deployment — the pre-split value", () => {
    expect(passkeyOrigins({ BETTER_AUTH_URL: APP })).toEqual([APP]);
  });

  it("falls back to NEXT_PUBLIC_APP_URL when BETTER_AUTH_URL is unset", () => {
    expect(passkeyOrigins({ NEXT_PUBLIC_APP_URL: APP })).toEqual([APP]);
  });

  it("never emits a value without a scheme, and never duplicates one", () => {
    const origins = passkeyOrigins({
      NEXALOG_FRONTEND_URL: FRONT,
      BETTER_AUTH_URL: APP,
      NEXT_PUBLIC_APP_URL: APP,
    });
    expect(origins).toEqual([APP, FRONT]);
    for (const origin of origins) expect(origin.startsWith("http")).toBe(true);
  });

  it("keeps a localhost default so a bare dev box still verifies something", () => {
    expect(passkeyOrigins({})).toEqual(["http://localhost:3000"]);
  });
});

describe("postLoginDestination — where a successful login lands", () => {
  it("resolves an app-relative `next` against the APP host", () => {
    expect(postLoginDestination(APP, "/app/notes")).toBe("https://app.nexalog.com/app/notes");
  });

  it("falls back to the default app path when `next` is absent", () => {
    expect(postLoginDestination(APP, null)).toBe(`https://app.nexalog.com${DEFAULT_APP_PATH}`);
  });

  it("keeps the default path RELATIVE with no split configured — the pre-split behaviour", () => {
    expect(postLoginDestination("", null)).toBe(DEFAULT_APP_PATH);
    expect(postLoginDestination(undefined, null)).toBe(DEFAULT_APP_PATH);
  });

  it("never lets the query string choose the origin", () => {
    // A hostile `next` collapses to the default path, and the origin is still
    // the one the SERVER supplied — an open redirect is impossible by shape.
    for (const hostile of ["//evil.com", "https://evil.com", "\\evil.com", "/\\evil.com"]) {
      expect(postLoginDestination(APP, hostile)).toBe(
        `https://app.nexalog.com${DEFAULT_APP_PATH}`,
      );
    }
  });

  it("keeps a query string on a legitimate destination", () => {
    expect(postLoginDestination(APP, "/app/search?q=hello")).toBe(
      "https://app.nexalog.com/app/search?q=hello",
    );
  });

  it("normalizes a scheme-less or trailing-slash app origin", () => {
    expect(postLoginDestination("app.nexalog.com/", "/app/today")).toBe(
      "https://app.nexalog.com/app/today",
    );
  });

  it("preserves an http origin so local development still works", () => {
    expect(postLoginDestination("http://localhost:3300", "/app/today")).toBe(
      "http://localhost:3300/app/today",
    );
  });
});
