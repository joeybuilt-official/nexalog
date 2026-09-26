// SPDX-License-Identifier: MIT
//
// Supadata client — Phase 1 video transcription source (YouTube).
//
// ADR-0007 deviation: direct Supadata key here. ADR-0006 (Jex contract
// extensions) names a future Plexo `transcription` verb as the eventual home;
// when that ships, replace `fetchSupadataTranscript` with `plexoTranscribe`
// and delete SUPADATA_API_KEY from prod. Supadata itself is a content-source
// (caption fetcher with ASR fallback), not an LLM — same shape as fetching
// HTML for Readability — so it doesn't violate the no-hardwired-provider rule
// that applies to inference.

const SUPADATA_BASE_URL = (
  process.env.SUPADATA_BASE_URL || "https://api.supadata.ai"
).replace(/\/$/, "");
const SUPADATA_API_KEY = process.env.SUPADATA_API_KEY ?? "";
const DEFAULT_TIMEOUT_MS = 20_000;

export interface SupadataTranscript {
  ok: true;
  text: string;
  language: string | null;
  source: "supadata-captions" | "supadata-asr";
  durationSeconds: number | null;
  requestId: string | null;
  creditsRemaining: number | null;
}

export interface SupadataFail {
  ok: false;
  reason: string;
  retryable: boolean;
  status: number | null;
}

export type SupadataResult = SupadataTranscript | SupadataFail;

export function supadataConfigured(): boolean {
  return !!SUPADATA_API_KEY;
}

export interface FetchOpts {
  lang?: string;
  /** Allow Supadata's AI/ASR fallback when no native captions exist.
   *  Defaults to true (env-controllable via TRANSCRIPT_ALLOW_ASR). */
  allowAsr?: boolean;
  signal?: AbortSignal;
}

interface SupadataRawResponse {
  content?: string;
  text?: string;
  lang?: string;
  language?: string;
  availableLangs?: string[];
  source?: string;
  durationSeconds?: number;
  duration?: number;
  requestId?: string;
}

const ASR_DEFAULT = (process.env.TRANSCRIPT_ALLOW_ASR ?? "true").toLowerCase() !== "false";

export async function fetchSupadataTranscript(
  videoId: string,
  opts: FetchOpts = {},
): Promise<SupadataResult> {
  if (!SUPADATA_API_KEY) {
    return { ok: false, reason: "supadata-not-configured", retryable: false, status: null };
  }
  if (!videoId) {
    return { ok: false, reason: "missing-video-id", retryable: false, status: null };
  }

  const lang = opts.lang ?? "en";
  const allowAsr = opts.allowAsr ?? ASR_DEFAULT;
  // Supadata's YouTube endpoint: `text=true` flattens segments to plain text;
  // `mode=auto` enables the ASR fallback when no native captions exist.
  const url = new URL(`${SUPADATA_BASE_URL}/v1/youtube/transcript`);
  url.searchParams.set("videoId", videoId);
  url.searchParams.set("text", "true");
  url.searchParams.set("lang", lang);
  if (allowAsr) url.searchParams.set("mode", "auto");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const signal = opts.signal
    ? anySignal(opts.signal, controller.signal)
    : controller.signal;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        "x-api-key": SUPADATA_API_KEY,
        "Accept": "application/json",
      },
      signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const message = (err as Error)?.name === "AbortError" ? "timeout" : (err as Error)?.message ?? "network-error";
    return { ok: false, reason: message, retryable: true, status: null };
  }
  clearTimeout(timer);

  const requestId = res.headers.get("x-request-id");
  const creditsRemaining = Number(res.headers.get("x-credits-remaining") || "");

  if (res.status === 429 || res.status >= 500) {
    return {
      ok: false,
      reason: `supadata-${res.status}`,
      retryable: true,
      status: res.status,
    };
  }
  if (!res.ok) {
    // 4xx (404 no-captions, 402 out-of-credits, 400 bad video). Terminal.
    let body = "";
    try {
      body = (await res.text()).slice(0, 240);
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      reason: `supadata-${res.status}: ${body || "client-error"}`,
      retryable: false,
      status: res.status,
    };
  }

  let payload: SupadataRawResponse;
  try {
    payload = (await res.json()) as SupadataRawResponse;
  } catch {
    return { ok: false, reason: "supadata-json-parse", retryable: true, status: res.status };
  }

  const text = (payload.content ?? payload.text ?? "").trim();
  if (!text) {
    return { ok: false, reason: "empty-transcript", retryable: false, status: res.status };
  }
  const language = payload.language ?? payload.lang ?? null;
  const source: SupadataTranscript["source"] =
    (payload.source ?? "").toLowerCase().includes("asr") ? "supadata-asr" : "supadata-captions";
  const durationSeconds =
    Number.isFinite(payload.durationSeconds) ? Number(payload.durationSeconds) :
    Number.isFinite(payload.duration) ? Number(payload.duration) : null;

  return {
    ok: true,
    text,
    language,
    source,
    durationSeconds,
    requestId,
    creditsRemaining: Number.isFinite(creditsRemaining) ? creditsRemaining : null,
  };
}

function anySignal(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a;
  if (b.aborted) return b;
  const c = new AbortController();
  const onA = () => c.abort(a.reason);
  const onB = () => c.abort(b.reason);
  a.addEventListener("abort", onA, { once: true });
  b.addEventListener("abort", onB, { once: true });
  return c.signal;
}
