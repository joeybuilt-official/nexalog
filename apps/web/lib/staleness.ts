// SPDX-License-Identifier: MIT
/**
 * Staleness scoring for the smart-archive cron (Phase 11 — Hotel).
 *
 * Per VISION §4 #2 + AUDIT-FOLLOWUPS smart-archive bullet, every saved
 * link gets a 0..1 staleness score from the cheap nightly pass:
 *   - 404 / dead link        +0.6
 *   - redirect lands on host /  +0.4
 *   - content drift           +0.2
 *   - 60+ days unread        +0.3
 * Score >=0.7 → archive candidate, batched into a single
 * `bookmark.stale_batch` Synthesis Inbox card.
 *
 * Weekly LLM gate runs a different scorer on rows in the 0.4..0.7 band
 * — see `llmStillCurrent`.
 */

export interface StalenessSignal {
  delta: number;
  reason: string;
}

export interface StalenessRow {
  url: string;
  ogTitle: string | null;
  createdAt: Date;
  lastOpenedAt: Date | null;
}

export interface StalenessResult {
  score: number;
  reason: string | null;
  httpStatus: number | null;
}

const HEAD_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * HEAD request with a small redirect chain. Returns final status code
 * and the URL we landed on (for redirect-home detection). Network /
 * timeout failures count as 0 so they get treated as 'dead_link' below.
 */
async function headWithRedirects(
  url: string,
  retries = 3
): Promise<{ status: number; finalUrl: string }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
        // Most servers tolerate a HEAD with a UA; some 403 anonymous HEAD.
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; NexalogStaleBot/1.0; +https://nexalog.com)",
        },
      });
      return { status: res.status, finalUrl: res.url || url };
    } catch (err) {
      lastErr = err;
      // Retry on network/timeout; brief pause between attempts.
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  void lastErr;
  return { status: 0, finalUrl: url };
}

function isHomepageOf(originalUrl: string, finalUrl: string): boolean {
  try {
    const orig = new URL(originalUrl);
    const fin = new URL(finalUrl);
    if (orig.hostname.replace(/^www\./, "") !== fin.hostname.replace(/^www\./, "")) {
      return false;
    }
    // Original wasn't already the homepage, but the final landed on it.
    const origPath = orig.pathname.replace(/\/$/, "");
    const finPath = fin.pathname.replace(/\/$/, "");
    return origPath !== "" && finPath === "";
  } catch {
    return false;
  }
}

/**
 * Cheap drift signal — if we can grab the page title via a small range
 * fetch, see whether any non-trivial word from og_title still appears.
 * This is best-effort; failure adds no signal.
 */
async function contentDriftDelta(url: string, ogTitle: string | null): Promise<StalenessSignal | null> {
  if (!ogTitle) return null;
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
      headers: {
        Range: "bytes=0-16384",
        "User-Agent":
          "Mozilla/5.0 (compatible; NexalogStaleBot/1.0; +https://nexalog.com)",
      },
    });
    if (!res.ok && res.status !== 206) return null;
    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>([\s\S]{0,400}?)<\/title>/i);
    const currentTitle = (titleMatch?.[1] ?? "").trim().toLowerCase();
    if (!currentTitle) return null;
    const tokens = ogTitle
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4);
    if (tokens.length === 0) return null;
    const overlap = tokens.some((t) => currentTitle.includes(t));
    if (!overlap) return { delta: 0.2, reason: "content_drift" };
  } catch {
    return null;
  }
  return null;
}

/**
 * Score one row. Pure function over signals — caller owns persistence
 * and rate-limiting. `now` is a parameter so tests / scripts can pin time.
 */
export async function scoreRow(
  row: StalenessRow,
  now: Date = new Date()
): Promise<StalenessResult> {
  const signals: StalenessSignal[] = [];

  const head = await headWithRedirects(row.url, MAX_REDIRECTS);
  const status = head.status;

  if (status === 0 || status === 404 || status === 410) {
    signals.push({ delta: 0.6, reason: "dead_link" });
  } else if (status >= 200 && status < 400) {
    if (isHomepageOf(row.url, head.finalUrl)) {
      signals.push({ delta: 0.4, reason: "redirect_home" });
    }
    const drift = await contentDriftDelta(row.url, row.ogTitle);
    if (drift) signals.push(drift);
  }

  const opened = row.lastOpenedAt;
  const ageMs = now.getTime() - row.createdAt.getTime();
  if (!opened && ageMs > SIXTY_DAYS_MS) {
    signals.push({ delta: 0.3, reason: "unread_60d" });
  }

  const total = signals.reduce((s, x) => s + x.delta, 0);
  // Reason picks the heaviest signal contributing to the score.
  const dominant = signals.sort((a, b) => b.delta - a.delta)[0]?.reason ?? null;

  return {
    score: clamp01(total),
    reason: dominant,
    httpStatus: status === 0 ? null : status,
  };
}

/**
 * Weekly LLM gate. Asks Plexo (Haiku) whether a saved item is still
 * worth recommending. Caller is responsible for the per-workspace cap
 * (200 calls/wk per the brief). Returns null on failure — caller treats
 * null as "no signal."
 */
export async function llmStillCurrent(
  args: { url: string; ogTitle: string | null; topic: string | null; createdAt: Date },
  opts: { plexoUrl: string; serviceKey: string; userId: string; plexoWorkspaceId: string }
): Promise<{ current: boolean; why: string } | null> {
  const ageDays = Math.max(0, Math.round((Date.now() - args.createdAt.getTime()) / (24 * 60 * 60 * 1000)));
  const ageStr = ageDays >= 30 ? `${Math.round(ageDays / 30)} months ago` : `${ageDays} days ago`;
  const prompt = `Saved ${ageStr}. Title: "${args.ogTitle ?? "(untitled)"}". URL: ${args.url}. Topic: ${args.topic ?? "(unknown)"}.
Question: would a knowledgeable reader in 2026 still recommend this?
Output JSON: {"current": true|false, "why": "..."}`;

  try {
    const res = await fetch(`${opts.plexoUrl}/api/v1/ai/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.serviceKey}`,
        "X-App-Id": "nexalog",
        "X-User-Id": opts.userId,
      },
      body: JSON.stringify({
        workspaceId: opts.plexoWorkspaceId,
        messages: [{ role: "user", content: prompt }],
        maxTokens: 96,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { text?: string };
    const m = (data.text ?? "").match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]) as { current?: boolean; why?: string };
    if (typeof parsed.current !== "boolean") return null;
    return { current: parsed.current, why: String(parsed.why ?? "").slice(0, 240) };
  } catch {
    return null;
  }
}
