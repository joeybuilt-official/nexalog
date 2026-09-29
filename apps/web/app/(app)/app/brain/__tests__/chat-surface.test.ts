// SPDX-License-Identifier: MIT
/**
 * Render proof for the chat surface — the markup it actually produces when the
 * deployment CANNOT take a turn.
 *
 * WHY THIS IS THE RENDER TEST WORTH HAVING
 * ---------------------------------------
 * The repo has already shipped this defect twice: a note chat panel mounted on
 * every note calling routes that do not exist, and three Today blocks silently
 * empty in production. Both looked fine in markup-only review because the
 * failure is the presence of a control that cannot work.
 *
 * So the assertions are structural, not textual:
 *   - with no turn leg, `data-chat-ready="no"` and the state marker is
 *     `unavailable`, and there is NO textarea and NO submit control anywhere in
 *     the output. An inert composer is the defect; its absence is the fix.
 *   - the server's own note is rendered verbatim, so the user reads the reason
 *     rather than a generic "something went wrong".
 *   - when retrieval is dead but the turn leg works, the marker is `degraded`
 *     (not `unavailable`), because the answer still arrives — and the surface
 *     must say it is not grounded rather than let it pass as authoritative.
 *
 * Written as a `.ts` spec using `createElement`: vitest collects `*.test.ts`
 * only, so a `.tsx` render spec would silently never run.
 *
 * Co-located with the surface it renders (not under `lib/`) so it can import
 * app/ components without crossing the `web-lib-no-ui` architecture rule.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { useChatSession } = vi.hoisted(() => ({ useChatSession: vi.fn() }));

vi.mock("@/lib/chat/use-chat-session", () => ({ useChatSession }));

import { ChatSurface } from "@/components/brain/chat-surface";

/** The controller shape the surface consumes. */
function controller(over: Record<string, unknown> = {}) {
  return {
    readiness: { ready: true, grounded: true, degraded: false, leg: "leg", model: "m" },
    surfaceError: null,
    turnError: null,
    turns: [],
    streaming: false,
    sessionId: null,
    storeNote: "Sessions live in this server process. A restart clears the rail.",
    input: "",
    setInput: vi.fn(),
    send: vi.fn(),
    retry: vi.fn(),
    ...over,
  };
}

function render(over: Record<string, unknown> = {}) {
  useChatSession.mockReturnValue(controller(over));
  return renderToStaticMarkup(
    createElement(ChatSurface, { scope: "concepts/litellm-gateway", scopeTitle: "LiteLLM Gateway", variant: "rail" }),
  );
}

beforeEach(() => {
  useChatSession.mockReset();
});

describe("ChatSurface — the unavailable state", () => {
  it("renders no composer at all when the deployment cannot take a turn", () => {
    const html = render({
      readiness: {
        ready: false,
        grounded: true,
        degraded: true,
        leg: null,
        model: null,
        note: "No chat leg is configured on this deployment (CHAT_BASE_URL is unset), so no turn can be taken. Retrieval and the reader work; only the answer is missing.",
      },
    });

    expect(html).toContain('data-chat-ready="no"');
    expect(html).toContain('data-chat-state="unavailable"');
    // The reason, in the server's words.
    expect(html).toContain("CHAT_BASE_URL is unset");
    expect(html).toContain("No composer is shown");
    // THE assertion: no input, no send control.
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain('aria-label="Send"');
  });

  it("renders the composer only when ready", () => {
    const html = render();
    expect(html).toContain('data-chat-ready="yes"');
    expect(html).toContain("<textarea");
    expect(html).toContain('aria-label="Send"');
    expect(html).not.toContain('data-chat-state="unavailable"');
  });

  it("marks a grounded-legs-off turn as degraded, not unavailable", () => {
    const html = render({
      readiness: {
        ready: true,
        grounded: false,
        degraded: true,
        leg: "leg",
        model: "m",
        note: "GBrain is unreachable, so this turn runs WITHOUT the brain. The answer will not cite pages — treat it as conversation, not as the brain's answer.",
      },
    });
    // The composer IS shown (the turn can be taken) but the state is degraded.
    expect(html).toContain('data-chat-ready="yes"');
    expect(html).toContain('data-chat-state="degraded"');
    expect(html).toContain("WITHOUT the brain");
    expect(html).toContain("<textarea");
  });

  it("shows the store's own durability note so the rail is not mistaken for durable", () => {
    const html = render();
    expect(html).toContain("restart clears the rail");
  });

  it("says a failed probe is unknown, not unavailable", () => {
    const html = render({
      readiness: null,
      surfaceError: "Could not read whether chat is available on this deployment.",
    });
    expect(html).toContain("Could not read whether chat is available");
    expect(html).not.toContain("<textarea");
  });
});

describe("ChatSurface — citations in the markup", () => {
  it("renders a citation as a link to the SERVER-supplied reader route", () => {
    const html = render({
      turns: [
        { id: "u1", role: "user", content: "what is the gateway?", citations: [], partial: false, degradedReads: [] },
        {
          id: "a1",
          role: "assistant",
          content: "The gateway routes every model call.",
          citations: [
            { href: "/app/brain/concepts/litellm-gateway", slug: "concepts/litellm-gateway", title: "LiteLLM Gateway", via: "keyword_exact" },
          ],
          partial: false,
          degradedReads: [],
        },
      ],
    });

    expect(html).toContain('href="/app/brain/concepts/litellm-gateway"');
    expect(html).toContain("LiteLLM Gateway");
    expect(html).toContain('data-citation-count="1"');
    // The defect this milestone closes: a capture-reader route minted from a slug.
    expect(html).not.toContain("/app/bookmarks/");
    expect(html).not.toContain("/reader");
  });

  it("labels a cut-off answer as incomplete rather than presenting it as whole", () => {
    const html = render({
      turns: [
        {
          id: "a1",
          role: "assistant",
          content: "half an ans",
          citations: [],
          partial: true,
          degradedReads: [],
        },
      ],
    });
    expect(html).toContain("cut off");
    expect(html).toContain("incomplete");
  });

  it("names the reads that failed for the turn", () => {
    const html = render({
      turns: [
        {
          id: "a1",
          role: "assistant",
          content: "answer without grounding",
          citations: [],
          partial: false,
          degradedReads: ["recall", "search"],
        },
      ],
    });
    expect(html).toContain("recall, search");
  });
});
