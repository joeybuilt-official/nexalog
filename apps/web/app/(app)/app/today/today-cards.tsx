// SPDX-License-Identifier: MIT
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Archive,
  Loader2,
  Clock,
  Bookmark,
  Inbox,
} from "lucide-react";
import { ConfirmButton } from "@/components/confirm-button";
import type {
  StaleCandidate,
  ContinueItem,
  RecentSave,
} from "@/lib/today/cards-data";

interface TodayCardsProps {
  continueItems: ContinueItem[];
  recentSaves: RecentSave[];
  triageCount: number;
  goneStale: StaleCandidate[];
  workspaceId: string;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function TodayCards(props: TodayCardsProps) {
  const { continueItems, recentSaves, triageCount, goneStale } = props;

  return (
    <div className="space-y-6">
      {triageCount > 0 && (
        <Link
          href="/app/inbox"
          className="flex items-center justify-between rounded-lg border border-border bg-card/50 px-4 py-3 text-sm transition-colors hover:border-copper"
        >
          <span className="flex items-center gap-2">
            <Inbox className="h-4 w-4 text-primary" />
            <span className="font-medium">{triageCount}</span>
            <span className="text-muted-foreground">
              saved {triageCount === 1 ? "link is" : "links are"} waiting to be triaged
            </span>
          </span>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      )}

      <section className="grid gap-4 lg:grid-cols-2">
        <ContinueCard items={continueItems} />
        <RecentSavesCard items={recentSaves} />
        <GoneStaleCard items={goneStale} />
      </section>
    </div>
  );
}

function ContinueCard({ items }: { items: ContinueItem[] }) {
  return (
    <CardShell
      title="Pick up where you left off"
      icon={<Clock className="h-4 w-4" />}
      hint="Notes you touched most recently"
      seeAllHref="/app/notes"
    >
      {items.length === 0 ? (
        <EmptyState>No notes yet. Start writing and they&apos;ll show up here.</EmptyState>
      ) : (
        <ul className="space-y-1">
          {items.map((n) => (
            <li key={n.id}>
              <Link
                href={`/app/notes/${n.id}`}
                className="block rounded-md border border-border bg-background/40 p-2 transition-colors hover:border-copper"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">
                    {n.title || n.snippet || "Untitled note"}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {relativeTime(n.updatedAt)}
                  </span>
                </div>
                {n.title && n.snippet && (
                  <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{n.snippet}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  );
}

function RecentSavesCard({ items }: { items: RecentSave[] }) {
  return (
    <CardShell
      title="Recently saved"
      icon={<Bookmark className="h-4 w-4" />}
      hint="Links you bookmarked lately"
      seeAllHref="/app/bookmarks"
    >
      {items.length === 0 ? (
        <EmptyState>Nothing saved yet. Capture a link to get started.</EmptyState>
      ) : (
        <ul className="space-y-1">
          {items.map((r) => (
            <li key={r.id}>
              <a
                href={r.url ?? undefined}
                target={r.url ? "_blank" : undefined}
                rel="noreferrer"
                className="block rounded-md border border-border bg-background/40 p-2 transition-colors hover:border-copper"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">
                    {r.title || r.urlHost || r.url || "Untitled link"}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {relativeTime(r.savedAt)}
                  </span>
                </div>
                {r.urlHost && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{r.urlHost}</p>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  );
}

function CardShell({
  title,
  icon,
  hint,
  seeAllHref,
  className,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  hint?: string;
  seeAllHref?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <article
      className={`flex min-h-[12rem] flex-col rounded-lg border border-border bg-card/50 p-4 ${className ?? ""}`}
    >
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        {seeAllHref && (
          <Link
            href={seeAllHref}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            See all
            <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </header>
      {hint && <p className="mb-2 text-xs text-muted-foreground">{hint}</p>}
      <div className="flex-1">{children}</div>
    </article>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border/60 bg-background/30 p-3 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}

function GoneStaleCard({ items }: { items: StaleCandidate[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  async function archive(id: string) {
    setPending(id);
    try {
      const res = await fetch(`/api/captures/${id}/archive`, { method: "POST" });
      if (res.ok) router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <CardShell
      title="Forgotten gems"
      icon={<Archive className="h-4 w-4" />}
      hint="Saved a while ago, never opened — revisit or clear"
      seeAllHref="/app/inbox"
    >
      {items.length === 0 ? (
        <EmptyState>Nothing waiting. Your hopper is fresh.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {items.slice(0, 3).map((it) => (
            <li
              key={it.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/40 p-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {it.ogTitle || it.url || "Untitled link"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {it.urlHost ?? ""}
                  {it.stalenessReason ? ` · ${it.stalenessReason}` : ""}
                </p>
              </div>
              <ConfirmButton
                onConfirm={() => archive(it.id)}
                disabled={pending === it.id}
                className="shrink-0 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                confirmLabel={
                  <span className="text-[11px] font-bold text-destructive">
                    Click again to archive
                  </span>
                }
              >
                {pending === it.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Archive"}
              </ConfirmButton>
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  );
}
