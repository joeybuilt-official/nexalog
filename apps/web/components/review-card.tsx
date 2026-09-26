"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface ReviewItem {
  id: string;
  captureId: string;
  title: string;
  url?: string | null;
  host?: string | null;
  summary?: string | null;
  kind?: string | null;
  themeLabel?: string | null;
  isNew?: boolean;
}

const GRADES: { label: string; grade: number; variant: "destructive" | "outline" | "secondary" | "default" }[] = [
  { label: "Again", grade: 0, variant: "destructive" },
  { label: "Hard", grade: 1, variant: "outline" },
  { label: "Good", grade: 3, variant: "secondary" },
  { label: "Easy", grade: 5, variant: "default" },
];

export function ReviewCard({
  item,
  onGrade,
  disabled = false,
}: {
  item: ReviewItem;
  onGrade: (grade: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-6 shadow-sm flex flex-col gap-4")}>
      {/* Badges */}
      <div className="flex flex-wrap gap-2">
        {item.isNew && (
          <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            New
          </span>
        )}
        {item.kind && (
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
            {item.kind}
          </span>
        )}
        {item.themeLabel && (
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
            {item.themeLabel}
          </span>
        )}
      </div>

      {/* Title */}
      <div>
        <h2 className="text-lg font-semibold leading-snug">{item.title}</h2>
        {item.host && (
          <p className="mt-0.5 text-xs text-muted-foreground">{item.host}</p>
        )}
      </div>

      {/* Summary */}
      {item.summary && (
        <p className="line-clamp-3 text-sm text-muted-foreground">{item.summary}</p>
      )}

      {/* Grade buttons */}
      <div className="flex flex-wrap gap-2 pt-2">
        {GRADES.map(({ label, grade, variant }) => (
          <Button
            key={grade}
            variant={variant}
            size="sm"
            disabled={disabled}
            onClick={() => onGrade(grade)}
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}
