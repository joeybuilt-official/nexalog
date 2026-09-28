"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { captureOrQueue } from "@/lib/offline/captureOrQueue";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";

/**
 * Add Bookmark — the visible front door for the bookmark model.
 *
 * Rendered in the bookmarks header (see `./client.tsx`). The save itself goes
 * through `captureOrQueue`, which routes a URL to `POST /api/bookmarks`: the
 * server normalizes + dedupes the URL, classifies it at write time and queues
 * OG/reader enrichment, so the new link is listed here AND searchable by its
 * body shortly after.
 */
export function AddBookmarkForm() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await captureOrQueue({ kind: "url", content: url.trim() });
      setUrl("");
      setOpen(false);
      router.refresh();
    } catch {
      // Never leave the user believing an unsaved link was saved.
      setError("Could not save that link. Check it and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 h-4 w-4" />
        Add Bookmark
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <input
          type="url"
          placeholder="Paste URL…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="h-9 w-72 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          autoFocus
          required
        />
        <Button type="submit" size="sm" disabled={loading}>
          {loading ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setUrl("");
            setError(null);
          }}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      ) : null}
    </form>
  );
}
