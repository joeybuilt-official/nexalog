"use client";

// Phase 11 pass 2 — capture card. Used in bookmarks list, queue, and theme view.

import Link from "next/link";
import { Clock, ExternalLink, BookOpen, Eye, Lock, Sparkles } from "lucide-react";
import { displayTitle } from "@/lib/captures/display";

export interface CaptureCardData {
  id: string;
  url: string | null;
  ogTitle?: string | null;
  title?: string | null;
  derivedTitle?: string | null;
  urlHost?: string | null;
  host?: string | null;
  kindClassified?: string | null;
  kind?: string | null;
  videoId?: string | null;
  createdAt: string | Date;
  openedAt?: string | Date | null;
  evergreen?: boolean | null;
  readMinutes?: number | null;
  watchMinutes?: number | null;
  summary?: string | null;
  paywalled?: boolean | null;
  ogSiteName?: string | null;
}

export function CaptureCard({
  row,
  reason,
}: {
  row: CaptureCardData;
  reason?: string;
}) {
  // Always go through displayTitle — never trust raw ogTitle / urlHost /
  // url, since those leak video ids, raw filenames, and full URLs into
  // the UI (production bug Apr 2026).
  const title = displayTitle({
    ...row,
    urlHost: row.urlHost ?? row.host ?? null,
  });
  const host = row.urlHost ?? row.host ?? "";
  const kind = row.kindClassified ?? row.kind ?? null;
  const opened = !!row.openedAt;
  const created = typeof row.createdAt === "string" ? new Date(row.createdAt) : row.createdAt;

  function markOpened() {
    // Fire-and-forget; the <a> handles navigation natively so the click
    // isn't popup-blocked and is keyboard/middle-click discoverable.
    fetch(`/api/captures/${row.id}/open`, { method: "POST" }).catch(() => {
      /* ignore */
    });
  }

  return (
    <div className="group rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/20">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {kind ?? "link"}
            </span>
            {row.evergreen ? (
              <span className="inline-flex items-center gap-1 rounded border border-emerald-500/40 px-1.5 py-0.5 text-[10px] text-emerald-500">
                <Sparkles className="h-2.5 w-2.5" /> evergreen
              </span>
            ) : null}
            {opened ? (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <Eye className="h-2.5 w-2.5" /> opened
              </span>
            ) : null}
            {row.paywalled ? (
              <span className="inline-flex items-center gap-1 rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] text-amber-500">
                <Lock className="h-2.5 w-2.5" /> paywall
              </span>
            ) : null}
          </div>

          <h3
            className="mt-1 line-clamp-2 break-words font-medium leading-snug text-foreground"
            title={title}
          >
            {title}
          </h3>
          <div className="mt-0.5 truncate text-xs text-muted-foreground" title={host || undefined}>{host}</div>

          {row.summary ? (
            <ul className="mt-3 space-y-1 text-sm text-foreground/90">
              {row.summary
                .split("\n")
                .map((l) => l.replace(/^- /, "").trim())
                .filter(Boolean)
                .slice(0, 3)
                .map((line, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-copper" />
                    <span className="leading-snug">{line}</span>
                  </li>
                ))}
            </ul>
          ) : null}

          {reason ? (
            <p className="mt-3 text-xs text-copper">{reason}</p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>{created.toLocaleDateString()}</span>
            {row.readMinutes ? (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" /> {row.readMinutes} min read
              </span>
            ) : null}
            {row.watchMinutes ? (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" /> {row.watchMinutes} min watch
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-border pt-3">
        {row.url ? (
          <a
            href={row.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={markOpened}
            className="inline-flex items-center gap-1.5 rounded bg-foreground px-2.5 py-1 text-xs font-medium text-background hover:opacity-90"
          >
            <ExternalLink className="h-3 w-3" /> Open
          </a>
        ) : null}
        <Link
          href={`/app/bookmarks/${row.id}/reader`}
          className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <BookOpen className="h-3 w-3" /> Reader
        </Link>
      </div>
    </div>
  );
}
