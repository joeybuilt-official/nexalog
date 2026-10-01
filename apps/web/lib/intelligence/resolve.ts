// SPDX-License-Identifier: MIT

/**
 * The port resolver — the ONE place an adapter is constructed for intelligence,
 * and the ONE place the app decides which tier answered (`.claude/rules/
 * ai-features.md`: "branching on which adapter is active is the port resolver's
 * job, never a feature's").
 *
 * Resolution is env-driven and never guesses:
 *
 *   1. Embedded (always available when `LLM_BASE_URL` + `LLM_API_KEY` are set):
 *      an OpenAI-compatible endpoint via raw `fetch`. This is the standalone
 *      baseline.
 *   2. Federated (Plexo present and authorized): a later adapter registers here
 *      and supersedes embedded behind the same port (ADR-0014/0015/0017). It is
 *      NOT implemented in this change — there is no agreed Plexo completion
 *      contract in this tree, and inventing one would be a guessed wire shape.
 *
 * With no configuration at all this returns `null`, which is the honest state a
 * feature renders instead of an error: Plexo is optional and the app must run
 * standalone.
 */

import { llmConfig } from "@/lib/env";
import { EmbeddedIntelligenceAdapter } from "./embedded-adapter";
import type { IntelligencePort } from "./port";

export function resolveIntelligence(
  env: Record<string, string | undefined> = process.env,
): IntelligencePort | null {
  const config = llmConfig(env);
  if (!config) return null;
  return new EmbeddedIntelligenceAdapter(config);
}
