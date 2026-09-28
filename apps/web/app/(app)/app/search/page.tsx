// SPDX-License-Identifier: MIT
"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import { FileText, Bookmark, Video, BookOpen, Globe } from "lucide-react";
import { parseQueryDSL } from "@/lib/search/query-dsl";
import { resolveResultHref } from "@/lib/search/result-href";

interface SearchResult {
  id: string;
  kind: string;
  title: string;
  /** Server-decided route (see /api/search — a brain hit's id is a slug). */
  href?: string | null;
  url: string | null;
  summary: string | null;
  urlHost: string | null;
}

function kindHref(r: SearchResult): string | null {
  return resolveResultHref(r);
}

function KindIcon({ kind }: { kind: string }) {
  const cls = "shrink-0 text-muted-foreground";
  switch (kind) {
    case "note": return <FileText size={16} className={cls} />;
    case "video": return <Video size={16} className={cls} />;
    case "article": return <BookOpen size={16} className={cls} />;
    case "homepage": return <Globe size={16} className={cls} />;
    default: return <Bookmark size={16} className={cls} />;
  }
}

function SearchResults() {
  const params = useSearchParams();
  const router = useRouter();
  const rawQ = params.get("q") ?? "";
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(Boolean(rawQ.trim()));
  const [viewName, setViewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [queried, setQueried] = useState(rawQ);

  if (rawQ !== queried) {
    setQueried(rawQ);
    setResults([]);
    setLoading(Boolean(rawQ.trim()));
  }

  useEffect(() => {
    if (!rawQ.trim()) return;
    const ac = new AbortController();
    const parsed = parseQueryDSL(rawQ);
    fetch("/api/search", {
      signal: ac.signal,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: parsed.text,
        surfaces: parsed.surfaces.length ? parsed.surfaces : undefined,
        sort: parsed.sort !== "relevance" ? parsed.sort : undefined,
        filters: {
          ...(parsed.ageRange ? { ageRange: parsed.ageRange } : {}),
          ...(parsed.evergreen !== null ? { evergreen: parsed.evergreen } : {}),
          ...(parsed.opened !== null ? { opened: parsed.opened } : {}),
          ...(parsed.paywalled !== null ? { paywalled: parsed.paywalled } : {}),
        },
        limit: 50,
      }),
    })
      .then((r) => (r.ok ? r.json() : { results: [] }))
      .then((d: { results: SearchResult[] }) => setResults(d.results ?? []))
      .catch(() => {
        if (!ac.signal.aborted) setResults([]);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [rawQ]);

  async function saveView() {
    if (!viewName.trim()) return;
    setSaving(true);
    const r = await fetch("/api/query-views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: viewName.trim(), query: rawQ }),
    });
    setSaving(false);
    if (r.ok) { setSaved(true); setViewName(""); }
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Search</h1>
        {rawQ && (
          <p className="text-sm text-muted-foreground mt-1 font-mono">{rawQ}</p>
        )}
      </header>

      {/* Save-as-view form */}
      {rawQ && !saved && (
        <div className="mb-4 flex gap-2">
          <input
            className="flex-1 rounded-md border px-3 py-1.5 text-sm"
            placeholder="Name this view…"
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveView()}
          />
          <button
            onClick={saveView}
            disabled={saving || !viewName.trim()}
            className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50 hover:bg-muted"
          >
            {saving ? "Saving…" : "Save view"}
          </button>
        </div>
      )}
      {saved && (
        <p className="mb-4 text-sm text-green-600">View saved — find it on Today.</p>
      )}

      {loading && <p className="text-sm text-muted-foreground">Searching…</p>}

      {!loading && results.length === 0 && rawQ && (
        <p className="text-sm text-muted-foreground">No results.</p>
      )}

      <ul className="divide-y">
        {results.map((r) => {
          const href = kindHref(r);
          return (
            <li key={r.id}>
              <button
                className="w-full flex items-start gap-3 py-3 text-left hover:bg-muted/40 px-1 rounded"
                onClick={() => {
                  // A row with no in-app page opens its own URL; one with
                  // neither is inert rather than pushing a 404.
                  if (href) router.push(href);
                  else if (r.url) window.open(r.url, "_blank", "noopener,noreferrer");
                }}
              >
                <KindIcon kind={r.kind} />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {r.title || r.urlHost || "Untitled"}
                  </p>
                  {r.summary && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                      {r.summary}
                    </p>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchResults />
    </Suspense>
  );
}
