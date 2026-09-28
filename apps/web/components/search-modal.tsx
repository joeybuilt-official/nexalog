"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  X,
  FileText,
  Bookmark,
  Layers,
  Plus,
  Mic,
  Calendar,
  Settings,
  Zap,
} from "lucide-react";
import { useModals } from "@/components/modal-context";
import { resolveResultHref } from "@/lib/search/result-href";

type ResultKind =
  | "note"
  | "video"
  | "article"
  | "reference"
  | "social"
  | "homepage"
  | "other";

interface SearchResult {
  id: string;
  kind: ResultKind;
  title: string;
  /** Server-decided route (see /api/search — a brain hit's id is a slug). */
  href?: string | null;
  url: string | null;
  summary: string | null;
  urlHost: string | null;
}

interface ThemeHit {
  themeId: string;
  themeLabel: string;
  count: number;
}

// Flat, keyboard-navigable item — actions first, then themes, then results.
type Item =
  | { type: "theme"; href: string; label: string; sub: string }
  | { type: "result"; href: string | null; url: string | null; label: string; sub: string; kind: ResultKind }
  | {
      type: "action";
      id: string;
      label: string;
      sub: string;
      icon: "plus" | "mic" | "calendar" | "settings";
      run: () => Promise<void> | void;
    };

/**
 * Where a result row points: the SERVER's `href` when it supplied one, else a
 * note's own route. A brain hit arrives with `/app/brain/<slug>` — this
 * function used to map every non-note row onto the bookmark reader route,
 * which turned each brain hit into a 404. `null` means the row has no in-app
 * page: the caller opens `r.url` instead of linking somewhere that will not
 * resolve.
 */
function resultHref(r: SearchResult): string | null {
  return resolveResultHref(r);
}

// Search the query against a short label. Substring + lowercased.
// Keeps actions filterable from the same input — "set" surfaces Settings,
// "today" surfaces the daily note, etc. Empty query = show all four.
function actionMatches(label: string, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.trim().toLowerCase();
  return label.toLowerCase().includes(q);
}

export function SearchModal() {
  const { searchOpen: open, setSearchOpen: setOpen } = useModals();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);
  const router = useRouter();

  // Cmd-K / Ctrl-K toggle
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  useEffect(() => {
    if (open) {
      prevFocus.current = document.activeElement as HTMLElement | null;
      setTimeout(() => inputRef.current?.focus(), 10);
      setQuery("");
      setItems([]);
      setSelected(0);
    } else {
      prevFocus.current?.focus?.();
    }
  }, [open]);

  // Stable factory — actions navigate (cheap) or POST and then navigate.
  // New-note hits POST /api/notes and routes to the freshly-minted note id.
  const buildActions = useCallback(
    (q: string): Item[] => {
      const all: Item[] = [
        {
          type: "action",
          id: "new-note",
          label: "New note",
          sub: "Start a blank note",
          icon: "plus",
          run: async () => {
            const res = await fetch("/api/notes", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title: "", lifecycleState: "raw" }),
            });
            if (res.ok) {
              const note = (await res.json()) as { id: string };
              router.push(`/app/notes/${note.id}`);
            }
          },
        },
        {
          type: "action",
          id: "new-capture",
          label: "New capture",
          sub: "Drop in a URL, paste, or voice memo",
          icon: "mic",
          run: () => {
            router.push("/app/today");
          },
        },
        {
          type: "action",
          id: "today-daily",
          label: "Today's daily note",
          sub: "Jump straight to today's journal entry",
          icon: "calendar",
          run: () => {
            router.push("/app/journal/today");
          },
        },
        {
          type: "action",
          id: "settings",
          label: "Open settings",
          sub: "Account, history, billing",
          icon: "settings",
          run: () => {
            router.push("/app/settings");
          },
        },
      ];
      return all.filter((a) => actionMatches(a.label, q));
    },
    [router]
  );

  const search = useCallback(
    async (q: string) => {
      // Always show matching actions — even on empty query they anchor the
      // palette so the surface is never blank.
      const actions = buildActions(q);
      if (!q.trim()) {
        setItems(actions);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q, limit: 8 }),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            results: SearchResult[];
            themes?: ThemeHit[];
          };
          const themeItems: Item[] = (data.themes ?? []).map((t) => ({
            type: "theme",
            href: `/app/themes/${encodeURIComponent(t.themeId)}`,
            label: t.themeLabel,
            sub: `${t.count} item${t.count === 1 ? "" : "s"}`,
          }));
          const resultItems: Item[] = (data.results ?? []).map((r) => ({
            type: "result",
            href: resultHref(r),
            url: r.url,
            label:
              r.title ||
              (r.kind === "note" ? "Untitled note" : r.urlHost || "Untitled"),
            sub: r.summary?.trim() || r.urlHost || "",
            kind: r.kind,
          }));
          setItems([...actions, ...themeItems, ...resultItems]);
          setSelected(0);
        }
      } finally {
        setLoading(false);
      }
    },
    [buildActions]
  );

  useEffect(() => {
    const t = setTimeout(() => search(query), 200);
    return () => clearTimeout(t);
  }, [query, search]);

  function trapTab(e: React.KeyboardEvent) {
    if (e.key !== "Tab" || !panelRef.current) return;
    const f = panelRef.current.querySelectorAll<HTMLElement>(
      'button, input, [href], [tabindex]:not([tabindex="-1"])'
    );
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  async function go(item: Item) {
    setOpen(false);
    if (item.type === "action") {
      await item.run();
    } else if (item.type === "theme") {
      router.push(item.href);
    } else if (item.href) {
      router.push(item.href);
    } else if (item.url) {
      // No in-app page for this row — open the thing itself rather than
      // pushing a route that would 404.
      window.open(item.url, "_blank", "noopener,noreferrer");
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && items[selected]) {
      void go(items[selected]);
    }
  }

  if (!open) return null;

  // Pre-compute the index of the first non-action item so we can render a
  // single section divider between Actions and Search results. Cheap.
  const firstNonActionIdx = items.findIndex((i) => i.type !== "action");
  const hasActions = items.some((i) => i.type === "action");
  const hasResults = firstNonActionIdx !== -1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-background/80 backdrop-blur-sm pt-20"
      onClick={() => setOpen(false)}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="w-full max-w-lg rounded-xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapTab}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder="Search or run an action…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {loading && (
            <span className="text-xs text-muted-foreground">Searching…</span>
          )}
          <button
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto py-2">
          {items.length === 0 && !loading ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">
              No matches.
            </p>
          ) : (
            <>
              {hasActions && (
                <div className="px-4 pt-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  <Zap className="h-3 w-3" /> Actions
                </div>
              )}
              {items.map((item, i) => {
                const isSectionDivider =
                  hasActions && hasResults && i === firstNonActionIdx;
                return (
                  <div key={`row-${i}`}>
                    {isSectionDivider && (
                      <div className="mt-1 px-4 pt-2 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground border-t border-border">
                        Search
                      </div>
                    )}
                    <button
                      className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors ${
                        i === selected
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-accent/50"
                      }`}
                      onMouseEnter={() => setSelected(i)}
                      onClick={() => void go(item)}
                    >
                      <span className="shrink-0 text-muted-foreground">
                        {item.type === "action" ? (
                          item.icon === "plus" ? (
                            <Plus className="h-4 w-4" />
                          ) : item.icon === "mic" ? (
                            <Mic className="h-4 w-4" />
                          ) : item.icon === "calendar" ? (
                            <Calendar className="h-4 w-4" />
                          ) : (
                            <Settings className="h-4 w-4" />
                          )
                        ) : item.type === "theme" ? (
                          <Layers className="h-4 w-4" />
                        ) : item.kind === "note" ? (
                          <FileText className="h-4 w-4" />
                        ) : (
                          <Bookmark className="h-4 w-4" />
                        )}
                      </span>
                      <span className="flex flex-col gap-0.5 min-w-0">
                        <span className="text-sm font-medium truncate">
                          {item.label}
                        </span>
                        {item.sub && (
                          <span className="text-xs text-muted-foreground truncate">
                            {item.sub}
                          </span>
                        )}
                      </span>
                      {item.type === "theme" && (
                        <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                          Theme
                        </span>
                      )}
                      {item.type === "action" && (
                        <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                          Action
                        </span>
                      )}
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </div>

        <div className="border-t border-border px-4 py-2 flex items-center gap-4 text-xs text-muted-foreground">
          <span>
            <kbd className="font-mono">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="font-mono">↵</kbd> run
          </span>
          <span>
            <kbd className="font-mono">Esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
