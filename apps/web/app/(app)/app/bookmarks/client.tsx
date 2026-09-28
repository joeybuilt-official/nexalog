// SPDX-License-Identifier: MIT
"use client";

// Phase 11 pass 2 → Phase 12 → Apr-2026 redesign:
//   - Forest sidebar (categories navigation) on the left
//   - ContentFinder (search/filter/sort/AI-rail) on the right
//   - Bookmark-specific renderer with three density modes (compact /
//     standard / rich), persisted to localStorage
//   - Single document scroll (no inner overflow viewports)
//   - Hover toolbar + keyboard shortcuts on each card

import { useMemo, useState } from "react";
import { Tag } from "lucide-react";
import { ForestTree, type ForestSelection } from "@/components/bookmarks/forest-tree";
import { ContentFinder } from "@/components/content-finder";
import type { ContentFinderFilters, SearchResult } from "@/components/content-finder";
import { useBookmarkDensity, DENSITY_SPEC } from "@/components/bookmarks/density";
import { DensityToggle } from "@/components/bookmarks/density-toggle";
import { BookmarkCard } from "@/components/bookmarks/bookmark-list-card";
import { cn } from "@/lib/utils";
import { AddBookmarkForm } from "./add-bookmark-form";

interface TagSummary {
  id: string;
  name: string;
  color: string | null;
  count: number;
}

function TagNav({
  tags,
  totalBookmarks,
  activeTagId,
  onSelect,
}: {
  tags: TagSummary[];
  totalBookmarks: number;
  activeTagId: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <nav className="space-y-0.5" aria-label="Categories">
      <button
        onClick={() => onSelect(null)}
        className={cn(
          "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors",
          !activeTagId
            ? "bg-muted font-semibold text-foreground"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        )}
      >
        <span>All bookmarks</span>
        <span className="text-xs tabular-nums">{totalBookmarks}</span>
      </button>
      {tags.map((t) => (
        <button
          key={t.id}
          onClick={() => onSelect(t.id)}
          className={cn(
            "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
            activeTagId === t.id
              ? "bg-muted font-semibold text-foreground"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: t.color ?? "#6366f1" }}
            />
            <span className="truncate" title={t.name}>{t.name}</span>
          </span>
          <span className="shrink-0 text-xs tabular-nums">{t.count}</span>
        </button>
      ))}
    </nav>
  );
}

function buildThemeLabels(forest: Forest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of forest.regions) {
    for (const t of r.themes) out[t.id] = t.label;
  }
  return out;
}

function buildRegionLabels(
  forest: Forest
): Record<string, { label: string; color: string }> {
  const out: Record<string, { label: string; color: string }> = {};
  for (const r of forest.regions) {
    out[r.id] = { label: r.label, color: r.color };
  }
  return out;
}

function computeActiveNode(
  forest: Forest,
  selection: ForestSelection
): { label: string; count: number; color: string } {
  for (const r of forest.regions) {
    if (selection.regionId === r.id && !selection.themeId) {
      return { label: r.label, count: r.count, color: r.color };
    }
    for (const t of r.themes) {
      if (selection.themeId === t.id && !selection.subthemeId) {
        return { label: `${r.label} · ${t.label}`, count: t.count, color: r.color };
      }
      for (const s of t.subthemes) {
        if (selection.subthemeId === s.id) {
          return {
            label: `${r.label} · ${t.label} · ${s.label}`,
            count: s.count,
            color: r.color,
          };
        }
      }
    }
  }
  return {
    label: "All bookmarks",
    count: forest.totalCaptures,
    color: "#888",
  };
}

interface Forest {
  source: "plexo" | "local" | "semantic";
  totalCaptures: number;
  regions: Array<{
    id: string;
    label: string;
    color: string;
    count: number;
    themes: Array<{
      id: string;
      label: string;
      count: number;
      subthemes: Array<{ id: string; label: string; count: number; memberIds: string[] }>;
    }>;
  }>;
}

export function BookmarksClient({
  initialForest,
  tags,
  totalBookmarks,
}: {
  initialForest: Forest;
  tags: TagSummary[];
  totalBookmarks: number;
}) {
  // Primary nav: controlled-vocabulary tag. Secondary (demoted): the emergent
  // theme forest. Only one is active at a time.
  const [activeTagId, setActiveTagId] = useState<string | null>(null);
  const [selection, setSelection] = useState<ForestSelection>({
    regionId: null,
    themeId: null,
    subthemeId: null,
  });

  // Sidebar selection feeds ContentFinder as a seed filter. We use
  // captureIds (member id list) so this works whether the forest came
  // from Plexo (real theme uuids) or the local fallback (synthetic
  // ids that the search backend doesn't know about).
  const memberIdsByNode = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const r of initialForest.regions) {
      const regionMembers: string[] = [];
      for (const t of r.themes) {
        const themeMembers: string[] = [];
        for (const s of t.subthemes) {
          out[s.id] = s.memberIds ?? [];
          themeMembers.push(...(s.memberIds ?? []));
        }
        out[t.id] = themeMembers;
        regionMembers.push(...themeMembers);
      }
      out[r.id] = regionMembers;
    }
    return out;
  }, [initialForest]);

  const seedFilters: ContentFinderFilters | undefined = useMemo(() => {
    if (activeTagId) return { tagIds: [activeTagId] };
    const id = selection.subthemeId || selection.themeId || selection.regionId;
    if (!id) return undefined;
    const ids = memberIdsByNode[id];
    if (!ids || ids.length === 0) return undefined;
    return { captureIds: ids };
  }, [activeTagId, selection, memberIdsByNode]);

  const themeLabels = buildThemeLabels(initialForest);
  const regionLabels = buildRegionLabels(initialForest);
  const activeTag = activeTagId ? tags.find((t) => t.id === activeTagId) : undefined;
  const activeNode = activeTag
    ? { label: activeTag.name, count: activeTag.count, color: activeTag.color ?? "#6366f1" }
    : computeActiveNode(initialForest, selection);

  // Selecting a tag clears any forest selection and vice versa.
  function selectTag(id: string | null) {
    setActiveTagId(id);
    if (id) setSelection({ regionId: null, themeId: null, subthemeId: null });
  }
  function selectForest(s: ForestSelection) {
    setSelection(s);
    setActiveTagId(null);
  }

  const [mobileCategoriesOpen, setMobileCategoriesOpen] = useState(false);
  const [density, setDensity] = useBookmarkDensity();
  const spec = DENSITY_SPEC[density];

  // Selection set for future bulk actions (archive/tag). Lives in
  // the host page so the renderer is stateless across re-mounts.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Render a single result. This surface overrides the card for BOOKMARK rows
  // only; anything else DECLINES (returns nothing) and `renderResult` falls
  // back to the default card — a real note gets the note row, and a brain page
  // of gbrain type `note` (which arrives with kind "note" too, but the server
  // routes it to /app/brain/<slug>) gets the href-aware default instead of
  // being blanked by a kind check.
  const renderItem = (r: SearchResult) =>
    r.href?.startsWith("/app/bookmarks/") ? (
      <BookmarkCard
        result={r}
        density={density}
        selected={selectedIds.has(r.id)}
        onToggleSelect={toggleSelected}
      />
    ) : null;

  // Layout note (Apr 2026 redesign): we ride the AppShell's <main>
  // overflow-y-auto. No `h-full`, no inner overflow viewports. The
  // sidebar uses `position: sticky` so it stays pinned as the result
  // list scrolls in document flow.
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
      {/* Mobile/tablet: collapsible categories panel */}
      <details
        className="rounded-lg border border-border bg-card lg:hidden"
        open={mobileCategoriesOpen}
        onToggle={(e) => setMobileCategoriesOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Categories</span>
          <span className="text-[10px] normal-case font-normal text-muted-foreground">
            {activeNode.label}
          </span>
        </summary>
        <div className="space-y-3 border-t border-border p-3">
          <TagNav
            tags={tags}
            totalBookmarks={totalBookmarks}
            activeTagId={activeTagId}
            onSelect={(id) => {
              selectTag(id);
              setMobileCategoriesOpen(false);
            }}
          />
          {initialForest.regions.length > 0 && (
            <details className="border-t border-border pt-2">
              <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Auto-themes
              </summary>
              <div className="pt-2">
                <ForestTree
                  regions={initialForest.regions}
                  selection={selection}
                  onSelect={(s) => {
                    selectForest(s);
                    setMobileCategoriesOpen(false);
                  }}
                />
              </div>
            </details>
          )}
        </div>
      </details>

      {/* Desktop sidebar — controlled-vocab tag nav (primary); the emergent
          theme forest is demoted to a collapsed "Auto-themes" disclosure. */}
      <aside className="hidden w-64 shrink-0 border-r border-border pr-4 lg:block">
        <div className="sticky top-0 max-h-[calc(100dvh-2rem)] space-y-3 overflow-y-auto pb-4">
          <div className="mb-1 flex items-center gap-1.5">
            <Tag className="h-3.5 w-3.5 text-muted-foreground" />
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Categories
            </h2>
          </div>
          <TagNav
            tags={tags}
            totalBookmarks={totalBookmarks}
            activeTagId={activeTagId}
            onSelect={selectTag}
          />
          {initialForest.regions.length > 0 && (
            <details className="border-t border-border pt-2">
              <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Auto-themes
              </summary>
              <div className="pt-2">
                <ForestTree
                  regions={initialForest.regions}
                  selection={selection}
                  onSelect={selectForest}
                />
              </div>
            </details>
          )}
        </div>
      </aside>

      {/* Right pane — ContentFinder. The page heading is part of
          the document flow; only the search/filter bar inside
          ContentFinder gets sticky treatment. */}
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: activeNode.color }}
          />
          <h1
            className="min-w-0 break-words text-xl font-semibold leading-tight line-clamp-2"
            title={activeNode.label}
          >
            {activeNode.label}
          </h1>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{activeNode.count}</span>
          <div className="ml-auto shrink-0">
            <AddBookmarkForm />
          </div>
        </div>

        <ContentFinder
          surfaces={["bookmarks"]}
          subtitle="Categories navigate. ContentFinder filters and ranks."
          placeholder="Search bookmarks…"
          emptyMessage="No bookmarks match."
          emptyHint="Try clearing filters or searching a different term."
          seedFilters={seedFilters}
          limit={1000}
          themeLabels={themeLabels}
          regionLabels={regionLabels}
          renderItem={renderItem}
          layout={spec.layout}
          estimatedRowHeight={spec.rowHeight}
          columnsByBreakpoint={spec.columns}
          compactFilters
          toolbarRight={<DensityToggle value={density} onChange={setDensity} />}
        />
      </div>
    </div>
  );
}
