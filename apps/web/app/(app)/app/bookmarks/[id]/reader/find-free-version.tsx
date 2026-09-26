// SPDX-License-Identifier: MIT
"use client";

/**
 * "Find a free version" button for paywalled captures in Reader Mode.
 * Calls Oscar's POST /api/captures/[id]/find-free-version which returns
 * up to 3 candidate URLs with snippets.
 */

import { useState } from "react";
import { ExternalLink, Search } from "lucide-react";

interface FreeVersion {
  url: string;
  title?: string | null;
  snippet?: string | null;
  source?: string | null;
}

interface FindFreeVersionResponse {
  results?: FreeVersion[];
  error?: string;
}

export function FindFreeVersionButton({ captureId }: { captureId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<FreeVersion[] | null>(null);

  async function handleFind() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/captures/${captureId}/find-free-version`, {
        method: "POST",
      });
      const data = (await res.json()) as FindFreeVersionResponse;
      if (!res.ok) {
        throw new Error(data.error ?? `find_free_version_failed:${res.status}`);
      }
      setResults((data.results ?? []).slice(0, 3));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">Paywalled article</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Search the open web for an accessible mirror or alternate source.
          </p>
        </div>
        <button
          type="button"
          onClick={handleFind}
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded bg-[var(--synthesis)] px-3 py-1.5 text-xs font-medium text-[var(--synthesis-fg)] hover:opacity-90 disabled:opacity-50"
        >
          <Search className="h-3 w-3" />
          {busy ? "Searching…" : "Find a free version"}
        </button>
      </div>

      {error && (
        <p className="mt-3 text-xs text-destructive">{error}</p>
      )}

      {results && results.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">No alternate sources found.</p>
      )}

      {results && results.length > 0 && (
        <ul className="mt-3 space-y-2">
          {results.map((r, i) => (
            <li key={`${r.url}-${i}`}>
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="block rounded border border-border/60 bg-background/40 px-3 py-2 text-sm transition-colors hover:border-[var(--synthesis)]/60"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="truncate font-medium text-[var(--synthesis)]"
                    title={r.title ?? r.url}
                  >
                    {r.title || r.url}
                  </span>
                  <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                </div>
                {r.source && (
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {r.source}
                  </p>
                )}
                {r.snippet && (
                  <p className="mt-1 line-clamp-2 text-xs text-foreground/80">
                    {r.snippet}
                  </p>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
