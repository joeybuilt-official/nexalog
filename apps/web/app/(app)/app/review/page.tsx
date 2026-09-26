"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { ReviewCard, type ReviewItem } from "@/components/review-card";

export default function ReviewPage() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/review");
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { items: ReviewItem[] };
      setItems(data.items);
      setIdx(0);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleGrade(grade: number) {
    const item = items[idx];
    if (!item || grading) return;
    setGrading(true);
    try {
      await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captureId: item.captureId, grade }),
      });
    } finally {
      setGrading(false);
      setIdx((i) => i + 1);
    }
  }

  const done = !loading && !error && idx >= items.length;
  const current = items[idx];

  return (
    <div className="mx-auto max-w-2xl py-4">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RotateCcw className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Spaced Review</h1>
        </div>
        {!loading && !error && items.length > 0 && (
          <span className="text-sm text-muted-foreground">
            {Math.min(idx + 1, items.length)} / {items.length}
          </span>
        )}
      </div>

      {loading && (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-foreground" />
        </div>
      )}

      {error && (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {done && (
        <div className="flex flex-col items-center gap-4 py-20 text-center">
          <CheckCircle2 className="h-12 w-12 text-green-500" />
          <p className="text-lg font-medium">All caught up!</p>
          <p className="text-sm text-muted-foreground">No items due for review right now.</p>
          <Link href="/app/today" className="mt-2 text-sm underline underline-offset-2">
            Back to Today
          </Link>
        </div>
      )}

      {!loading && !error && !done && current && (
        <ReviewCard item={current} onGrade={handleGrade} disabled={grading} />
      )}
    </div>
  );
}
