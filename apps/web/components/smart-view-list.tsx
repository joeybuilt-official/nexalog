// SPDX-License-Identifier: MIT
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Bookmark } from "lucide-react";

interface QueryView {
  id: string;
  name: string;
  query: string;
}

export function SmartViewList({ workspaceId }: { workspaceId: string }) {
  const [views, setViews] = useState<QueryView[]>([]);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/query-views")
      .then((r) => (r.ok ? r.json() : { views: [] }))
      .then((d: { views: QueryView[] }) => setViews(d.views ?? []))
      .catch(() => {});
  }, [workspaceId]);

  if (!views.length) return null;

  function remove(id: string) {
    fetch(`/api/query-views/${id}`, { method: "DELETE" })
      .then((r) => { if (r.ok) setViews((v) => v.filter((x) => x.id !== id)); })
      .catch(() => {});
  }

  return (
    <div className="mb-4">
      <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
        <Bookmark size={12} /> Saved views
      </p>
      <div className="flex flex-wrap gap-2">
        {views.map((v) => (
          <div
            key={v.id}
            className="flex items-center gap-1 rounded-full border px-3 py-1 text-sm bg-muted/40 hover:bg-muted transition-colors"
          >
            <button
              className="font-medium"
              onClick={() =>
                router.push(`/app/search?q=${encodeURIComponent(v.query)}`)
              }
            >
              {v.name}
            </button>
            <button
              onClick={() => remove(v.id)}
              className="text-muted-foreground hover:text-foreground ml-1"
              aria-label={`Remove ${v.name}`}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
