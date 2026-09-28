// SPDX-License-Identifier: MIT
"use client";

/**
 * The brain index's type-chip row. Same grammar as the Garden's chips (an
 * include-set, all on by default) with an explicit "All" state, and the same
 * "never a dead control" rule: a chip only renders for a group the list
 * actually contains.
 */

import { BRAIN_GROUP_LABELS, type BrainGroup } from "@/lib/pages/groups";

export function FilterChips({
  groups,
  counts,
  active,
  onChange,
}: {
  /** Groups present in the list, in canonical order. */
  groups: readonly BrainGroup[];
  counts: ReadonlyMap<BrainGroup, number>;
  /** `"all"` or the selected include-set. */
  active: readonly BrainGroup[] | "all";
  onChange: (next: readonly BrainGroup[] | "all") => void;
}) {
  const isAll = active === "all";
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter pages by type">
      <button
        type="button"
        aria-pressed={isAll}
        onClick={() => onChange("all")}
        className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
          isAll
            ? "border-foreground bg-foreground text-background"
            : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
        }`}
      >
        All
      </button>
      {groups.map((group) => {
        const on = !isAll && active.includes(group);
        return (
          <button
            key={group}
            type="button"
            aria-pressed={on}
            onClick={() => {
              const current = isAll ? [] : [...active];
              const next = current.includes(group)
                ? current.filter((g) => g !== group)
                : [...groups].filter((g) => current.includes(g) || g === group);
              // Emptied selection means "no narrowing" — never an empty canvas
              // the reader cannot escape without hunting for the All chip.
              onChange(next.length ? next : "all");
            }}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
              on
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
            }`}
          >
            {BRAIN_GROUP_LABELS[group]}
            <span className="opacity-60">{counts.get(group) ?? 0}</span>
          </button>
        );
      })}
    </div>
  );
}
