// Phase 11 staleness scoring
// Operator refinement applied:
//   - homepage: only dead_link contributes; unread_60d, redirect_home, llm_not_current do NOT apply
//   - reference: unread_60d does NOT apply (docs are opened-when-needed, not "read once")
//   - evergreen=true: unread_60d does NOT apply (foundational content stays current)

import type { ClassifiedKind } from "./classifier";

export type StalenessReason =
  | "unread_60d"
  | "dead_link"
  | "redirect_home"
  | "llm_not_current";

export interface StalenessInput {
  kindClassified: ClassifiedKind | null;
  evergreen: boolean | null;
  createdAt: Date;
  lastVisitedAt: Date | null;
  // signals
  isDeadLink: boolean;       // HEAD returned 4xx/5xx/null host
  isRedirectHome: boolean;   // resolved to a different host's root
  llmCurrent: boolean | null; // null = not yet checked
}

export interface StalenessOutput {
  score: number;
  reasons: StalenessReason[];
}

const WEIGHTS: Record<StalenessReason, number> = {
  unread_60d: 0.3,
  dead_link: 1.0,
  redirect_home: 0.5,
  llm_not_current: 0.6,
};

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

export function scoreStaleness(input: StalenessInput): StalenessOutput {
  const reasons: StalenessReason[] = [];
  const kind = input.kindClassified;

  // Dead link applies to ALL kinds (including homepage).
  if (input.isDeadLink) reasons.push("dead_link");

  // For homepage: only dead_link counts. Skip everything else.
  if (kind === "homepage") {
    return finalize(reasons);
  }

  // redirect_home does not apply to homepage (the row IS the home).
  if (input.isRedirectHome) reasons.push("redirect_home");

  // unread_60d: skip for reference and for evergreen content.
  const unreadSkip = kind === "reference" || input.evergreen === true;
  if (!unreadSkip) {
    const lastTouch = input.lastVisitedAt ?? input.createdAt;
    const ageMs = Date.now() - lastTouch.getTime();
    if (ageMs >= SIXTY_DAYS_MS) reasons.push("unread_60d");
  }

  // LLM gate: only contributes when explicitly false. null = not yet checked.
  if (input.llmCurrent === false) reasons.push("llm_not_current");

  return finalize(reasons);
}

function finalize(reasons: StalenessReason[]): StalenessOutput {
  let score = 0;
  for (const r of reasons) score += WEIGHTS[r];
  return { score: Math.min(1, score), reasons };
}

// Cron decides what to archive.
export function shouldArchive(score: number): boolean {
  return score >= 0.7;
}
