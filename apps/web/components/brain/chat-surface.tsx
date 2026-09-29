// SPDX-License-Identifier: MIT
"use client";

/**
 * The chat surface's presentation — one component, two mounts.
 *
 *   the reader rail  (`scope` = the page in view) — a question about a page.
 *   /app/chat        (`scope` = null)             — a question about the brain.
 *
 * The TRANSPORT lives in `useChatSession`; this file is layout. Keeping the
 * transport in one place is not tidiness: two copies of an SSE read loop drift
 * silently (the second one keeps half-working), and two copies of a citation
 * renderer is exactly how four call sites once each invented the same wrong
 * route and every brain search hit 404'd on click.
 *
 * WHAT IT REFUSES TO DO:
 *   - decide whether chat works. The server says (one probe, one answer), so a
 *     page and an API can never disagree.
 *   - build a citation route. `citation.href` arrives resolved.
 *   - render a composer it cannot serve, or present a cut-off answer as whole.
 */

import { useEffect, useRef } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, MessageSquare, RotateCcw, Send, X } from "lucide-react";

import { useChatSession, type Citation, type DisplayTurn } from "@/lib/chat/use-chat-session";

function CitationList({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Sources" data-citation-count={citations.length}>
      {citations.map((c) => (
        // `c.href` is the SERVER's reader route, produced by the one mapper.
        // Nothing here interprets a slug or an id.
        <li key={c.href}>
          <Link
            href={c.href}
            title={`${c.slug} — found by ${c.via}`}
            className="inline-block rounded-full border border-border px-2 py-0.5 text-[11px] text-foreground underline decoration-border underline-offset-2 hover:decoration-copper"
          >
            {c.title || c.slug}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Turn({ turn }: { turn: DisplayTurn }) {
  return (
    <div className={turn.role === "user" ? "flex justify-end" : "flex justify-start"}>
      <div className="max-w-[92%] space-y-2">
        <div
          className={[
            "whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
            turn.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
          ].join(" ")}
        >
          {turn.content}
        </div>
        {turn.partial && (
          <p className="text-[11px] italic text-muted-foreground">
            This answer was cut off — it is incomplete.
          </p>
        )}
        <CitationList citations={turn.citations} />
        {turn.degradedReads.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Grounding unavailable for this turn: {turn.degradedReads.join(", ")}.
          </p>
        )}
      </div>
    </div>
  );
}

export function ChatSurface({
  scope,
  scopeTitle,
  variant,
  onClose,
}: {
  scope: string | null;
  scopeTitle: string;
  /** `rail` docks beside the reader; `panel` fills the /app/chat page. */
  variant: "rail" | "panel";
  onClose?: () => void;
}) {
  const chat = useChatSession(scope, true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.turns, chat.streaming]);

  const canAsk = chat.readiness?.ready === true;
  const note = chat.surfaceError ?? chat.readiness?.note ?? null;

  return (
    <div
      data-chat-variant={variant}
      data-chat-ready={canAsk ? "yes" : "no"}
      className={[
        "flex flex-col overflow-hidden border border-border bg-background",
        variant === "rail"
          ? "fixed inset-x-0 bottom-0 z-40 max-h-[70vh] border-t shadow-xl md:inset-x-auto md:right-0 md:top-0 md:h-full md:max-h-none md:w-[26rem] md:border-l md:border-t-0"
          : "h-[70vh] rounded-lg",
      ].join(" ")}
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <MessageSquare className="h-4 w-4 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">Ask about {scopeTitle}</p>
          {scope && <p className="truncate font-mono text-[11px] text-muted-foreground">{scope}</p>}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close chat"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </header>

      {/* The server's own statement about this deployment. Rendered whenever it
          has one — including when the answer leg works but retrieval does not,
          which is the state in which an answer looks grounded and is not. */}
      {note && (
        <div
          data-chat-state={canAsk ? "degraded" : "unavailable"}
          className="border-b border-border bg-surface px-4 py-3"
        >
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
            <span>{note}</span>
          </p>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4" data-chat-turns={chat.turns.length}>
        {chat.turns.length === 0 && canAsk && (
          <p className="mt-6 text-center text-xs text-muted-foreground">
            {scope
              ? `Ask a question about “${scopeTitle}”. Answers are grounded in the brain and cite the pages they came from.`
              : "Ask a question about your brain. Answers cite the pages they came from, and every citation opens the reader."}
          </p>
        )}
        {chat.turns.map((turn) => (
          <Turn key={turn.id} turn={turn} />
        ))}
        {chat.streaming && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            Retrieving from the brain…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {chat.turnError && (
        <div role="alert" className="flex items-start gap-2 border-t border-border px-3 pt-2 text-xs text-red-400">
          <span className="flex-1">{chat.turnError}</span>
          <button
            type="button"
            onClick={chat.retry}
            className="inline-flex items-center gap-1 underline hover:no-underline"
          >
            <RotateCcw className="h-3 w-3" aria-hidden />
            Retry
          </button>
        </div>
      )}

      {/* No composer when this deployment cannot answer. An input that silently
          fails is worse than no input — that is the shipped defect this
          milestone is closing. */}
      {canAsk ? (
        <div className="flex items-end gap-2 border-t border-border p-3">
          <textarea
            value={chat.input}
            onChange={(e) => chat.setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                chat.send();
              }
            }}
            placeholder="Ask a question…"
            rows={1}
            aria-label="Your question"
            className="max-h-24 flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
          />
          <button
            type="button"
            onClick={chat.send}
            disabled={!chat.input.trim() || chat.streaming}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="border-t border-border p-3">
          <p className="text-center text-xs text-muted-foreground">
            {chat.readiness === null && !chat.surfaceError ? (
              <>
                <Loader2 className="mr-1 inline h-3 w-3 animate-spin" aria-hidden />
                Checking whether chat is available…
              </>
            ) : (
              "No composer is shown because this deployment has nowhere to send a question."
            )}
          </p>
        </div>
      )}

      {chat.storeNote && (
        <p className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
          {chat.storeNote}
        </p>
      )}
    </div>
  );
}
