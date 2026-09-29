// SPDX-License-Identifier: MIT
/**
 * The chat surface's degradation ladder (pure — no IO, unit-tested).
 *
 * WHY THIS EXISTS
 * ---------------
 * The chat surface has TWO independent legs, and either can be missing:
 *
 *   turn  — the leg that hosts the model turn (`CHAT_BASE_URL`). Without it
 *           there is no answer to stream, and a composer that renders anyway is
 *           a lie the user only discovers after typing.
 *   brain — gbrain, which supplies every citation. Without it a turn can still
 *           be answered, but it is answered WITHOUT the brain, and the surface
 *           must say so rather than present an ungrounded answer as a grounded
 *           one.
 *
 * This is the same ladder shape `/api/graph` and `/api/pages` established
 * (`lib/graph/degrade.ts`, `lib/pages/degrade.ts`) applied to a third surface:
 * the answer reports WHICH legs it got and every non-`ok` state carries a
 * `note` saying why, because "source: none" alone tells a reader nothing.
 *
 * It is deliberately NOT a boolean `available`. A single flag cannot express
 * the state that matters most — a working turn leg with a dead retrieval leg —
 * and that is exactly the state in which an answer looks grounded and is not.
 */

/** Which legs answered. */
export type ChatLeg = "ok" | "unconfigured" | "unreachable" | "empty";

export interface ChatLegs {
  turn: ChatLeg;
  brain: ChatLeg;
}

/** The surface's own readiness, as the server sees it. */
export interface ChatReadiness {
  /** True only when the TURN leg can answer. */
  ready: boolean;
  /** True when citations can be produced at all (brain leg usable). */
  grounded: boolean;
  /** True when anything is degraded — the UI's cue to explain itself. */
  degraded: boolean;
  /** Human-readable reason, set on every non-ready/non-grounded state. */
  note?: string;
  /** Which leg answered the turn, as data (never inferred from prose). */
  leg: string | null;
  /** Model label the turn leg reports. */
  model: string | null;
}

/**
 * Readiness for a chat surface. `legId`/`model` are the configured turn leg's
 * own labels — they are reported, never branched on.
 */
export function resolveChatReadiness(input: {
  turn: ChatLeg;
  brain: ChatLeg;
  legId: string | null;
  model: string | null;
}): ChatReadiness {
  const { turn, brain, legId, model } = input;
  const ready = turn === "ok";
  // `empty` still counts as grounded: a brain with no matching pages is a real
  // answer ("the brain does not cover this"), not an outage.
  const grounded = brain === "ok" || brain === "empty";

  return {
    ready,
    grounded,
    degraded: !ready || !grounded,
    leg: legId,
    model,
    ...(noteFor(turn, brain) ? { note: noteFor(turn, brain) } : {}),
  };
}

function noteFor(turn: ChatLeg, brain: ChatLeg): string | undefined {
  if (turn !== "ok") return turnNote(turn);

  switch (brain) {
    case "ok":
      return undefined;
    case "empty":
      return "The brain returned nothing for this turn — the answer rests on the conversation only. A citation-free answer here means the brain had no matching page, not that retrieval failed.";
    case "unreachable":
      return "GBrain is unreachable, so this turn runs WITHOUT the brain. The answer will not cite pages — treat it as conversation, not as the brain's answer.";
    case "unconfigured":
      return "GBrain is not configured on this deployment, so this turn runs without the brain and cannot cite pages.";
  }
}

function turnNote(turn: Exclude<ChatLeg, "ok">): string {
  switch (turn) {
    case "unconfigured":
      return "No chat leg is configured on this deployment (CHAT_BASE_URL is unset), so no turn can be taken. Retrieval and the reader work; only the answer is missing.";
    case "unreachable":
      return "The chat leg is configured but did not answer, so no turn can be taken right now. This is an upstream problem, not a problem with your question.";
    case "empty":
      return "The chat leg answered with nothing — no turn can be taken right now.";
  }
}
