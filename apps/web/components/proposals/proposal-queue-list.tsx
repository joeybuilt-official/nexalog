// SPDX-License-Identifier: MIT
/**
 * ProposalQueueList — the pending take proposals, and the decision on each.
 *
 * The states are the required trio (`frontend.md` → "Loading, empty, and error"):
 * a loading shimmer, a real empty state that explains what the queue is and where
 * proposals come from, and an error state carrying the reason AND a retry. The
 * unconfigured state is a fourth, because "this instance cannot read the queue"
 * is not an error the operator can retry their way out of — it names the missing
 * configuration instead of offering a button that cannot work.
 *
 * The header prints `counts.pending` — the count over the WHOLE queue, read from
 * the database in the same request as the page — so the number the operator sees
 * IS the number the queue holds. That equality is the point: it is how anyone can
 * tell a working surface from a surface that is showing a stale page of nothing.
 */

"use client";

import { useCallback, useEffect, useState } from "react";

import { EmptyState, ErrorState, LoadingShimmer } from "@/components/content-finder/states";
import { ProposalCard, type ProposalCardItem } from "./proposal-card";
import type { ProposalCounts } from "./proposal-counts";
export interface ProposalsResponse {
  proposals: ProposalCardItem[];
  counts: ProposalCounts;
  nextOffset: number | null;
  degraded: boolean;
}

export function ProposalQueueList() {
  const [data, setData] = useState<ProposalsResponse | null>(null);
  const [error, setError] = useState<{ message: string; unconfigured: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [decided, setDecided] = useState<number[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/proposals?limit=100", { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        setError({
          message: body.message ?? `Proposals request failed (${res.status}).`,
          unconfigured: body.error === "gbrain_unavailable",
        });
        return;
      }
      setData((await res.json()) as ProposalsResponse);
    } catch {
      setError({ message: "Could not reach the server.", unconfigured: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onDecided = useCallback((id: number) => {
    setDecided((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const visible = (data?.proposals ?? []).filter((p) => !decided.includes(p.id));

  if (loading) return <LoadingShimmer count={4} />;

  if (error) {
    return error.unconfigured ? (
      <div className="rounded-md border border-border bg-card/40 px-4 py-3 text-sm text-muted-foreground">
        <p className="text-foreground">This instance cannot read the proposal queue.</p>
        <p className="mt-1 text-xs">{error.message}</p>
        <p className="mt-2 text-xs">
          Proposals live in the brain&apos;s own database, which this deployment has not been
          pointed at. The queue itself is unaffected — nothing has been lost — it simply has no
          path to a decision from here.
        </p>
      </div>
    ) : (
      <ErrorState message={error.message} onRetry={() => void load()} />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium tabular-nums text-foreground">
          {data?.counts.pending ?? 0} pending
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {data?.counts.accepted ?? 0} accepted · {data?.counts.rejected ?? 0} rejected
          {data?.counts.superseded ? ` · ${data.counts.superseded} superseded` : ""}
        </span>
        <button
          type="button"
          onClick={() => void load()}
          className="ml-auto rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          Refresh
        </button>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="Nothing pending."
          hint={
            data && data.counts.accepted + data.counts.rejected > 0
              ? "Every proposal in the queue has been decided. New ones arrive when the extractor next proposes claims from your pages."
              : "No proposals have been written yet. They arrive when your brain's extraction cycle proposes claims from your pages."
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((p) => (
            <li key={p.id}>
              <ProposalCard proposal={p} onDecided={onDecided} />
            </li>
          ))}
        </ul>
      )}

      {data?.nextOffset !== null && visible.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Showing {visible.length} of {data?.counts.pending ?? 0} pending. Decide these, then
          refresh for the next page.
        </p>
      ) : null}
    </div>
  );
}
