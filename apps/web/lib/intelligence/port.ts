// SPDX-License-Identifier: MIT

/**
 * IntelligencePort — the architecture's ONE model boundary.
 *
 * Business rules depend on THIS interface; a provider (an OpenAI-compatible
 * endpoint behind `embedded-adapter.ts`, and later Plexo behind its own
 * adapter) implements it at the edge. Nothing inward of an adapter may name a
 * provider, a model identifier, or a vendor's response shape — a use case that
 * branches on which model answered has hardcoded a Detail into a business rule
 * (`.claude/rules/ai-features.md`, ADR-0014/0017).
 *
 * This file is pure: types only, plus the typed error shape. It imports nothing
 * and can be depended on from anywhere.
 */

/** The stable failure vocabulary a caller branches on — never the message text. */
export const INTELLIGENCE_ERROR_CODES = [
  /** The endpoint could not be reached at all (DNS, connect, timeout). */
  "transport",
  /** The endpoint answered, but not with a success status. */
  "status",
  /** The endpoint answered 2xx with a body this port cannot read. */
  "malformed",
] as const;

export type IntelligenceErrorCode = (typeof INTELLIGENCE_ERROR_CODES)[number];

/**
 * A model call that did not produce text. Carries the stable `code` a caller
 * branches on and (for `status`) the upstream status, which is operational
 * detail — never rendered to a user, only logged.
 */
export class IntelligenceError extends Error {
  readonly code: IntelligenceErrorCode;
  readonly status: number | null;

  constructor(
    code: IntelligenceErrorCode,
    message: string,
    options: { status?: number | null; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "IntelligenceError";
    this.code = code;
    this.status = options.status ?? null;
  }
}

export interface IntelligenceCompletionRequest {
  /**
   * Instructions that frame the turn (role: system). A separate field, not
   * text the caller appended, so an adapter can place or drop it without
   * parsing prose.
   */
  system?: string;
  /** The user turn, verbatim. */
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  /** Aborted when the caller's request is aborted. */
  signal?: AbortSignal;
}

export interface IntelligenceCompletion {
  /** The assistant text. Non-empty; an empty answer is a failure, not a result. */
  text: string;
  /** The model that actually answered, as the endpoint reported it or was configured. */
  model: string;
}

/**
 * One capability: take a prompt, return text. Features declare what they need
 * from a model, never how it is reached.
 *
 * `complete` throws `IntelligenceError` on failure. A caller that can render an
 * un-enriched view MUST catch it and do so — a surface that cannot enrich must
 * never hard-fail the page.
 */
export interface IntelligencePort {
  /** Stable id of the configured adapter, for logs and an honesty banner. */
  readonly id: string;
  /** The model label this adapter will request / did answer with. */
  readonly model: string;
  complete(request: IntelligenceCompletionRequest): Promise<IntelligenceCompletion>;
}
