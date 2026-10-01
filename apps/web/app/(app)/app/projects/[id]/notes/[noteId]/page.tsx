// SPDX-License-Identifier: MIT
// One linked note's BODY, on demand — the other half of the project page's
// bounded list.
//
// The list renders titles, dates and one-line excerpts and never touches
// `notes.content`; this route is where the body is finally read, for one note,
// because the reader asked for it. That split is the whole design: a note can be a
// million-character conversation, and 445 of them must not be loaded to draw a
// page of rows.
//
// The note is reached THROUGH the project edge (`project_items.item_kind = 'note'`
// + `project_id`), so an unlinked note is a 404 here even if the caller could open
// it at `/app/notes/<id>` — this surface is "this project's notes", and the store
// owns that guard (`getProjectNote`). Workspace scope and soft-delete are in the
// same query, so a deleted note is a 404 rather than a rendered tombstone.
//
// The body's SHAPE is a rule and lives in the pure module (`classifyNoteBody`): the
// editor stores HTML, an import can store markdown, and rendering the wrong one
// shows the reader either a wall of raw tags or a page of unparsed `##` markers.
// The HTML half is sanitised before it is injected (`sanitiseReaderHtml`, the same
// prose allowlist the reader uses — deliberately one sanitiser, not a second one to
// drift from it); the markdown half is rendered as its own source text and labelled
// as such rather than pretending to be rendered prose.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { getAuthUser } from "@/lib/auth/server";
import { getUserWorkspaces } from "@/lib/workspace";
import { getProjectNote } from "@/lib/projects/store";
import { classifyNoteBody } from "@/lib/projects/notes";
import { sanitiseReaderHtml } from "@/lib/reader/sanitise";
import { Badge } from "@/components/ui/badge";

export default async function ProjectNotePage({
  params,
}: {
  params: Promise<{ id: string; noteId: string }>;
}) {
  const { id, noteId } = await params;
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const workspaces = await getUserWorkspaces(user.id);
  if (!workspaces.length) redirect("/app/dashboard");

  const note = await getProjectNote(
    workspaces.map((ws) => ws.id),
    id,
    noteId,
  );
  if (!note) notFound();

  const bodyKind = classifyNoteBody(note.content);

  return (
    <div className="mx-auto max-w-4xl">
      <nav className="mb-4 flex items-center gap-1 text-xs text-muted-foreground">
        <Link href="/app/projects" className="hover:text-foreground">
          Projects
        </Link>
        <ChevronRight className="h-3 w-3" />
        <Link href={`/app/projects/${note.projectId}`} className="hover:text-foreground">
          {note.projectName}
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="truncate text-foreground">{note.title || "Untitled"}</span>
      </nav>

      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{note.title || "Untitled"}</h1>
          <Badge variant="secondary" className="capitalize">
            {note.kind}
          </Badge>
          {/* One link back to the project: the section this note was listed in is
              the only place it can be detached from, so a reader who came from
              there must be able to get back without the browser's back button. */}
          <Link
            href={`/app/projects/${note.projectId}`}
            data-back-to-project
            className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back to {note.projectName}
          </Link>
        </div>
        {note.date && <p className="mt-1 text-xs text-muted-foreground">{note.date}</p>}
      </header>

      {bodyKind === "empty" ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          This note has no content yet.{" "}
          <Link href={`/app/notes/${note.id}`} className="underline hover:text-foreground">
            Open it in the editor
          </Link>{" "}
          to write it.
        </p>
      ) : bodyKind === "html" ? (
        <article
          data-note-body="html"
          className="prose prose-sm dark:prose-invert max-w-none"
          // Sanitised against the prose allowlist before injection; nothing
          // stored by the editor reaches the DOM unfiltered.
          dangerouslySetInnerHTML={{ __html: sanitiseReaderHtml(note.content) }}
        />
      ) : (
        <div data-note-body="markdown">
          <p className="mb-2 text-xs text-muted-foreground">
            Stored as Markdown — shown as its source text rather than rendered.
          </p>
          <div className="whitespace-pre-wrap break-words rounded-lg border border-border bg-card p-4 text-sm leading-relaxed">
            {note.content}
          </div>
        </div>
      )}

      <section className="mt-8 border-t border-border pt-4">
        <Link
          href={`/app/notes/${note.id}`}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <FileText className="h-3.5 w-3.5" />
          Open this note in the editor
        </Link>
      </section>
    </div>
  );
}
