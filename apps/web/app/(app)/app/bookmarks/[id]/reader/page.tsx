// SPDX-License-Identifier: MIT
// Reader Mode page — rewritten Task B for best-in-class reading experience.
// Renders sanitised readerHtml inside a typography-styled <article>; falls
// back to readerText paragraphs when HTML is unavailable. Auto-fires the
// extraction on first view when the row's reader_state is pending/failed.

import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getAuthUser } from "@/lib/auth/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getUserWorkspaces } from "@/lib/workspace";
import { Bookmark, Clock } from "lucide-react";
import { FindFreeVersionButton } from "./find-free-version";
import { extractReader } from "@/lib/enrichment/reader";
import { ReaderChrome } from "@/components/reader/reader-chrome";
import { sanitiseReaderHtml, estimateReadingMinutes } from "@/lib/reader/sanitise";
import { getUserTimezone } from "@/lib/time/user-tz";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Wrap plain-text fallback into <p> blocks so the prose container still
// gives us paragraph spacing. Each block escapes as a single string —
// dangerouslySetInnerHTML receives a fully-escaped payload.
function textToParagraphHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("\n");
}

export default async function ReaderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const { id } = await params;

  const workspaces = await getUserWorkspaces(user.id);
  const wsIds = new Set(workspaces.map((w) => w.id));

  const [row] = await db
    .select()
    .from(schema.captureSources)
    .where(eq(schema.captureSources.id, id))
    .limit(1);

  if (!row || !wsIds.has(row.workspaceId)) notFound();

  // Auto-fire extraction if the row hasn't been processed yet. extractReader
  // is idempotent (skips fresh rows) and locks via reader_state, so two
  // concurrent /reader visits won't double-fetch.
  if (
    row.kind === "url" &&
    row.url &&
    !row.readerHtml &&
    !row.readerText &&
    !row.extractedText &&
    (row.readerState === "pending" || row.readerState === "failed")
  ) {
    try {
      await extractReader(row.id);
      const refreshed = await db
        .select()
        .from(schema.captureSources)
        .where(eq(schema.captureSources.id, id))
        .limit(1);
      if (refreshed[0]) {
        row.readerHtml = refreshed[0].readerHtml;
        row.readerText = refreshed[0].readerText;
        row.extractedText = refreshed[0].extractedText;
        row.readerState = refreshed[0].readerState;
        row.paywalled = refreshed[0].paywalled;
        row.readMinutes = refreshed[0].readMinutes;
      }
    } catch {
      // Fall through and render the empty-state below.
    }
  }

  const title = row.ogTitle || row.derivedTitle || row.url || "Untitled";
  const capturedRaw = row.bookmarkedAt ?? row.createdAt;
  const userTz = await getUserTimezone();
  const capturedDate = capturedRaw
    ? new Date(capturedRaw).toLocaleDateString("en-US", {
        timeZone: userTz,
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  // Body source preference: sanitised readerHtml → readerText paragraphs →
  // legacy extractedText paragraphs → null (empty-state).
  let bodyHtml: string | null = null;
  if (row.readerHtml && row.readerHtml.trim()) {
    bodyHtml = sanitiseReaderHtml(row.readerHtml);
  } else if (row.readerText && row.readerText.trim()) {
    bodyHtml = textToParagraphHtml(row.readerText);
  } else if (row.extractedText && row.extractedText.trim()) {
    bodyHtml = textToParagraphHtml(row.extractedText);
  }

  const readingMinutes =
    row.readMinutes ??
    (row.readerHtml ? estimateReadingMinutes(row.readerHtml) : null);

  return (
    <main className="min-h-screen bg-background">
      <ReaderChrome
        title={title}
        url={row.url ?? null}
        urlHost={row.urlHost ?? null}
      >
        {/* prose-* override classes live on the <article> in
            components/reader/reader-chrome.tsx so they share specificity
            tier with `prose dark:prose-invert`. This used to be a wrapper
            div here, but `:where(p)`-based prose-invert rules tied the
            wrapper-based overrides and won source-order. */}
        <>
        <div className="not-prose mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-zinc-400 light:text-zinc-600">
          {row.urlHost ? (
            <span className="inline-flex items-center gap-1.5">
              {row.faviconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={row.faviconUrl}
                  alt=""
                  className="h-3.5 w-3.5 rounded-sm"
                />
              ) : null}
              <span className="text-zinc-100 light:text-zinc-900">{row.urlHost}</span>
            </span>
          ) : null}
          {readingMinutes ? (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3 text-zinc-400 light:text-zinc-500" /> {readingMinutes} min read
              </span>
            </>
          ) : null}
          {row.themeLabel ? (
            <>
              <span aria-hidden>·</span>
              <span className="bg-zinc-800 light:bg-zinc-100 text-zinc-300 light:text-zinc-700 rounded-full px-2 py-0.5 text-xs">
                {row.themeLabel}
              </span>
            </>
          ) : null}
          {capturedDate ? (
            <>
              <span aria-hidden>·</span>
              <span>{capturedDate}</span>
            </>
          ) : null}
          {row.evergreen ? (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1 text-emerald-500">
                <Bookmark className="h-3 w-3" /> evergreen
              </span>
            </>
          ) : null}
          {row.paywalled ? (
            <>
              <span aria-hidden>·</span>
              <span className="text-amber-500">paywalled</span>
            </>
          ) : null}
        </div>

        <h1 className="!mb-2">{title}</h1>

        {row.paywalled ? (
          <div className="not-prose mb-6">
            <FindFreeVersionButton captureId={row.id} />
          </div>
        ) : null}

        {row.summary ? (
          <aside className="not-prose mb-8 rounded-lg border border-zinc-800 light:border-zinc-200 bg-zinc-900 light:bg-zinc-100 p-4">
            <div className="mb-2 text-[10px] uppercase tracking-wide text-zinc-400 light:text-zinc-600">
              Abstract
            </div>
            <ul className="space-y-1.5 text-sm">
              {row.summary
                .split("\n")
                .map((l) => l.replace(/^- /, "").trim())
                .filter(Boolean)
                .map((line, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-copper">·</span>
                    <span>{line}</span>
                  </li>
                ))}
            </ul>
          </aside>
        ) : null}

        {row.kindClassified === "video" && row.longSummary ? (
          <aside className="not-prose mb-6 rounded-lg border border-zinc-800 light:border-zinc-200 bg-zinc-900 light:bg-zinc-100 p-4">
            <div className="mb-2 text-[10px] uppercase tracking-wide text-zinc-400 light:text-zinc-600">
              Video digest
            </div>
            <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm">
              {row.longSummary}
            </div>
          </aside>
        ) : null}

        {row.kindClassified === "video" && row.transcript ? (
          <details className="not-prose mb-8 rounded-lg border border-zinc-800 light:border-zinc-200 bg-zinc-950 light:bg-white p-4">
            <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-zinc-400 light:text-zinc-600">
              Transcript ({row.transcriptChars?.toLocaleString() ?? row.transcript.length.toLocaleString()} chars
              {row.transcriptLanguage ? ` · ${row.transcriptLanguage}` : ""}
              {row.transcriptSource ? ` · ${row.transcriptSource}` : ""})
            </summary>
            <div className="mt-3 max-h-[60vh] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-zinc-200 light:text-zinc-800">
              {row.transcript}
            </div>
          </details>
        ) : null}

        {bodyHtml ? (
          <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />
        ) : (
          <EmptyState
            id={id}
            url={row.url ?? null}
            state={row.readerState ?? "pending"}
          />
        )}

        <div className="not-prose mt-12 border-t border-border pt-4 text-[10px] uppercase tracking-wide text-muted-foreground">
          Reader mode · saved snapshot
        </div>
        </>
      </ReaderChrome>
    </main>
  );
}

function EmptyState({
  id,
  url,
  state,
}: {
  id: string;
  url: string | null;
  state: string;
}) {
  return (
    <div className="not-prose rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
      {state === "extracting" ? (
        <>
          <p className="font-medium text-foreground">Extracting reader text…</p>
          <p className="mt-2">
            Reload this page in a few seconds. If the extraction fails the page
            will say so explicitly.
          </p>
          <Link
            href={`/app/bookmarks/${id}/reader`}
            className="mt-3 inline-block text-copper hover:underline"
          >
            Refresh
          </Link>
        </>
      ) : state === "failed" ? (
        <>
          <p className="font-medium text-foreground">
            Could not extract reader text.
          </p>
          <p className="mt-2">
            This page may be paywalled, JavaScript-only, or block bots. Use the
            link below to read it on the source.
          </p>
        </>
      ) : (
        <>
          <p className="font-medium text-foreground">
            Reader content not yet available — try refreshing once enrichment
            completes.
          </p>
          <p className="mt-2">
            The extraction worker will pick this up shortly. You can also open
            the original — that triggers an immediate extract.
          </p>
          <Link
            href={`/app/bookmarks/${id}/reader`}
            className="mt-3 inline-block text-copper hover:underline"
          >
            Refresh
          </Link>
        </>
      )}
      {url ? (
        <p className="mt-3">
          <a
            className="text-copper hover:underline"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open the original →
          </a>
        </p>
      ) : null}
    </div>
  );
}
