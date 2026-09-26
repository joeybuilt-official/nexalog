// SPDX-License-Identifier: MIT
"use client";

/**
 * AI-assisted suggestion rail. Synthesis-violet (#7C5CFF) marks
 * system-spoken affordances per UX guidance.
 */

import { Sparkles } from "lucide-react";
import type { SearchSuggestion } from "./types";

interface SuggestionRailProps {
  suggestions: SearchSuggestion[];
  onApply: (s: SearchSuggestion) => void;
}

export function SuggestionRail({ suggestions, onApply }: SuggestionRailProps) {
  if (!suggestions || suggestions.length === 0) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs"
      style={{
        backgroundColor: "var(--synthesis-soft)",
        borderColor: "var(--synthesis)",
      }}
      role="region"
      aria-label="AI suggestions"
    >
      <Sparkles
        className="h-3.5 w-3.5 shrink-0"
        style={{ color: "var(--synthesis)" }}
        aria-hidden
      />
      <span
        className="text-[10px] uppercase tracking-wide"
        style={{ color: "var(--synthesis)" }}
      >
        Suggested
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {suggestions.map((s, i) => (
          <button
            key={`${s.action}-${i}`}
            type="button"
            onClick={() => onApply(s)}
            className="rounded border bg-card/40 px-2 py-1 text-foreground transition-colors hover:bg-card/80"
            style={{ borderColor: "var(--synthesis)" }}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
