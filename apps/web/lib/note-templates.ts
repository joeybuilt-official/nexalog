// SPDX-License-Identifier: MIT

export type NoteTemplate = {
  key: string;
  name: string;
  title?: string;
  body: string;
};

// In-code templates (D4). Lazier than a `note_templates` table — YAGNI until
// users want to edit them. The editor stores HTML, so bodies use the same
// heading + paragraph shape the rich editor expects.
export const NOTE_TEMPLATES: readonly NoteTemplate[] = [
  {
    key: "blank",
    name: "Blank",
    title: "",
    body: "",
  },
  {
    key: "daily",
    name: "Daily Note",
    body: "<h2>Intentions</h2><p></p><h2>Notes</h2><p></p><h2>Tomorrow</h2><p></p>",
  },
  {
    key: "meeting",
    name: "Meeting Notes",
    body: "<h2>Attendees</h2><ul><li><p></p></li></ul><h2>Agenda</h2><ul><li><p></p></li></ul><h2>Notes</h2><p></p><h2>Action Items</h2><ul><li><p></p></li></ul>",
  },
  {
    key: "project",
    name: "Project Brief",
    body: "<h2>Goal</h2><p></p><h2>Success criteria</h2><ul><li><p></p></li></ul><h2>Milestones</h2><ul><li><p></p></li></ul><h2>Open questions</h2><p></p>",
  },
  {
    key: "book",
    name: "Book Notes",
    title: "Book — ",
    body: "<h2>Author</h2><p></p><h2>Why I picked it up</h2><p></p><h2>Key ideas</h2><ul><li><p></p></li></ul><h2>Quotes</h2><blockquote><p></p></blockquote><h2>What I'll do differently</h2><p></p>",
  },
  {
    key: "idea",
    name: "Idea Capture",
    body: "<h2>The idea, in one sentence</h2><p></p><h2>Who is it for</h2><p></p><h2>Why now</h2><p></p><h2>Smallest test</h2><p></p>",
  },
];

export function getTemplate(key: string): NoteTemplate {
  return (
    NOTE_TEMPLATES.find((t) => t.key === key) ??
    NOTE_TEMPLATES.find((t) => t.key === "blank")!
  );
}
