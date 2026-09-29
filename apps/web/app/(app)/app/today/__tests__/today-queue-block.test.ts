// SPDX-License-Identifier: MIT
/**
 * Today's queue blocks must never vanish silently — the defect this change closes.
 *
 * THE STATE BEING GUARDED AGAINST, MEASURED: three of Today's eight blocks
 * (`TodayBrief`, `TodayForgotten`, `TodayRelated`) each fetched a route that did
 * not exist, and each rendered `null` on failure. So the block was absent in
 * production, no error surfaced anywhere, and that absence was indistinguishable
 * from "you have nothing to resurface" — the one reading that is definitely
 * wrong, since the whole point of these lenses is that there IS something.
 *
 * What is asserted here:
 *   - every state renders something: a loading state, a real empty, a failure
 *     with its reason and a retry;
 *   - the block marks WHICH lens and WHICH state it is in, so a verification can
 *     tell a working lens from a vanished one from the DOM;
 *   - each card still fetches the endpoint it always fetched — the wiring the
 *     components had right while the routes were missing — asserted against the
 *     components' own source, so a future edit cannot quietly repoint a card at
 *     a path nothing serves.
 *
 * `renderToStaticMarkup` renders the loading state (effects do not run on the
 * server), so the fetch-dependent states are covered by the route tests, which
 * drive the real handlers. That is the honest split, stated rather than worked
 * around with fake timers.
 *
 * Co-located with the Today page it renders, so the test can import app/ and
 * components/ without crossing the `web-lib-no-ui` architecture rule.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/app/today",
}));

vi.mock("@/components/peek-context", () => ({
  usePeek: () => ({ open: vi.fn() }),
}));

type BlockProps = {
  label: string;
  endpoint: string;
  emptyLabel: string;
};

/**
 * Render the block as an ELEMENT, never by calling it: these are client
 * components using hooks, and `TodayQueueBlock(props)` invokes `useState` outside
 * a render, which React 19 reports as "Cannot read properties of null (reading
 * 'useState')".
 */
async function renderBlock(props: BlockProps): Promise<string> {
  const { TodayQueueBlock } = await import("@/components/today-queue-block");
  return renderToStaticMarkup(createElement(TodayQueueBlock, props));
}

// From `app/(app)/app/today/__tests__/` up to `apps/web/` is five segments:
// __tests__ -> today -> app -> (app) -> app. Four is one short, which silently
// reads outside the web root.
const WEB_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

describe("TodayQueueBlock — the never-blank contract", () => {
  it("renders a labelled loading state, not a blank region", async () => {
    const html = await renderBlock({
      label: "Forgotten",
      endpoint: "/api/queue/forgotten?n=3",
      emptyLabel: "Nothing has gone stale.",
    });

    expect(html).toContain('aria-label="Forgotten"');
    expect(html).toContain('data-queue-state="loading"');
    expect(html).toContain("Loading Forgotten");
  });

  it("marks the block with the lens it renders, so a verification can find it", async () => {
    const html = await renderBlock({
      label: "Today's brief",
      endpoint: "/api/queue?n=5",
      emptyLabel: "...",
    });

    expect(html).toContain('data-queue-lens="Today&#x27;s brief"');
  });

  it("does not offer a retry control while it is still loading", async () => {
    const html = await renderBlock({
      label: "Related now",
      endpoint: "/api/queue/related?n=3",
      emptyLabel: "...",
    });

    // Retry belongs to the failure state; offering it during a load invites a
    // second request for no reason.
    expect(html).not.toContain("Retry");
  });

  it("renders through the three real cards and never returns null", async () => {
    const { TodayBrief } = await import("@/components/today-brief");
    const { TodayForgotten } = await import("@/components/today-forgotten");
    const { TodayRelated } = await import("@/components/today-related");

    const brief = renderToStaticMarkup(createElement(TodayBrief));
    const forgotten = renderToStaticMarkup(createElement(TodayForgotten));
    const related = renderToStaticMarkup(createElement(TodayRelated));

    expect(brief).toContain('data-queue-lens="Today&#x27;s brief"');
    expect(forgotten).toContain('data-queue-lens="Forgotten"');
    expect(related).toContain('data-queue-lens="Related now"');

    for (const html of [brief, forgotten, related]) {
      expect(html).toMatch(/data-queue-state="(loading|ready|error)"/);
    }
  });
});

describe("the queue endpoints the Today cards call", () => {
  it("are the three the components name, with the n each one asked for", async () => {
    // Read the components' own source so the endpoints and page sizes cannot
    // drift from what the routes were built to answer. This is the assertion
    // that would have caught the original defect: the routes were missing and
    // nothing connected the callers to them.
    const brief = readFileSync(`${WEB_ROOT}components/today-brief.tsx`, "utf8");
    const forgotten = readFileSync(`${WEB_ROOT}components/today-forgotten.tsx`, "utf8");
    const related = readFileSync(`${WEB_ROOT}components/today-related.tsx`, "utf8");
    const voice = readFileSync(`${WEB_ROOT}components/voice-reader/useVoiceQueue.ts`, "utf8");

    expect(brief).toContain('"/api/queue?n=5"');
    expect(forgotten).toContain('"/api/queue/forgotten?n=3"');
    expect(related).toContain('"/api/queue/related?n=3"');
    expect(voice).toContain('"/api/queue?n=12"');
  });

  it("are all served by a route file that exists", async () => {
    // The other half of the same defect: a call site with no route behind it.
    const routes = [
      "app/api/queue/route.ts",
      "app/api/queue/forgotten/route.ts",
      "app/api/queue/related/route.ts",
    ];
    for (const route of routes) {
      expect(() => readFileSync(`${WEB_ROOT}${route}`, "utf8")).not.toThrow();
    }
  });
});
