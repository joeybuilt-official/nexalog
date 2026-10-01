// SPDX-License-Identifier: MIT
"use client";

// The project's linked NOTES, as a first-class section.
//
// A note is the one member kind whose body can be a conversation that runs past a
// million characters, so this section renders a TITLE, the note's own date and a
// one-line EXCERPT — never content. The body is fetched on demand by the detail
// route the row links to (`./notes/[noteId]`).
//
// The component holds ONE piece of state and derives everything else: the sort it
// was told to use. Every rule it looks like it is making — which rows survive, what
// order they go in, how the excerpt is cut, what the empty state says — is a call
// into `@/lib/projects/notes`, so the sort control cannot disagree with the server
// (they run the identical comparator) and no rule is re-derived here
// (clean-architecture: a conditional that encodes a business rule does not live in
// the UI).
//
// The server page has already projected the rows; re-sorting on the client reuses
// that projection rather than refetching, which is why the sort is instant and the
// body is never needed.

import { useState } from "react";
import Link from "next/link";
import { ArrowDownUp, FileText } from "lucide-react";
import {
  DEFAULT_PROJECT_NOTE_SORT,
  PROJECT_NOTE_SORTS,
  PROJECT_NOTE_SORT_LABELS,
  projectNotesEmptyMessage,
  projectNotesHiddenNotice,
  sortProjectNotes,
  type ProjectNoteListItem,
  type ProjectNoteSort,
} from "@/lib/projects/notes";
import { RemoveItemButton } from "./remove-item-button";

export function NotesSection({
  projectId,
  notes,
  totalLinked,
  hiddenDeleted,
}: {
  projectId: string;
  /** Already projected by the pure module on the server, in the default order. */
  notes: ProjectNoteListItem[];
  /** Every linked row, live or withheld — the honest denominator. */
  totalLinked: number;
  /** Soft-deleted rows the projection refused (never rendered). */
  hiddenDeleted: number;
}) {
  const [sort, setSort] = useState<ProjectNoteSort>(DEFAULT_PROJECT_NOTE_SORT);

  // The SAME pure comparator the server projected with, so the two cannot drift.
  // `ProjectNoteListItem` satisfies the row shape the comparator needs.
  const ordered = sortProjectNotes(notes, sort);
  const view = { notes: ordered, totalLinked, hiddenDeleted };

  const emptyMessage = projectNotesEmptyMessage(view);
  const hiddenNotice = projectNotesHiddenNotice(view);

  return (
    <section className="mt-8" data-project-notes>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <FileText className="h-3.5 w-3.5" />
          Notes {ordered.length > 0 && `(${ordered.length})`}
        </h2>

        {/* A sort control over one row is a control that cannot change anything,
            so it appears only once there is a choice to make. */}
        {ordered.length > 1 && (
          <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <ArrowDownUp className="h-3.5 w-3.5" />
            <span className="sr-only">Sort notes</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as ProjectNoteSort)}
              aria-label="Sort notes"
              data-notes-sort
              className="rounded-md border border-input bg-background px-2 py-1 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {/* Derived from PROJECT_NOTE_SORTS — a hardcoded list would miss a
                  key added to the domain, and this cannot. */}
              {PROJECT_NOTE_SORTS.map((key) => (
                <option key={key} value={key}>
                  {PROJECT_NOTE_SORT_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {emptyMessage ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          {emptyMessage}
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {ordered.map((note) => (
              <li
                key={note.id}
                data-project-note-row={note.id}
                className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3"
              >
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/app/projects/${projectId}/notes/${note.id}`}
                    className="block truncate text-sm font-medium text-foreground hover:text-primary"
                    title={note.title}
                  >
                    {note.title}
                  </Link>
                  {note.excerpt && (
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {note.excerpt}
                    </p>
                  )}
                  {/* The note's own date, already trimmed to null when blank by the
                      pure module — the component renders, it does not decide. */}
                  {note.date && (
                    <p className="mt-1 text-[11px] text-muted-foreground">{note.date}</p>
                  )}
                </div>
                <RemoveItemButton
                  projectId={projectId}
                  kind="note"
                  itemId={note.id}
                  label="Detach note"
                />
              </li>
            ))}
          </ul>

          {hiddenNotice && <p className="mt-2 text-xs text-muted-foreground">{hiddenNotice}</p>}
        </>
      )}
    </section>
  );
}
