"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { captureOrQueue } from "@/lib/offline/captureOrQueue";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";

export function AddBookmarkForm({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    await captureOrQueue({ kind: "url", content: url.trim(), workspaceId });
    setLoading(false);
    setUrl("");
    setOpen(false);
    router.refresh();
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
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
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
        }}
      >
        <X className="h-4 w-4" />
      </Button>
    </form>
  );
}
