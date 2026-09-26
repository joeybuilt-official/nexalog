// SPDX-License-Identifier: MIT
import { getAuthUser } from "@/lib/auth/server";
import { redirect } from "next/navigation";
import { getUserWorkspaces } from "@/lib/workspace";
import { Button } from "@/components/ui/button";
import { Plus, ChevronDown } from "lucide-react";
import { createNote } from "./actions";
import { NOTE_TEMPLATES } from "@/lib/note-templates";
import { ContentFinder } from "@/components/content-finder";

export default async function NotesPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const workspaces = await getUserWorkspaces(user.id);
  const workspace = workspaces[0];
  if (!workspace) redirect("/app/dashboard");

  return (
    <ContentFinder
      surfaces={["notes"]}
      title="Notes"
      placeholder="Search notes…"
      emptyMessage="No notes yet."
      emptyHint="Create one to get started, or search if you've imported."
      layout="list"
      headerRight={
        <form action={createNote} className="flex items-center gap-1.5">
          <input type="hidden" name="workspaceId" value={workspace.id} />
          <input type="hidden" name="userId" value={user.id} />
          <Button type="submit" size="sm">
            <Plus className="mr-1.5 h-4 w-4" />
            New Note
          </Button>
          <details className="group relative">
            <summary className="flex h-8 cursor-pointer list-none items-center rounded-md border border-input bg-background px-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground [&::-webkit-details-marker]:hidden">
              <ChevronDown className="h-4 w-4" />
            </summary>
            <div className="absolute right-0 z-50 mt-1 min-w-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
              {NOTE_TEMPLATES.map((t) => (
                <button
                  key={t.key}
                  type="submit"
                  name="templateKey"
                  value={t.key}
                  className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                >
                  {t.name}
                </button>
              ))}
            </div>
          </details>
        </form>
      }
    />
  );
}
