"use client";

import { useState } from "react";
import { Folder, Tag, Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConfirmButton } from "@/components/confirm-button";

interface Collection {
  id: string;
  name: string;
  color: string | null;
  bookmarkCount: number;
}

interface BookmarkTag {
  id: string;
  name: string;
  color: string | null;
  bookmarkCount: number;
}

interface BookmarkSidebarProps {
  collections: Collection[];
  tags: BookmarkTag[];
  totalCount: number;
  activeCollectionId: string | null;
  activeTagId: string | null;
  onFilterChange: (collectionId: string | null, tagId: string | null) => void;
  onCollectionCreated: (collection: Collection) => void;
  onCollectionDeleted: (id: string) => void;
  onTagCreated: (tag: BookmarkTag) => void;
  onTagDeleted: (id: string) => void;
}

const PRESET_COLORS = [
  "#C07040", "#6366f1", "#22c55e", "#ef4444", "#f59e0b", "#06b6d4",
];

export function BookmarkSidebar({
  collections,
  tags,
  totalCount,
  activeCollectionId,
  activeTagId,
  onFilterChange,
  onCollectionCreated,
  onCollectionDeleted,
  onTagCreated,
  onTagDeleted,
}: BookmarkSidebarProps) {
  const [newCollectionOpen, setNewCollectionOpen] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [newCollectionColor, setNewCollectionColor] = useState("#C07040");
  const [newTagOpen, setNewTagOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#6366f1");
  const [saving, setSaving] = useState(false);

  async function createCollection() {
    if (!newCollectionName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/bookmarks/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCollectionName.trim(), color: newCollectionColor }),
      });
      if (res.ok) {
        const col = await res.json() as Collection;
        onCollectionCreated({ ...col, bookmarkCount: 0 });
        setNewCollectionName("");
        setNewCollectionOpen(false);
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteCollection(id: string) {
    await fetch(`/api/bookmarks/collections/${id}`, { method: "DELETE" });
    onCollectionDeleted(id);
    if (activeCollectionId === id) onFilterChange(null, null);
  }

  async function createTag() {
    if (!newTagName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/bookmarks/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTagName.trim(), color: newTagColor }),
      });
      if (res.ok) {
        const tag = await res.json() as BookmarkTag;
        onTagCreated({ ...tag, bookmarkCount: 0 });
        setNewTagName("");
        setNewTagOpen(false);
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteTag(id: string) {
    await fetch(`/api/bookmarks/tags/${id}`, { method: "DELETE" });
    onTagDeleted(id);
    if (activeTagId === id) onFilterChange(null, null);
  }

  return (
    <aside className="w-full md:w-[220px] md:shrink-0 flex flex-col gap-6 md:pr-4 pb-4 md:pb-0 border-b md:border-b-0 md:border-r border-border">
      {/* All Bookmarks */}
      <div>
        <button
          onClick={() => onFilterChange(null, null)}
          className={cn(
            "w-full flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors",
            !activeCollectionId && !activeTagId
              ? "bg-muted font-semibold text-foreground"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          )}
        >
          <span className="flex items-center gap-2">
            <Folder className="h-4 w-4 shrink-0 text-primary" />
            All Bookmarks
          </span>
          <span className="text-xs tabular-nums">{totalCount}</span>
        </button>
      </div>

      {/* Collections */}
      <div>
        <div className="flex items-center justify-between mb-1.5 px-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Collections
          </span>
          <button
            onClick={() => setNewCollectionOpen((v) => !v)}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            title="New collection"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {newCollectionOpen && (
          <div className="mb-2 px-1">
            <input
              autoFocus
              type="text"
              placeholder="Collection name…"
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createCollection();
                if (e.key === "Escape") { setNewCollectionOpen(false); setNewCollectionName(""); }
              }}
              className="w-full rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setNewCollectionColor(c)}
                  className={cn(
                    "h-4 w-4 rounded-full transition-transform",
                    newCollectionColor === c && "ring-2 ring-offset-1 ring-ring scale-110"
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <div className="mt-1.5 flex gap-1">
              <button
                onClick={createCollection}
                disabled={saving || !newCollectionName.trim()}
                className="flex items-center gap-1 rounded bg-primary px-2 py-0.5 text-[11px] text-primary-foreground disabled:opacity-50"
              >
                <Check className="h-3 w-3" /> Save
              </button>
              <button
                onClick={() => { setNewCollectionOpen(false); setNewCollectionName(""); }}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" /> Cancel
              </button>
            </div>
          </div>
        )}

        <div className="space-y-0.5">
          {collections.map((col) => (
            <div key={col.id} className="group flex items-center gap-1">
              <button
                onClick={() => onFilterChange(col.id, null)}
                className={cn(
                  "flex-1 flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors min-w-0",
                  activeCollectionId === col.id
                    ? "bg-muted font-semibold text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: col.color ?? "#C07040" }}
                  />
                  <span className="truncate text-xs" title={col.name}>{col.name}</span>
                </span>
                <span className="text-xs tabular-nums shrink-0">{col.bookmarkCount}</span>
              </button>
              <ConfirmButton
                onConfirm={() => deleteCollection(col.id)}
                className="opacity-0 group-hover:opacity-100 shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive transition-all"
                confirmLabel={<span className="text-[9px] font-bold text-destructive px-1">Confirm?</span>}
              >
                <Trash2 className="h-3 w-3" />
              </ConfirmButton>
            </div>
          ))}
          {collections.length === 0 && !newCollectionOpen && (
            <p className="px-2 text-xs text-muted-foreground/60 italic">No collections yet</p>
          )}
        </div>
      </div>

      {/* Tags */}
      <div>
        <div className="flex items-center justify-between mb-1.5 px-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Tags
          </span>
          <button
            onClick={() => setNewTagOpen((v) => !v)}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            title="New tag"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {newTagOpen && (
          <div className="mb-2 px-1">
            <input
              autoFocus
              type="text"
              placeholder="Tag name…"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createTag();
                if (e.key === "Escape") { setNewTagOpen(false); setNewTagName(""); }
              }}
              className="w-full rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setNewTagColor(c)}
                  className={cn(
                    "h-4 w-4 rounded-full transition-transform",
                    newTagColor === c && "ring-2 ring-offset-1 ring-ring scale-110"
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <div className="mt-1.5 flex gap-1">
              <button
                onClick={createTag}
                disabled={saving || !newTagName.trim()}
                className="flex items-center gap-1 rounded bg-primary px-2 py-0.5 text-[11px] text-primary-foreground disabled:opacity-50"
              >
                <Check className="h-3 w-3" /> Save
              </button>
              <button
                onClick={() => { setNewTagOpen(false); setNewTagName(""); }}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" /> Cancel
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5 px-1">
          {tags.map((tag) => (
            <div key={tag.id} className="group relative">
              <button
                onClick={() => onFilterChange(null, tag.id)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-all",
                  activeTagId === tag.id
                    ? "ring-2 ring-ring"
                    : "hover:opacity-80"
                )}
                style={{
                  backgroundColor: (tag.color ?? "#6366f1") + "33",
                  color: tag.color ?? "#6366f1",
                  borderColor: (tag.color ?? "#6366f1") + "66",
                  border: "1px solid",
                }}
              >
                <Tag className="h-2.5 w-2.5" />
                {tag.name}
                <span className="opacity-60">({tag.bookmarkCount})</span>
              </button>
              <ConfirmButton
                onConfirm={() => deleteTag(tag.id)}
                className="absolute -top-1 -right-1 hidden group-hover:flex items-center justify-center h-3.5 w-3.5 rounded-full bg-destructive text-white"
                armedClassName="!flex h-auto w-auto px-1.5 ring-2 ring-destructive"
                confirmLabel={<span className="text-[8px] font-bold whitespace-nowrap">Confirm?</span>}
              >
                <X className="h-2 w-2" />
              </ConfirmButton>
            </div>
          ))}
          {tags.length === 0 && !newTagOpen && (
            <p className="px-1 text-xs text-muted-foreground/60 italic">No tags yet</p>
          )}
        </div>
      </div>
    </aside>
  );
}
