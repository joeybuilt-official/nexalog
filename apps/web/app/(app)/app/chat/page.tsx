// SPDX-License-Identifier: MIT
/**
 * /app/chat — a whole-brain chat surface, and the home for a session that is
 * NOT scoped to one page.
 *
 * WHY A SECOND MOUNT POINT
 * ------------------------
 * The rail on the reader is scoped to the page in view, which is where most
 * questions come from — but "what do I know about X" is not a question about
 * one page, and a chat that could only be opened from a page would make the
 * whole-brain question unreachable. Same rail, same port, same citations; the
 * only difference is that `scope` is null and the assembly skips
 * `context_pack`.
 *
 * The page itself is server-rendered and does NOT probe the legs: the rail owns
 * its own readiness, so there is exactly one place that can decide whether a
 * composer is shown and it cannot disagree with the API.
 */

import { ChatSessionPanel } from "@/components/brain/chat-session-panel";

export const dynamic = "force-dynamic";

export default function ChatPage() {
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">Ask your brain</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Questions are answered from the brain&rsquo;s own indexed pages and the answers cite the
          pages they came from — every citation opens the reader.
        </p>
      </header>
      <ChatSessionPanel />
    </div>
  );
}
