// SPDX-License-Identifier: MIT
// Reader chrome — sticky top bar (back / title / font-size / open original)
// plus a 2px scroll-progress bar and a font-size control that persists to
// localStorage. Wraps the article so the prose size class is owned here.

"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

type FontSize = "S" | "M" | "L";

const PROSE_SIZE_CLASS: Record<FontSize, string> = {
  S: "prose-base",
  M: "prose-lg",
  L: "prose-xl",
};

const FONT_SIZE_KEY = "nexalog.reader.fontSize";

function isFontSize(v: string | null): v is FontSize {
  return v === "S" || v === "M" || v === "L";
}

export interface ReaderChromeProps {
  title: string;
  url: string | null;
  urlHost: string | null;
  children: React.ReactNode;
}

export function ReaderChrome({ title, url, urlHost, children }: ReaderChromeProps) {
  const router = useRouter();
  const [fontSize, setFontSizeState] = React.useState<FontSize>("M");
  const [progress, setProgress] = React.useState(0);

  // Hydrate persisted font-size choice once mounted.
  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(FONT_SIZE_KEY);
      if (isFontSize(stored)) setFontSizeState(stored);
    } catch {
      // localStorage may be unavailable (private mode / SSR mismatch); ignore.
    }
  }, []);

  const setFontSize = React.useCallback((next: FontSize) => {
    setFontSizeState(next);
    try {
      window.localStorage.setItem(FONT_SIZE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  // Window-scroll → progress percent. rAF coalesces bursts of scroll events.
  React.useEffect(() => {
    let frame = 0;
    const compute = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const pct = max > 0 ? Math.min(100, Math.max(0, (window.scrollY / max) * 100)) : 0;
      setProgress(pct);
      frame = 0;
    };
    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(compute);
    };
    compute();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  const onBack = React.useCallback(() => {
    // Prefer history.back so the operator returns to whichever bookmarks
    // view they came from (timeline filter, search). Fall back to a hard
    // route when there's no in-app history (deep link, fresh tab).
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/app/bookmarks");
    }
  }, [router]);

  return (
    <>
      <a
        href="#reader-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-1.5 focus:text-sm focus:shadow"
      >
        Skip to article
      </a>

      <header
        className="sticky top-0 z-20 border-b border-zinc-800 light:border-zinc-200 bg-zinc-950/80 light:bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/60 light:supports-[backdrop-filter]:bg-white/60 h-14"
        aria-label="Reader controls"
      >
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-3 sm:px-4">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to bookmarks"
            className="text-zinc-200 light:text-zinc-700 hover:text-white light:hover:text-zinc-900 p-2 rounded-md hover:bg-zinc-800 light:hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <div className="min-w-0 flex-1 text-center">
            <div
              className="text-sm font-medium text-zinc-100 light:text-zinc-900 truncate max-w-[40vw] mx-auto"
              title={title}
            >
              {title}
            </div>
          </div>

          <FontSizeToggle value={fontSize} onChange={setFontSize} />

          {url ? (
            <Link
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open original on ${urlHost ?? "source"}`}
              className="hidden items-center gap-1.5 text-xs text-zinc-400 light:text-zinc-600 hover:text-white light:hover:text-zinc-900 border border-zinc-700 light:border-zinc-200 rounded-md px-2 py-1 sm:inline-flex"
            >
              <span className="max-w-[12ch] truncate">{urlHost ?? "Open"}</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          ) : null}
          {url ? (
            <Link
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open original"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 light:text-zinc-600 hover:text-white light:hover:text-zinc-900 hover:bg-zinc-800 light:hover:bg-zinc-100 sm:hidden"
            >
              <ExternalLink className="h-4 w-4" />
            </Link>
          ) : null}
        </div>
      </header>
      <div
        role="progressbar"
        aria-label="Reading progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
        className="sticky top-14 z-10 h-0.5 w-full bg-zinc-800 light:bg-zinc-200"
      >
        <div
          className="h-full bg-sky-400 light:bg-sky-500 transition-[width] duration-75 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      <article
        id="reader-main"
        className={cn(
          // Default state IS dark in this theme — so `prose-invert` lives
          // on by default; `light:prose` swaps it for the .light theme.
          "prose-invert light:prose mx-auto max-w-prose",
          PROSE_SIZE_CLASS[fontSize],
          // Nexalog is DARK-BY-DEFAULT (see globals.css :root). The
          // base prose-* values below are the dark-mode colors; `light:`
          // variants override them when the `.light` class is applied.
          // Don't use `dark:` here — that only fires under `.dark` which
          // is never set in this theme.
          "prose-headings:text-zinc-50 light:prose-headings:text-zinc-900",
          "prose-p:text-zinc-100 light:prose-p:text-zinc-800",
          "prose-li:text-zinc-100 light:prose-li:text-zinc-800",
          "prose-strong:text-white light:prose-strong:text-zinc-950",
          "prose-em:text-zinc-200 light:prose-em:text-zinc-800",
          "prose-a:text-sky-400 light:prose-a:text-sky-700",
          "prose-a:no-underline hover:prose-a:underline prose-a:underline-offset-2 prose-a:font-medium",
          "prose-code:bg-zinc-800 light:prose-code:bg-zinc-100",
          "prose-code:text-amber-300 light:prose-code:text-amber-800",
          "prose-code:rounded prose-code:px-1.5 prose-code:py-0.5 prose-code:font-medium",
          "prose-code:before:hidden prose-code:after:hidden",
          "prose-pre:bg-zinc-900 light:prose-pre:bg-zinc-50",
          "prose-pre:text-zinc-100 light:prose-pre:text-zinc-900",
          "prose-pre:border prose-pre:border-zinc-800 light:prose-pre:border-zinc-200",
          "prose-pre:rounded-md",
          "prose-pre:prose-code:bg-transparent prose-pre:prose-code:p-0",
          "prose-blockquote:border-l-4 prose-blockquote:border-sky-400 light:prose-blockquote:border-sky-500",
          "prose-blockquote:text-zinc-300 light:prose-blockquote:text-zinc-700",
          "prose-blockquote:not-italic",
          "prose-img:rounded-lg prose-img:shadow-sm",
          "prose-hr:border-zinc-800 light:prose-hr:border-zinc-200",
          "prose-th:text-zinc-50 light:prose-th:text-zinc-900",
          "prose-td:text-zinc-200 light:prose-td:text-zinc-700",
        )}
      >
        {children}
      </article>
    </>
  );
}

function FontSizeToggle({
  value,
  onChange,
}: {
  value: FontSize;
  onChange: (v: FontSize) => void;
}) {
  const opts: FontSize[] = ["S", "M", "L"];
  return (
    <div
      role="radiogroup"
      aria-label="Font size"
      className="inline-flex rounded-md border border-zinc-700 light:border-zinc-200 overflow-hidden"
    >
      {opts.map((o) => {
        const active = o === value;
        return (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={active}
            aria-pressed={active}
            aria-label={`Font size ${o}`}
            onClick={() => onChange(o)}
            className={cn(
              "px-2 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-zinc-100 text-zinc-900 light:bg-zinc-900 light:text-white"
                : "text-zinc-400 light:text-zinc-600 hover:bg-zinc-800 light:hover:bg-zinc-100",
            )}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}
