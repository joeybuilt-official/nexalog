// SPDX-License-Identifier: MIT
"use client";

/**
 * The bookmark list card — the canonical card grammar for the
 * /app/bookmarks list. Replaces the older orange-pill `CaptureCard`
 * for this surface.
 *
 * Three density variants:
 *
 *   compact  -> single-line row: favicon · title · domain · age · actions
 *   standard -> grid card: favicon + title + 1-line theme + age + actions
 *   rich     -> grid card with og image hero + favicon + title + snippet
 *
 * Hover surfaces an action toolbar (Open, Reader, Archive, Copy URL).
 * Keyboard shortcuts (when card is focused via tab):
 *   o   = open
 *   r   = reader
 *   c   = copy URL
 *   ⌫   = archive (two-step via ConfirmButton)
 *   ␣   = toggle selection (set-of-selected-ids — bulk actions
 *          deferred to a follow-up commit)
 *
 * Color discipline (CLAUDE.md global rule + nexalog AGENTS.md):
 *   text-foreground / text-muted-foreground / bg-card / border-border.
 *   Copper (--primary, --ring) appears only in focus and selection
 *   ring states, never as a content meta label.
 */

import Link from "next/link";
import { useCallback, useState } from "react";
import {
  ExternalLink,
  BookOpen,
  Trash2,
  Copy,
  Check,
  Globe,
  Lock,
  Sparkles,
  Eye,
  Clock,
  Video,
  MessageSquare,
  FileText,
  Library,
  Home as HomeIcon,
} from "lucide-react";
import { ConfirmButton } from "@/components/confirm-button";
import { cn } from "@/lib/utils";
import {
  displayDomain,
  displayFavicon,
  displayThumbnail,
  displayTitle,
  displaySummary,
} from "@/lib/captures/display";
import type { BookmarkDensity } from "./density";
import type { SearchResult, ResultKind } from "@/components/content-finder";
import { captureReaderHref } from "@/lib/search/result-href";

interface BookmarkCardProps {
  result: SearchResult;
  density: BookmarkDensity;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}

function formatAge(createdAt: string | Date): string {
  const d = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  const ms = Date.now() - d.getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return "today";
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

/**
 * Inline icon render for a result's kind. Inlined (not returning a
 * component) so the React Compiler `static-components` rule doesn't
 * complain about a dynamic component binding being created during
 * render.
 */
function KindIconFor({
  kind,
  className,
  size,
}: {
  kind: ResultKind;
  className?: string;
  size?: number;
}) {
  switch (kind) {
    case "video":
      return <Video className={className} size={size} />;
    case "social":
      return <MessageSquare className={className} size={size} />;
    case "article":
      return <FileText className={className} size={size} />;
    case "reference":
      return <Library className={className} size={size} />;
    case "homepage":
      return <HomeIcon className={className} size={size} />;
    case "note":
      return <FileText className={className} size={size} />;
    default:
      return <Globe className={className} size={size} />;
  }
}

async function trackOpen(id: string) {
  try {
    await fetch(`/api/captures/${id}/open`, { method: "POST" });
  } catch {
    /* ignore */
  }
}

/** Route an external image through the same-origin streaming proxy. */
function proxiedImage(src: string): string {
  return `/api/img?url=${encodeURIComponent(src)}`;
}

export function BookmarkCard({
  result,
  density,
  selected,
  onToggleSelect,
}: BookmarkCardProps) {
  const url = result.url ?? "";
  // Display helpers (lib/captures/display.ts) — pure fallbacks. Safe to
  // call with the SearchResult shape; the helpers ignore unknown fields.
  const row = {
    url: result.url,
    ogTitle: result.title,
    ogImage: result.ogImage,
    faviconUrl: result.faviconUrl,
    summary: result.summary,
    kindClassified: result.kind,
    urlHost: result.urlHost,
  };
  const title = displayTitle(row) || result.title || "Untitled";
  const host = displayDomain(row);
  const faviconSrc = displayFavicon(row);
  const thumbnailSrc = displayThumbnail(row);
  const summary = result.snippet ?? displaySummary(row);
  const opened = !!result.openedAt;
  const [copied, setCopied] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [imgProxied, setImgProxied] = useState(false);
  const [faviconError, setFaviconError] = useState(false);
  const [faviconProxied, setFaviconProxied] = useState(false);
  const [archived, setArchived] = useState(false);

  const handleOpen = useCallback(() => {
    void trackOpen(result.id);
    if (url) window.open(url, "_blank", "noreferrer");
  }, [result.id, url]);

  const handleCopy = useCallback(async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }, [url]);

  const handleArchive = useCallback(async () => {
    // The bookmarks DELETE endpoint serves as archive (soft-delete) for
    // this surface. Remove optimistically only on success; on failure the
    // card stays in place so the user can retry (no false "removed" state).
    try {
      const res = await fetch(`/api/bookmarks/${result.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setArchived(true);
    } catch {
      /* keep the card visible so the archive can be retried */
    }
  }, [result.id]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      // Don't intercept if focus is on a button inside the card —
      // those have their own click semantics.
      if ((e.target as HTMLElement).closest("button, a, input, textarea")) return;
      switch (e.key) {
        case "o":
        case "O":
          e.preventDefault();
          handleOpen();
          break;
        case "r":
        case "R":
          e.preventDefault();
          // The server decides the route: a brain hit's id is a slug, so the
          // reader route cannot be derived from `result.id` alone.
          window.location.href =
            captureReaderHref(result.id, result.href) ?? `/app/bookmarks/${result.id}`;
          break;
        case "c":
        case "C":
          e.preventDefault();
          void handleCopy();
          break;
        case " ":
          e.preventDefault();
          onToggleSelect(result.id);
          break;
      }
    },
    [handleOpen, handleCopy, onToggleSelect, result]
  );

  // Favicon JSX inlined per call site below — React Compiler's
  // `static-components` rule rejects in-render component declarations.
  const renderFavicon = (size: number): React.ReactNode =>
    !faviconError && faviconSrc ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        key="favicon"
        src={faviconProxied ? proxiedImage(faviconSrc!) : faviconSrc}
        alt=""
        className="rounded-sm object-contain"
        style={{ width: size, height: size }}
        referrerPolicy="no-referrer"
        loading="lazy"
        onError={() => (faviconProxied ? setFaviconError(true) : setFaviconProxied(true))}
      />
    ) : (
      <KindIconFor
        key="kind"
        kind={result.kind}
        className="text-muted-foreground"
        size={size}
      />
    );

  if (archived) return null;

  // ─── Compact ───────────────────────────────────────────────────
  if (density === "compact") {
    return (
      <article
        data-bookmark-id={result.id}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className={cn(
          "group flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2 transition-colors hover:bg-card/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          selected && "ring-2 ring-ring"
        )}
      >
        <span className="shrink-0">
          {renderFavicon(16)}
        </span>

        <h3
          className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
          title={title}
        >
          {title}
        </h3>

        <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
          <KindIconFor kind={result.kind} className="h-3 w-3" />
          <span className="max-w-[12rem] truncate">{host}</span>
        </span>

        {result.evergreen && (
          <Sparkles
            className="hidden h-3 w-3 shrink-0 text-muted-foreground md:inline"
            aria-label="evergreen"
          />
        )}
        {result.paywalled && (
          <Lock
            className="hidden h-3 w-3 shrink-0 text-muted-foreground md:inline"
            aria-label="paywalled"
          />
        )}
        {opened && (
          <Eye
            className="hidden h-3 w-3 shrink-0 text-muted-foreground md:inline"
            aria-label="opened"
          />
        )}

        <span
          className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
          title={new Date(result.createdAt).toLocaleString()}
        >
          {formatAge(result.createdAt)}
        </span>

        <ActionToolbar
          result={result}
          copied={copied}
          onOpen={handleOpen}
          onCopy={handleCopy}
          onArchive={handleArchive}
          variant="icon"
        />
      </article>
    );
  }

  // ─── Rich ──────────────────────────────────────────────────────
  if (density === "rich") {
    const hasImage = thumbnailSrc && !imgError;
    return (
      <article
        data-bookmark-id={result.id}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className={cn(
          "group flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          selected && "ring-2 ring-ring"
        )}
      >
        <div className="relative aspect-[16/9] w-full overflow-hidden bg-muted">
          {hasImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imgProxied ? proxiedImage(thumbnailSrc!) : thumbnailSrc!}
              alt=""
              className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
              loading="lazy"
              referrerPolicy="no-referrer"
              decoding="async"
              onError={() => (imgProxied ? setImgError(true) : setImgProxied(true))}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <KindIconFor kind={result.kind} className="h-8 w-8 text-muted-foreground/30" />
            </div>
          )}
          <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-2">
            <span className="inline-flex items-center gap-1 rounded bg-background/80 px-1.5 py-0.5 text-[10px] text-muted-foreground backdrop-blur-sm">
              <KindIconFor kind={result.kind} className="h-3 w-3" />
              <span className="max-w-[12rem] truncate">{host}</span>
            </span>
            <span
              className="rounded bg-background/80 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground backdrop-blur-sm"
              title={new Date(result.createdAt).toLocaleString()}
            >
              {formatAge(result.createdAt)}
            </span>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-2 p-3">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">
              {renderFavicon(14)}
            </span>
            <h3
              className="line-clamp-2 break-words text-base font-medium leading-snug text-foreground"
              title={title}
            >
              {title}
            </h3>
          </div>

          {summary && (
            <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
              {summary}
            </p>
          )}

          <BadgeRow result={result} />

          <div className="mt-auto flex items-center gap-2 pt-1">
            <ActionToolbar
              result={result}
              copied={copied}
              onOpen={handleOpen}
              onCopy={handleCopy}
              onArchive={handleArchive}
              variant="full"
            />
          </div>
        </div>
      </article>
    );
  }

  // ─── Standard (default) ────────────────────────────────────────
  return (
    <article
      data-bookmark-id={result.id}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={cn(
        "group flex h-full flex-col gap-2 rounded-lg border border-border bg-card p-3 transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected && "ring-2 ring-ring"
      )}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0">
          {renderFavicon(14)}
        </span>
        <span
          className="inline-flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground"
          title={host}
        >
          <KindIconFor kind={result.kind} className="h-3 w-3 shrink-0" />
          <span className="truncate">{host}</span>
        </span>
        <span
          className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground"
          title={new Date(result.createdAt).toLocaleString()}
        >
          {formatAge(result.createdAt)}
        </span>
      </div>

      <h3
        className="line-clamp-2 break-words text-sm font-medium leading-snug text-foreground"
        title={title}
      >
        {title}
      </h3>

      {result.themeLabel && (
        <p
          className="truncate text-xs text-muted-foreground"
          title={result.themeLabel}
        >
          <span className="text-foreground/80">Theme</span>
          <span className="mx-1 text-muted-foreground/60">·</span>
          {result.themeLabel}
        </p>
      )}

      <BadgeRow result={result} />

      <div className="mt-auto flex items-center gap-2 pt-1">
        <ActionToolbar
          result={result}
          copied={copied}
          onOpen={handleOpen}
          onCopy={handleCopy}
          onArchive={handleArchive}
          variant="full"
        />
      </div>
    </article>
  );
}

/**
 * Badge row — small muted icons for evergreen / paywall / opened /
 * read-time. Replaces the old colored pill grammar with a single
 * monochrome row.
 */
function BadgeRow({ result }: { result: SearchResult }) {
  const items: Array<{ icon: React.ComponentType<{ className?: string }>; label: string }> = [];
  if (result.evergreen) items.push({ icon: Sparkles, label: "evergreen" });
  if (result.paywalled) items.push({ icon: Lock, label: "paywall" });
  if (result.openedAt) items.push({ icon: Eye, label: "opened" });
  if (result.readMinutes)
    items.push({
      icon: Clock,
      label: `${result.readMinutes} min read`,
    });
  if (result.watchMinutes)
    items.push({
      icon: Clock,
      label: `${result.watchMinutes} min watch`,
    });

  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {items.map((it, i) => {
        const Icon = it.icon;
        return (
          <span key={i} className="inline-flex items-center gap-1">
            <Icon className="h-3 w-3 shrink-0" aria-hidden />
            <span>{it.label}</span>
          </span>
        );
      })}
    </div>
  );
}

/**
 * Hover/focus action toolbar. Two visual variants:
 *   icon -> compact icon-only buttons (used in compact density rows)
 *   full -> Open + Reader prominent, secondary actions on hover
 *
 * Archive is destructive → routed through `ConfirmButton`
 * (canonical confirm primitive across Joeybuilt apps).
 */
function ActionToolbar({
  result,
  copied,
  onOpen,
  onCopy,
  onArchive,
  variant,
}: {
  result: SearchResult;
  copied: boolean;
  onOpen: () => void;
  onCopy: () => void | Promise<void>;
  onArchive: () => void | Promise<void>;
  variant: "icon" | "full";
}) {
  // Server-decided route. A brain hit's id is a slug, so the reader route
  // cannot be derived from `result.id`; only a row whose id is genuinely a
  // capture uuid falls back to it, and a row with neither gets no control at
  // all rather than a link to a page that will not resolve.
  const readerHref = captureReaderHref(result.id, result.href);
  const readerLabel = result.href?.startsWith("/app/brain/") ? "Open page" : "Reader";

  if (variant === "icon") {
    return (
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <IconBtn label="Open" onClick={onOpen} icon={ExternalLink} />
        {readerHref ? (
          <Link
            href={readerHref}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={readerLabel}
            title={readerLabel}
          >
            <BookOpen className="h-4 w-4" aria-hidden />
          </Link>
        ) : null}
        <IconBtn
          label={copied ? "Copied" : "Copy URL"}
          onClick={() => void onCopy()}
          icon={copied ? Check : Copy}
        />
        <ConfirmButton
          onConfirm={onArchive}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
          confirmLabel={
            <span className="text-[10px] font-bold text-destructive px-1">
              Confirm?
            </span>
          }
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </ConfirmButton>
      </div>
    );
  }

  return (
    <div className="flex w-full items-center gap-1.5">
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex items-center gap-1.5 rounded bg-foreground px-2.5 py-1 text-xs font-medium text-background transition-opacity hover:opacity-90"
      >
        <ExternalLink className="h-3 w-3" aria-hidden />
        Open
      </button>
      {readerHref ? (
        <Link
          href={readerHref}
          className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <BookOpen className="h-3 w-3" aria-hidden />
          {readerLabel}
        </Link>
      ) : null}

      <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <IconBtn
          label={copied ? "Copied" : "Copy URL"}
          onClick={() => void onCopy()}
          icon={copied ? Check : Copy}
        />
        <ConfirmButton
          onConfirm={onArchive}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
          confirmLabel={
            <span className="text-[10px] font-bold text-destructive px-1">
              Confirm?
            </span>
          }
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </ConfirmButton>
      </div>
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  icon: Icon,
}: {
  label: string;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
