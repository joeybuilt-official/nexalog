// SPDX-License-Identifier: MIT

/**
 * EmbeddedIntelligenceAdapter — the standalone baseline behind
 * `IntelligencePort`: any OpenAI-compatible `/chat/completions` endpoint,
 * reached with raw `fetch` and NO provider SDK (`.agents/rules/ai-features.md`;
 * `openai` / `@anthropic-ai/sdk` / `ai` are banned dependencies). The app is
 * fully functional with zero siblings installed; Plexo, when present, is a
 * federation bonus that registers behind the same port (ADR-0014/0017).
 *
 * This is an ADAPTER — a Framework & Driver. It is the only layer allowed to
 * know a wire shape, and it converts everything vendor-shaped into the port's
 * own types. It never leaks `choices`/`message` upward, and it never throws a
 * vendor error: every failure is the port's typed `IntelligenceError`.
 *
 * Timeout: every outbound call gets an explicit ceiling (`.agents/rules/
 * error-handling.md`). The caller's `signal` is honored too, so an aborted
 * request aborts the fetch rather than leaving it to burn the endpoint.
 */

import {
  IntelligenceError,
  type IntelligenceCompletion,
  type IntelligenceCompletionRequest,
  type IntelligencePort,
} from "./port";
import { LLM_REQUEST_TIMEOUT_MS } from "@/lib/env";

export type EmbeddedIntelligenceConfig = {
  /** OpenAI-compatible base URL, no trailing slash (e.g. `http://host:4000`). */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Adapter id reported to callers. Defaults to `embedded`. */
  id?: string;
  /** Per-call ceiling in ms. Defaults to `LLM_REQUEST_TIMEOUT_MS`. */
  timeoutMs?: number;
};

/** Read the assistant text out of an OpenAI-compatible completion body. */
function extractText(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (typeof first !== "object" || first === null) return null;
  const message = (first as { message?: unknown }).message;
  if (typeof message === "object" && message !== null) {
    const content = (message as { content?: unknown }).content;
    if (typeof content === "string") return content;
  }
  // A few compatible servers answer a completion (not a chat) shape.
  const text = (first as { text?: unknown }).text;
  return typeof text === "string" ? text : null;
}

function extractModel(payload: unknown, fallback: string): string {
  if (typeof payload === "object" && payload !== null) {
    const model = (payload as { model?: unknown }).model;
    if (typeof model === "string" && model.trim()) return model;
  }
  return fallback;
}

export class EmbeddedIntelligenceAdapter implements IntelligencePort {
  readonly id: string;
  readonly model: string;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(config: EmbeddedIntelligenceConfig) {
    this.id = config.id ?? "embedded";
    this.model = config.model;
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? LLM_REQUEST_TIMEOUT_MS;
  }

  async complete(request: IntelligenceCompletionRequest): Promise<IntelligenceCompletion> {
    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (request.system) messages.push({ role: "system", content: request.system });
    messages.push({ role: "user", content: request.prompt });

    const body: Record<string, unknown> = { model: this.model, messages };
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
    if (request.temperature !== undefined) body.temperature = request.temperature;

    // One controller carries BOTH the caller's abort and our own ceiling, so the
    // fetch observes one signal and cleanup is a single path.
    const controller = new AbortController();
    const onAbort = () => controller.abort(request.signal?.reason);
    if (request.signal?.aborted) {
      controller.abort(request.signal.reason);
    } else {
      request.signal?.addEventListener("abort", onAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(new Error("model request timed out")), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw new IntelligenceError("transport", "The model endpoint could not be reached.", {
        cause: error,
      });
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
    }

    if (!response.ok) {
      // The upstream body is operational detail: it is never returned to a
      // caller, only the status is carried for the log line.
      throw new IntelligenceError("status", `The model endpoint answered ${response.status}.`, {
        status: response.status,
      });
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new IntelligenceError("malformed", "The model endpoint returned unreadable JSON.", {
        cause: error,
      });
    }

    const text = extractText(payload);
    if (text === null) {
      throw new IntelligenceError(
        "malformed",
        "The model endpoint returned no assistant text in a readable shape.",
      );
    }

    return { text, model: extractModel(payload, this.model) };
  }
}
