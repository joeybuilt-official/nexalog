---
id: frontend-host-split
title: Front-end host split — nexalog.com serves the landing + login, app.nexalog.com serves the app
status: in-progress
area: platform
order: 4
risk: operator-confirm
---

The operator's directive: **the front-end site should be nexalog.com (including the login page); then
login takes the user to app.nexalog.com.** Both hostnames already serve the SAME deployment (one
container, one Cloudflare tunnel), so this is a routing + auth-cookie change, not a second app.

**What shipped in this change.** A pure decision module (`apps/web/lib/hosts/split.ts`, 60 unit tests)
plus its single env-reading composition root (`apps/web/lib/hosts/config.ts`), the middleware adapter
that executes its answer, a login page that verifies a session instead of only observing a cookie, and
one real defect fixed in `lib/auth.ts` (below). Five host rules, listed in the module docstring.

**The auth half is the part that could have locked the operator out, and it was probed live rather
than reasoned about:**

- `POST https://nexalog.com/api/auth/sign-in/email` with `Origin: https://nexalog.com` currently
  answers **403 `INVALID_ORIGIN`** — nexalog.com is not in `trustedOrigins` at all. So the login page
  moving to nexalog.com is not a cosmetic move; the origin list had to change with it.
- `TRUSTED_ORIGIN` was consumed as ONE ARRAY ENTRY, so `"https://app.nexalog.com,https://nexalog.com"`
  would have become a single malformed origin that matches nothing. `trustedOriginsFromEnv` now
  **splits it on commas/whitespace** and flattens, keeping the app origin first so a deployment that
  sets only `BETTER_AUTH_URL` produces the byte-identical single-origin list it has today.
- **The deployed cookies are host-only** (no `Domain` attribute), so a session taken on
  app.nexalog.com is not sent to nexalog.com. `advanced.crossSubDomainCookies` is now set with
  `domain: nexalog.com`, derived from the two configured hosts by `sharedCookieHost` — and only when
  a strict parent/child relation actually holds. No override, no guessed suffix.
- **The real lockout was found by probing, not by reading:** better-auth serves **no CORS headers at
  all** (`OPTIONS /api/auth/sign-in/email` from `Origin: https://nexalog.com` returns 204 with no
  `Access-Control-Allow-Origin`), while `lib/auth/client.ts` pointed the browser client at
  `NEXT_PUBLIC_APP_URL=https://app.nexalog.com`. A login form served on nexalog.com would therefore
  have been browser-blocked outright. The client now posts to the host that served the page
  (`baseURL: process.env.NEXT_PUBLIC_AUTH_URL ?? ""` → better-auth resolves `window.location.origin`),
  so a front-host login is same-origin and needs no CORS surface. Nothing else in the client changed.

**Rule 4 is deliberately NOT in the middleware.** "Signed in + /login → app" cannot live at the edge:
the edge cannot distinguish a live session from a stale cookie, and a rule keyed on a cookie alone
turns an expired session into a loop (login → app → the layout's real session check → login …). It
lives in `app/(auth)/login/page.tsx`, which calls `getAuthUser()`. The two rules that DO live at the
edge fire only on the app host without a session, and each target takes the other branch — the
loop-freedom is asserted directly in the test file.

**What is NOT verified, and needs the operator before this can be trusted:**

1. **No end-to-end login was executed.** There are no credentials here and the auth DB is the shared
   production one, so the cookie round trip is DESIGNED against better-auth 1.6.9's own source
   (`createCookieGetter` reads `advanced.crossSubDomainCookies.domain` into the cookie `Domain`;
   `deleteSessionCookie` deletes by name at whatever scope the request sets, so sign-out still clears)
   but not run. **The one-line check for the operator:** log in on nexalog.com, then load
   app.nexalog.com/app/today — if it renders, the cookie scope and the trusted origin are both right.
2. **The app-host login page does not yet redirect off-host for an anonymous reader on its own.**
   Middleware rule 2 covers page navigations; a client-side `router.replace("/login")` from the app
   host is not covered by the middleware's matcher, and with `/login` on the matcher the signed-in
   `/login` rule would risk the loop above. Left as-is deliberately; the front host is what the
   operator and every entry point send readers to.
3. **The passkey RP is unaffected (RP ID is already `nexalog.com`, the registrable domain, and the
   ceremony is same-origin per host) but `expectedOrigin` is still `BETTER_AUTH_URL` only.** A passkey
   login taken on nexalog.com will therefore fail origin verification until `expectedOrigin` accepts
   both hosts. Not changed here (no ceremony to test against); named as a follow-up.

**Deploy-time env — required, names and shapes only, no secret values:**

| Variable | Value it needs | Why |
|---|---|---|
| `NEXALOG_FRONTEND_URL` | `https://nexalog.com` | **New.** Turns the split on. Without it everything degrades to today's single-host behaviour. |
| `BETTER_AUTH_URL` | `https://app.nexalog.com` | Unchanged — already the app origin. |
| `TRUSTED_ORIGIN` | `https://app.nexalog.com,https://nexalog.com` | The list is now SPLIT. It also works left as a single value. |
| `NEXT_PUBLIC_APP_URL` | *(no longer used by the auth client)* | Left in place; harmless. `NEXT_PUBLIC_AUTH_URL` overrides the client baseURL if a deployment ever needs one. |

**Next step:** the operator applies the env above on the next deploy, logs in at nexalog.com, and
confirms `app.nexalog.com/app/today` renders signed in. Then: (a) the passkey `expectedOrigin` array,
(b) decide whether `/login` belongs on the middleware matcher at all.
