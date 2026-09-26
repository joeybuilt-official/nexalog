// SPDX-License-Identifier: MIT
/**
 * Auth-gated image proxy. Streams an external og/favicon image back from
 * the same origin so thumbnails that the browser refuses to embed
 * directly (Cross-Origin-Resource-Policy, referrer/hotlink blocks) still
 * render. Used as an on-error fallback by the bookmark cards — the fast
 * path still loads images directly.
 *
 * SSRF posture: requires a session, allows only http(s), and rejects
 * private/link-local IP literals and dotless/internal hostnames (so the
 * proxy can't be aimed at docker-internal services like postgres).
 * Residual DNS-rebinding risk is accepted at personal scale behind auth.
 */
import { getAuthUser } from "@/lib/auth/server";

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 8000;

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local") || h.endsWith(".internal")) return true;
  // Dotless hostnames are docker-internal service names (postgres, …).
  if (!h.includes(".") && !h.includes(":")) return true;

  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a >= 224) return true;
  }
  // IPv6 loopback / link-local / unique-local.
  if (h === "::1") return true;
  if (h.startsWith("fe80") || h.startsWith("fc") || h.startsWith("fd")) return true;
  return false;
}

export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const target = new URL(request.url).searchParams.get("url");
  if (!target) return new Response("missing url", { status: 400 });

  let u: URL;
  try {
    u = new URL(target);
  } catch {
    return new Response("bad url", { status: 400 });
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return new Response("bad scheme", { status: 400 });
  }
  if (isBlockedHost(u.hostname)) return new Response("blocked host", { status: 400 });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch(u.toString(), {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NexalogBot/1.0; +https://nexalog.com)",
        Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
      },
    });
  } catch {
    clearTimeout(timer);
    return new Response("fetch failed", { status: 502 });
  }
  clearTimeout(timer);

  const ct = upstream.headers.get("content-type") ?? "";
  if (!upstream.ok || !ct.startsWith("image/")) {
    return new Response("not an image", { status: 502 });
  }
  const declared = Number(upstream.headers.get("content-length") ?? "0");
  if (declared && declared > MAX_BYTES) return new Response("too large", { status: 413 });

  const buf = await upstream.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return new Response("too large", { status: 413 });

  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": ct,
      "Cache-Control": "public, max-age=86400, s-maxage=604800",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
