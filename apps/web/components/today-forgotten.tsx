// SPDX-License-Identifier: MIT
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { usePeek } from "./peek-context";

type Item = {
  id: string;
  url?: string | null;
  title?: string | null;
  host?: string | null;
  reason?: string | null;
};

export function TodayForgotten() {
  const [items, setItems] = useState<Item[] | null>(null);
  const { open } = usePeek();

  useEffect(() => {
    let alive = true;
    fetch("/api/queue/forgotten?n=3")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { items?: Item[] }) => {
        if (alive) setItems(d.items ?? []);
      })
      .catch(() => {
        if (alive) setItems([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (items === null || items.length === 0) return null;

  return (
    <section
      aria-label="Forgotten"
      className="mb-6 rounded-lg border bg-card p-4"
    >
      <h2 className="mb-3 text-sm font-semibold">Forgotten</h2>
      <ul className="space-y-2">
        {items.map((it) => {
          const href = it.url ?? `/app/bookmarks/${it.id}/reader`;
          const title = it.title?.trim() || it.host || it.url || "Untitled";
          return (
            <li key={it.id} className="flex items-center gap-2 text-sm">
              <Link href={href} className="hover:underline flex-1 min-w-0 truncate">
                {title}
              </Link>
              {it.reason ? (
                <span className="text-xs text-muted-foreground shrink-0">
                  {it.reason}
                </span>
              ) : null}
              <button
                onClick={() =>
                  open({ type: "queue", id: it.id, title: title ?? "", url: it.url, reason: it.reason })
                }
                className="shrink-0 rounded p-0.5 hover:bg-muted text-muted-foreground"
                aria-label="Peek"
              >
                <Eye className="h-3.5 w-3.5" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
