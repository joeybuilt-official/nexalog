// SPDX-License-Identifier: MIT
"use client";

/**
 * The chat surface's client hook — session state, the SSE read loop and the
 * readiness probe. Extracted so the page-scoped rail and the whole-brain panel
 * are ONE implementation with two layouts rather than two copies of the
 * transport that drift (a drift here is silent: the second copy keeps working
 * until it doesn't).
 *
 * What it deliberately does NOT do: derive a route from an id. Citations arrive
 * as `href`, built server-side by the one existing mapper. Anything that turns a
 * slug into a URL is a second mapper, which is the defect class this whole
 * milestone exists to avoid.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** Frames the route sends. Kept in sync with `lib/chat/turn.ts`. */
export type Frame =
  | {
      type: "meta";
      leg: string;
      model: string;
      ready: boolean;
      grounded: boolean;
      note?: string;
      plan: {
        scope: string | null;
        packTokens: number;
        recallTokens: number;
        expanded: number;
        concept: boolean;
        graphWalk: boolean;
        volunteered: number;
      };
      sessionId: string;
      created: boolean;
    }
  | { type: "delta"; text: string }
  | {
      type: "done";
      content: string;
      citations: Citation[];
      degradedReads: string[];
      partial: boolean;
    }
  | { type: "error"; message: string; code: string };

export interface Citation {
  href: string;
  slug: string;
  title: string;
  via: string;
}

export interface Readiness {
  ready: boolean;
  grounded: boolean;
  degraded: boolean;
  note?: string;
  leg: string | null;
  model: string | null;
}

export interface DisplayTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  partial: boolean;
  degradedReads: string[];
}

export interface ChatSurfaceState {
  readiness: Readiness;
  store: { sessions: number; maxSessions: number; maxTurnsPerSession: number; note: string };
}

export interface ChatController {
  /** null until the probe answers; a failed probe is reported separately. */
  readiness: Readiness | null;
  /** Set when the probe itself failed — NOT the same as "chat is off". */
  surfaceError: string | null;
  /** The server's own words for the current turn failure. */
  turnError: string | null;
  turns: DisplayTurn[];
  streaming: boolean;
  sessionId: string | null;
  /** The store's own note about durability, as reported by the server. */
  storeNote: string | null;
  input: string;
  setInput: (v: string) => void;
  send: () => void;
  retry: () => void;
}

/**
 * One chat surface. `scope` is the brain page to ground on, or null for the
 * whole brain. `active` gates the initial probe so a closed rail does not fetch.
 */
export function useChatSession(scope: string | null, active: boolean): ChatController {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [surfaceError, setSurfaceError] = useState<string | null>(null);
  const [storeNote, setStoreNote] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<DisplayTurn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [turnError, setTurnError] = useState<string | null>(null);
  const lastRef = useRef<string>("");

  const probe = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/surface", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as ChatSurfaceState;
      setReadiness(data.readiness);
      setStoreNote(data.store.note);
      setSurfaceError(null);
    } catch {
      // Unknown is its own state: a failed probe must not render as "available"
      // and must not render as "unavailable" either.
      setSurfaceError("Could not read whether chat is available on this deployment.");
    }
  }, []);

  useEffect(() => {
    if (active && !readiness && !surfaceError) void probe();
  }, [active, readiness, surfaceError, probe]);

  const run = useCallback(
    async (text: string) => {
      lastRef.current = text;
      setTurnError(null);
      setStreaming(true);

      const userId = `local-${Date.now()}`;
      setTurns((prev) => [
        ...prev,
        { id: userId, role: "user", content: text, citations: [], partial: false, degradedReads: [] },
      ]);
      const assistantId = `${userId}-a`;

      const patchAssistant = (patch: Partial<DisplayTurn>) => {
        setTurns((prev) => {
          const existing = prev.find((t) => t.id === assistantId);
          if (!existing) {
            return [
              ...prev,
              {
                id: assistantId,
                role: "assistant",
                content: "",
                citations: [],
                partial: false,
                degradedReads: [],
                ...patch,
              },
            ];
          }
          return prev.map((t) => (t.id === assistantId ? { ...t, ...patch } : t));
        });
      };

      try {
        const res = await fetch("/api/chat/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, ...(sessionId ? { sessionId } : {}), scope }),
        });

        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as
            | { error?: string; code?: string; surface?: { readiness: Readiness } }
            | null;
          if (data?.surface?.readiness) setReadiness(data.surface.readiness);
          // The question was NOT accepted: take the optimistic turn back out and
          // restore the input, so the user's words are never silently dropped.
          setTurns((prev) => prev.filter((t) => t.id !== userId));
          setInput(text);
          setTurnError(
            data?.error === "chat_unavailable"
              ? data?.surface?.readiness?.note ?? "This deployment cannot take a turn."
              : `The question could not be sent (${data?.error ?? res.status}).`,
          );
          return;
        }

        if (!res.body) {
          setTurnError("The answer stream was empty.");
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let answer = "";

        const handle = (frame: Frame) => {
          if (frame.type === "meta") {
            setReadiness((prev) =>
              prev
                ? {
                    ...prev,
                    ready: frame.ready,
                    grounded: frame.grounded,
                    leg: frame.leg,
                    model: frame.model,
                    ...(frame.note ? { note: frame.note } : {}),
                  }
                : prev,
            );
            if (frame.created && frame.sessionId) setSessionId(frame.sessionId);
          } else if (frame.type === "delta") {
            answer += frame.text;
            patchAssistant({ content: answer });
          } else if (frame.type === "done") {
            patchAssistant({
              content: frame.content || answer,
              citations: frame.citations,
              partial: frame.partial,
              degradedReads: frame.degradedReads,
            });
            if (frame.partial) setTurnError("The answer was cut off before it finished.");
          } else if (frame.type === "error") {
            setTurnError(frame.message);
          }
        };

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // Frames are separated by a BLANK LINE. A chunk boundary lands
          // wherever the network puts it, so only complete frames are consumed
          // — splitting per chunk drops a frame every time one straddles a read,
          // and the user sees missing words mid-answer.
          let sep = buffer.indexOf("\n\n");
          while (sep !== -1) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const line = frame.split("\n").find((l) => l.startsWith("data:"));
            if (line) {
              try {
                handle(JSON.parse(line.slice(5).trim()) as Frame);
              } catch {
                // A malformed frame is dropped; the rest of the answer stands.
              }
            }
            sep = buffer.indexOf("\n\n");
          }
        }
      } catch {
        setTurnError("The connection to the answer stream failed.");
      } finally {
        setStreaming(false);
      }
    },
    [scope, sessionId],
  );

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    void run(text);
  }, [input, streaming, run]);

  const retry = useCallback(() => {
    const text = lastRef.current;
    if (!text || streaming) return;
    // Drop the failed exchange so the retry does not stack a second copy of it.
    setTurns((prev) => prev.filter((t) => !t.id.startsWith(`local-`) || t.role === "user").slice(0, -1));
    void run(text);
  }, [streaming, run]);

  return {
    readiness,
    surfaceError,
    turnError,
    turns,
    streaming,
    sessionId,
    storeNote,
    input,
    setInput,
    send,
    retry,
  };
}
