// SPDX-License-Identifier: MIT
/**
 * The chat surface's IO shell — what the route handlers and the server-rendered
 * page call. Same split as `lib/pages/read.ts`: this module does the IO and
 * reports WHICH rung it got; the shape of the answer is decided by the pure
 * ladder in `./degrade.ts`.
 *
 * It is also the ONE place the chat legs are read off the composition root, so
 * a page and a route can never disagree about whether this deployment can take
 * a turn. That disagreement is not hypothetical: it is how a screen ends up
 * offering a composer while the API behind it is unconfigured.
 */

import { citationCandidates, renderContextBlock } from "@nexalog/core";

import { getComposition } from "@/composition";
import { brainPageHref } from "@/lib/search/result-href";
import { resolveChatReadiness, type ChatLeg, type ChatReadiness } from "./degrade";
import { getChatSessionStore, type SessionStoreStatus } from "./session-store";
import type { TurnDeps } from "./turn";

/** Everything the chat surface needs to render honestly before a turn. */
export interface ChatSurfaceState {
  readiness: ChatReadiness;
  store: SessionStoreStatus;
}

/**
 * Read the surface's state. `brain` is reported from the composition root —
 * `gbrain: null` is `unconfigured`, and a configured client is reported as
 * `ok` here because its reachability is only knowable by CALLING it (and the
 * turn reports that per-read, which is where it actually matters).
 */
export function readChatSurfaceState(): ChatSurfaceState {
  let composition: ReturnType<typeof getComposition> | null = null;
  try {
    composition = getComposition();
  } catch {
    composition = null; // BRAIN_REPO unset — standalone mode, no composition
  }

  const turn: ChatLeg = composition?.chat ? "ok" : "unconfigured";
  const brain: ChatLeg = composition?.gbrain
    ? composition.assembleTurnContext
      ? "ok"
      : "unconfigured"
    : "unconfigured";

  return {
    readiness: resolveChatReadiness({
      turn,
      brain,
      legId: composition?.chat?.id ?? null,
      model: composition?.chat?.model ?? null,
    }),
    store: getChatSessionStore().status(),
  };
}

/**
 * The turn dependencies, wired from the composition root. One builder so the
 * route never assembles a second, drifting set of the same collaborators.
 *
 * `assembleTurnContext.execute` is called through this indirection rather than
 * imported into the route, so the route stays a thin transport adapter — the
 * same reason `lib/pages/read.ts` exists.
 */
export function getTurnDeps(): TurnDeps {
  const composition = getComposition();
  const store = getChatSessionStore();

  return {
    chat: composition.chat,
    assembleContext: composition.assembleTurnContext
      ? async (input) => {
          const result = await composition.assembleTurnContext!.execute(input);
          return { context: result.context, plan: result.plan };
        }
      : null,
    appendTurn: (userId, sessionId, turn) => store.append(userId, sessionId, turn),
    renderContext: renderContextBlock,
    citationCandidates: (context, max) => citationCandidates(context, max).map((c) => ({
      slug: c.slug,
      title: c.title,
      evidence: c.evidence,
    })),
    // The ONE href mapper. A citation is a route the server resolved, never a
    // route the client guessed from an id.
    brainHref: brainPageHref,
  };
}
