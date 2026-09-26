// SPDX-License-Identifier: MIT
/**
 * URL classifier for content-type hoppers (Phase 11 — Hotel).
 *
 * Routes saved links into one of:
 *   video | article | reference | social | other
 *
 * Strategy: hostname/path heuristic first (no network, no LLM); LLM
 * fallback only when the heuristic returns `other` and we have OG text
 * worth feeding to a model. The fallback is gated by the caller — see
 * `classifyUrlWithLlm`.
 *
 * Cache result on the row itself (`kind_classified`, `classified_at`).
 * Re-classify when og_title changes.
 */

export type ContentKind = "video" | "article" | "reference" | "social" | "other";

export interface ClassifyInput {
  url: string;
  ogTitle?: string | null;
  ogDescription?: string | null;
  ogType?: string | null;
}

export interface ClassifyResult {
  kind: ContentKind;
  confidence: number;
}

const VIDEO_HOSTS = /^(www\.|m\.)?(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|loom\.com|wistia\.com|twitch\.tv)$/i;
const SOCIAL_HOSTS = /^(www\.)?(twitter\.com|x\.com|instagram\.com|facebook\.com|threads\.net|linkedin\.com|reddit\.com|t\.me|telegram\.org|bsky\.app)$|^mastodon\..+$/i;
const REFERENCE_HOSTS = /^(www\.)?(github\.com|stackoverflow\.com|developer\.mozilla\.org|wikipedia\.org|developer\.apple\.com|learn\.microsoft\.com|cloud\.google\.com)$|.+\.readthedocs\.io$|^docs\..+$|^wiki\..+$/i;
const ARTICLE_HOSTS = /^(www\.)?(medium\.com|substack\.com|nytimes\.com|theverge\.com|techcrunch\.com|arstechnica\.com|wired\.com|theatlantic\.com|newyorker\.com|bloomberg\.com|reuters\.com|wsj\.com|economist\.com)$|.+\.substack\.com$|.+blog\..+|^blog\..+|.+\.blog$|.+\.news$/i;

const ARTICLE_PATH = /(^|\/)(blog|article|articles|post|posts|p|story|stories|news)(\/|$)|\/[0-9]{4}\/[0-9]{2}\//i;

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

/**
 * Fast heuristic — no network, no LLM. Returns `other` with confidence 0
 * when nothing matches; the caller can choose to invoke the LLM fallback.
 */
export function classifyUrl(input: ClassifyInput): ClassifyResult {
  const host = safeHostname(input.url);
  if (!host) return { kind: "other", confidence: 0 };

  if (VIDEO_HOSTS.test(host)) return { kind: "video", confidence: 0.95 };
  if (SOCIAL_HOSTS.test(host)) return { kind: "social", confidence: 0.95 };
  if (REFERENCE_HOSTS.test(host)) return { kind: "reference", confidence: 0.95 };

  if ((input.ogType ?? "").toLowerCase() === "article") {
    return { kind: "article", confidence: 0.7 };
  }

  if (ARTICLE_HOSTS.test(host)) return { kind: "article", confidence: 0.95 };

  const path = safePath(input.url);
  if (ARTICLE_PATH.test(path)) return { kind: "article", confidence: 0.7 };

  return { kind: "other", confidence: 0 };
}

/**
 * LLM fallback. Caller must guard on `classifyUrl(input).kind === "other"`
 * AND non-empty title/description before paying for tokens. Cap cost
 * upstream; this function does a single Plexo `/ai/complete` call.
 */
export async function classifyUrlWithLlm(
  input: ClassifyInput,
  opts: { plexoUrl: string; serviceKey: string; userId: string; plexoWorkspaceId: string }
): Promise<ClassifyResult> {
  const fast = classifyUrl(input);
  if (fast.kind !== "other") return fast;

  const title = (input.ogTitle ?? "").trim();
  const desc = (input.ogDescription ?? "").trim();
  if (!title && !desc) return fast;

  const prompt = `Classify this saved link into ONE of: video | article | reference | social | other.
Output JSON only: {"kind": "...", "confidence": 0..1}.
Title: ${title}
Description: ${desc.slice(0, 400)}
URL: ${input.url}`;

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
        maxTokens: 64,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return fast;
    const data = (await res.json()) as { text?: string };
    const text = (data.text ?? "").trim();
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return fast;
    const parsed = JSON.parse(m[0]) as { kind?: string; confidence?: number };
    const kind = (parsed.kind ?? "other").toLowerCase() as ContentKind;
    if (!["video", "article", "reference", "social", "other"].includes(kind)) return fast;
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5));
    return { kind, confidence };
  } catch {
    return fast;
  }
}
