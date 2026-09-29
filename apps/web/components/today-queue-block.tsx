// SPDX-License-Identifier: MIT
"use client";

/**
 * TodayQueueBlock — the shared shell for Today's three queue lenses (brief,
 * forgotten, related).
 *
 * THE DEFECT THIS EXISTS TO FIX
 * ----------------------------
 * All three cards fetched their route, and the route did not exist. Each rendered
 * `null` on any failure, so three of Today's eight blocks had been missing in
 * production for as long as anyone can tell, and NOTHING said so — not the page,
 * not a log the operator reads, not a badge. A blank region is indistinguishable
 * from "you have nothing to resurface", which is the one thing this state must
 * never be confused with, because the whole point of these lenses is that there
 * IS something there.
 *
 * The honest degradation ladder matches the repo's convention
 * (`lib/graph/degrade.ts`, `lib/pages/degrade.ts`, `lib/db/surface-unavailable.ts`):
 * the block reports WHICH state it is in and never silently omits itself.
 *
 *   loading   — a shimmer matching the eventual layout, so nothing shifts
 *   ready     — the items; a lens with genuinely nothing to show renders its
 *               empty line, because "nothing forgotten" is a real answer
 *   error     — the reason, as a one-line note the reader can retry, never a
 *               vanished block and never a fake empty list
 *
 * Keeping the shell here (not in each card) is what makes the three lenses behave
 * identically as they fail; the alternative was the three divergent `null`s that
 * produced this bug.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertCircle, Eye } from "lucide-react";
import Link from "next/link";

import { usePeek } from "@/components/peek-context";

export interface QueueItem {
  id: string;
  url?: string | null;
  title?: string | null;
  host?: string | null;
  reason?: string | null;
}

export type LensState =
  | { status: "loading" }
  | { status: "ready"; items: QueueItem[]; note?: string }
  | { status: "error"; message: string };

/**
 * Fetch one lens. Kept as a hook so the three cards share ONE behaviour on
 * failure — the divergence between three hand-rolled effects is what let one of
 * them swallow an error the others reported.
 */
export function useQueueLens(endpoint: string): {
  state: LensState;
  retry: () => void;
} {
  const [state, setState] = useState<LensState>({ status: "loading" });

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: "loading" });
      try {
        const res = await fetch(endpoint, { cache: "no-store", ...(signal ? { signal } : {}) });
        if (!res.ok) throw new Error(`queue ${res.status}`);
        const data = (await res.json()) as { items?: QueueItem[]; note?: string };
        setState({ status: "ready", items: data.items ?? [], ...(data.note ? { note: data.note } : {}) });
      } catch (e) {
        if (signal?.aborted) return;
        setState({
          status: "error",
          message: e instanceof Error && e.message !== "Failed to fetch"
            ? e.message
            : "Could not load this queue.",
        });
      }
    },
    [endpoint],
  );

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  return { state, retry: () => void load() };
}

/** One row: the item's link, its "why", and the peek control the cards had. */
function QueueRow({ item }: { item: QueueItem }) {
  const { open } = usePeek();
  const href = item.url ?? `/app/bookmarks/${item.id}/reader`;
  const title = item.title?.trim() || item.host || item.url || "Untitled";

  return (
    <li className="flex items-center gap-2 text-sm">
      <Link href={href} className="flex-1 min-w-0 truncate hover:underline">
        {title}
      </Link>
      {item.reason ? (
        <span className="shrink-0 text-xs text-muted-foreground">{item.reason}</span>
      ) : null}
      <button
        onClick={() =>
          open({ type: "queue", id: item.id, title, url: item.url, reason: item.reason })
        }
        className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted"
        aria-label="Peek"
      >
        <Eye className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

/**
 * The block. `emptyLabel` is what the lens says when it answered and there is
 * genuinely nothing — a real, designed state, never a blank region.
 */
export function TodayQueueBlock({
  label,
  endpoint,
  emptyLabel,
  renderItems,
}: {
  label: string;
  endpoint: string;
  emptyLabel: string;
  renderItems?: (items: QueueItem[]) => ReactNode;
}) {
  const { state, retry } = useQueueLens(endpoint);

  return (
    <section
      aria-label={label}
      data-queue-lens={label}
      data-queue-state={state.status}
      className="mb-6 rounded-lg border bg-card p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{label}</h2>
        {state.status === "error" ? (
          <button
            type="button"
            onClick={retry}
            className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Retry
          </button>
        ) : null}
      </div>

      {state.status === "loading" ? (
        <div aria-busy="true" className="space-y-2">
          <span className="sr-only">Loading {label}</span>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-5 animate-pulse rounded bg-muted/60" />
          ))}
        </div>
      ) : state.status === "error" ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <AlertCircle className="h-3.5 w-3.5 text-destructive" aria-hidden />
          <span>{state.message}</span>
        </p>
      ) : state.items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {state.note ?? emptyLabel}
        </p>
      ) : (
        <ul className="space-y-2">
          {renderItems ? (
            renderItems(state.items)
          ) : (
            state.items.map((it) => <QueueRow key={it.id} item={it} />)
          )}
        </ul>
      )}
    </section>
  );
}
