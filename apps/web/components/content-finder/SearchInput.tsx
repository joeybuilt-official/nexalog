// SPDX-License-Identifier: MIT
"use client";

import { useEffect, useRef } from "react";
import { Search, Loader2, X } from "lucide-react";

interface SearchInputProps {
  value: string;
  onChange: (v: string) => void;
  loading?: boolean;
  placeholder?: string;
  /** Auto-focus on mount. */
  autoFocus?: boolean;
  /** Called on Escape. */
  onEscape?: () => void;
}

export function SearchInput({
  value,
  onChange,
  loading,
  placeholder = "Search everything…",
  autoFocus,
  onEscape,
}: SearchInputProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  // Slash to focus when nothing else has focus
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA" &&
        !(document.activeElement as HTMLElement | null)?.isContentEditable
      ) {
        e.preventDefault();
        ref.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="group relative flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 transition-colors focus-within:border-foreground/40">
      <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            if (value) {
              e.preventDefault();
              onChange("");
            } else {
              onEscape?.();
            }
          }
        }}
        placeholder={placeholder}
        aria-label="Search"
        className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />
      ) : value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : (
        <kbd className="hidden rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
          /
        </kbd>
      )}
    </div>
  );
}
