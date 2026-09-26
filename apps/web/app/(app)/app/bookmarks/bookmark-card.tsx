"use client";

import { useState } from "react";
import { ExternalLink, Trash2, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConfirmButton } from "@/components/confirm-button";

interface BookmarkTag {
  id: string;
  name: string;
  color: string | null;
}

interface Bookmark {
  id: string;
  url: string | null;
  content: string;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  faviconUrl: string | null;
  createdAt: Date | string;
  tags: BookmarkTag[];
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function BookmarkCard({
  bookmark,
  onDelete,
}: {
  bookmark: Bookmark;
  onDelete: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [faviconError, setFaviconError] = useState(false);

  const url = bookmark.url ?? bookmark.content;
  const domain = getDomain(url);
  const title = bookmark.ogTitle ?? domain;
  const hasImage = bookmark.ogImage && !imgError;

  async function handleDelete() {
    await fetch(`/api/bookmarks/${bookmark.id}`, { method: "DELETE" });
    onDelete(bookmark.id);
  }

  function trackOpen() {
    fetch(`/api/captures/${bookmark.id}/open`, { method: "POST" }).catch(() => null);
  }

  // Card click toggles the actions overlay. The Open button is the only path
  // to actually navigate — this stops mobile taps from immediately opening
  // the link in a new tab without a chance to inspect / delete.
  function handleCardClick() {
    setHovered((v) => !v);
  }

  return (
    <div
      className="group relative rounded-lg border border-border bg-card overflow-hidden transition-all hover:border-primary/40 hover:shadow-md cursor-pointer"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={handleCardClick}
    >
      {/* OG Image */}
      <div className="relative aspect-video w-full overflow-hidden bg-muted">
        {hasImage ? (
          <img
            src={bookmark.ogImage!}
            alt={title}
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
            loading="lazy"
            decoding="async"
            onError={() => setImgError(true)}
          />
        ) : (
          <div
            className="h-full w-full flex items-center justify-center"
            style={{
              background: `linear-gradient(135deg, #2a2520 0%, #1a1816 50%, #2a2015 100%)`,
            }}
          >
            <Globe className="h-8 w-8 text-muted-foreground/30" />
          </div>
        )}

        {/* Actions overlay — shown on hover (desktop) or after a tap (mobile) */}
        {hovered && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center gap-2 transition-opacity">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                e.stopPropagation();
                trackOpen();
              }}
              className="flex items-center gap-1.5 rounded-lg bg-white/90 px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-white transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open
            </a>
            <ConfirmButton
              onConfirm={handleDelete}
              className="flex items-center gap-1.5 rounded-lg bg-red-500/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 transition-colors"
              armedClassName="ring-2 ring-white"
              confirmLabel={<><Trash2 className="h-3.5 w-3.5 inline mr-1" />Confirm delete?</>}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </ConfirmButton>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-3">
        {/* Domain row */}
        <div className="flex items-center gap-1.5 mb-1.5">
          {!faviconError ? (
            <img
              src={bookmark.faviconUrl ?? `https://${domain}/favicon.ico`}
              alt=""
              className="h-4 w-4 rounded-sm object-contain"
              referrerPolicy="no-referrer"
              loading="lazy"
              onError={() => setFaviconError(true)}
            />
          ) : (
            <Globe className="h-4 w-4 text-muted-foreground/50 shrink-0" />
          )}
          <span className="text-[11px] text-muted-foreground truncate">{domain}</span>
        </div>

        {/* Title */}
        <p className="text-sm font-medium text-foreground line-clamp-2 leading-snug mb-1">
          {title}
        </p>

        {/* Description */}
        {bookmark.ogDescription && (
          <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
            {bookmark.ogDescription}
          </p>
        )}

        {/* Tags + date */}
        <div className="flex items-center justify-between mt-2 gap-2">
          <div className="flex flex-wrap gap-1 min-w-0">
            {bookmark.tags.slice(0, 2).map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-medium"
                style={{
                  backgroundColor: (tag.color ?? "#6366f1") + "22",
                  color: tag.color ?? "#6366f1",
                }}
              >
                {tag.name}
              </span>
            ))}
          </div>
          <span className="text-[10px] text-muted-foreground shrink-0 whitespace-nowrap">
            {formatDate(bookmark.createdAt)}
          </span>
        </div>
      </div>
    </div>
  );
}

export function BookmarkRow({
  bookmark,
  onDelete,
}: {
  bookmark: Bookmark;
  onDelete: (id: string) => void;
}) {
  const [faviconError, setFaviconError] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);

  const url = bookmark.url ?? bookmark.content;
  const domain = getDomain(url);
  const title = bookmark.ogTitle ?? domain;

  async function handleDelete() {
    await fetch(`/api/bookmarks/${bookmark.id}`, { method: "DELETE" });
    onDelete(bookmark.id);
  }

  function trackOpen() {
    fetch(`/api/captures/${bookmark.id}/open`, { method: "POST" }).catch(() => null);
  }

  return (
    <div
      className={`group flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 hover:border-primary/40 hover:bg-muted/30 transition-all cursor-pointer ${actionsOpen ? "border-primary/40 bg-muted/30" : ""}`}
      onClick={() => setActionsOpen((v) => !v)}
    >
      {/* Favicon */}
      <div className="shrink-0">
        {!faviconError ? (
          <img
            src={bookmark.faviconUrl ?? `https://${domain}/favicon.ico`}
            alt=""
            className="h-5 w-5 rounded-sm object-contain"
            referrerPolicy="no-referrer"
            loading="lazy"
            onError={() => setFaviconError(true)}
          />
        ) : (
          <Globe className="h-5 w-5 text-muted-foreground/50" />
        )}
      </div>

      {/* Title + URL */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground truncate">{title}</p>
        <p className="text-xs text-muted-foreground truncate">{url}</p>
      </div>

      {/* Domain badge */}
      <span className="hidden md:inline-flex shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
        {domain}
      </span>

      {/* Tags */}
      <div className="hidden lg:flex shrink-0 items-center gap-1">
        {bookmark.tags.slice(0, 2).map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-medium"
            style={{
              backgroundColor: (tag.color ?? "#6366f1") + "22",
              color: tag.color ?? "#6366f1",
            }}
          >
            {tag.name}
          </span>
        ))}
      </div>

      {/* Date */}
      <span className="shrink-0 text-xs text-muted-foreground">{formatDate(bookmark.createdAt)}</span>

      {/* Actions — visible on hover (desktop) or after a tap (mobile) */}
      <div className={`flex items-center gap-1 transition-opacity ${actionsOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            e.stopPropagation();
            trackOpen();
          }}
          className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
        <ConfirmButton
          onConfirm={handleDelete}
          className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
          confirmLabel={<span className="text-[10px] font-bold text-destructive px-1">Confirm?</span>}
        >
          <Trash2 className="h-4 w-4" />
        </ConfirmButton>
      </div>
    </div>
  );
}
