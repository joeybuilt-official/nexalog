// SPDX-License-Identifier: MIT

/**
 * Configuration read from the environment — the ONE module allowed to read
 * `process.env` for app-wide settings, so call sites never do.
 *
 * Cloud-only features (Stripe billing, super-admin coupon management)
 * are disabled by default for self-hosters. Set BILLING_ENABLED=true
 * to opt back in. See README "Self-Hosting Notes".
 */
export function isBillingEnabled(): boolean {
  return process.env.BILLING_ENABLED === "true";
}

/** The model a request names when `LLM_MODEL` is unset. A model NAME, sent as-is. */
export const DEFAULT_LLM_MODEL = "auto";

/** Outbound ceiling for one embedded model call, in milliseconds. */
export const LLM_REQUEST_TIMEOUT_MS = 30_000;

/**
 * The embedded LLM endpoint's configuration, resolved ONCE from the
 * environment. Model identifiers are configuration, never literals at a call
 * site (`.agents/rules/ai-features.md`): a model upgrade is an env change, not
 * a code change.
 *
 *   LLM_BASE_URL  required — an OpenAI-compatible base URL, without `/v1`
 *                 (the embedded adapter appends `/chat/completions`).
 *   LLM_API_KEY   required — the bearer. Absent ⇒ `null`, and the surface that
 *                 wanted intelligence renders its un-enriched view rather than
 *                 hard-failing. This is the standalone default.
 *   LLM_MODEL     optional — the model name to request (default `auto`).
 *
 * `null` is a first-class answer, not an error: it is what makes "no model is
 * configured on this deployment" a state the app can state honestly instead of
 * a 500 it cannot explain.
 */
export type LlmConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export function llmConfig(
  env: Record<string, string | undefined> = process.env,
): LlmConfig | null {
  const baseUrl = env.LLM_BASE_URL?.trim().replace(/\/+$/, "");
  const apiKey = env.LLM_API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;
  return {
    baseUrl,
    apiKey,
    model: env.LLM_MODEL?.trim() || DEFAULT_LLM_MODEL,
  };
}
