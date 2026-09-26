// SPDX-License-Identifier: MIT
"use client";

/**
 * EmptyState / ErrorState / LoadingShimmer — kept in one file because each
 * is small and they share visual grammar.
 */

import { AlertCircle, Inbox, Loader2 } from "lucide-react";

export function EmptyState({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-border bg-card/30 px-6 py-12 text-center">
      <Inbox className="mb-3 h-6 w-6 text-muted-foreground" aria-hidden />
      <p className="text-sm text-foreground">{title}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground">
      <AlertCircle className="h-4 w-4 text-destructive" aria-hidden />
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          type="button"
          className="rounded border border-destructive/50 px-2 py-1 text-xs hover:bg-destructive/20"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function LoadingShimmer({ count = 6 }: { count?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading results</span>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-lg border border-border bg-card/40"
        />
      ))}
    </div>
  );
}

export function InlineLoading() {
  return (
    <div className="flex items-center justify-center py-6 text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
    </div>
  );
}
