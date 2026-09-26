// Pure DTOs the export builder consumes. Decoupled from drizzle row shapes so
// the route adapter (lib/export/load.ts) is the only thing that touches the db.

export interface ExportWorkspace {
  id: string;
  slug: string;
  name: string;
}

export interface ExportNote {
  id: string;
  workspaceId: string;
  title: string;
  content: string;
  kind: string;
  lifecycleState: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ExportCapture {
  // The full row, untyped — captures-csv.ts owns the column list. Keeping
  // this Record-typed avoids a 100-line type duplicate of the drizzle row.
  [k: string]: unknown;
}

export interface ExportNoteLink {
  sourceNoteId: string;
  targetNoteId: string;
  kind: string;
  strength: number | null;
  createdAt: Date;
}

export interface ExportJournalEntry {
  id: string;
  workspaceId: string;
  entryDate: string;
  body: string;
  mood: number | null;
  energy: number | null;
  weather: Record<string, unknown> | null;
  voiceSourceId: string | null;
}

export interface ExportBundle {
  userId: string;
  exportedAt: Date;
  workspaces: ExportWorkspace[];
  notes: ExportNote[];
  captures: ExportCapture[];
  noteLinks: ExportNoteLink[];
  journal: ExportJournalEntry[];
}

export const EXPORT_SCHEMA_VERSION = 1;
