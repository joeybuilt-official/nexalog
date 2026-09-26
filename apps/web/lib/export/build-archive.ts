import { ZipArchive } from "archiver";
import type { Readable } from "node:stream";
import { buildFrontmatter } from "./frontmatter";
import { buildCapturesCsv } from "./captures-csv";
import { slugify } from "./slug";
import {
  EXPORT_SCHEMA_VERSION,
  type ExportBundle,
  type ExportJournalEntry,
  type ExportNote,
  type ExportWorkspace,
} from "./types";

// ponytail: archiver returns a Node Readable. The route adapts it into a Web
// ReadableStream at the edge — keeping the lib stdlib-flat means we don't pin
// the file to a Next runtime detail.
export function buildExportArchive(bundle: ExportBundle): Readable {
  const archive = new ZipArchive({ zlib: { level: 6 } });
  // ponytail: surface errors on the stream consumer; route logs + 500s.
  archive.on("error", (err: Error) => {
    throw err;
  });

  const wsById = new Map<string, ExportWorkspace>(bundle.workspaces.map((w) => [w.id, w]));

  for (const note of bundle.notes) {
    const path = noteFilePath(note, wsById);
    archive.append(renderNoteMarkdown(note, wsById), { name: path });
  }

  for (const entry of bundle.journal) {
    archive.append(renderJournalMarkdown(entry), { name: `journal/${entry.entryDate}.md` });
  }

  archive.append(buildCapturesCsv(bundle.captures), { name: "captures.csv" });
  archive.append(JSON.stringify(bundle.noteLinks, null, 2), { name: "note_links.json" });

  const manifest = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    userId: bundle.userId,
    exportedAt: bundle.exportedAt.toISOString(),
    counts: {
      notes: bundle.notes.length,
      captures: bundle.captures.length,
      links: bundle.noteLinks.length,
      journal: bundle.journal.length,
      workspaces: bundle.workspaces.length,
    },
  };
  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });
  archive.append(README, { name: "README.md" });

  archive.finalize();
  return archive;
}

function noteFilePath(note: ExportNote, wsById: Map<string, ExportWorkspace>): string {
  const ws = wsById.get(note.workspaceId);
  const wsSlug = ws ? ws.slug || slugify(ws.name) : "unknown-workspace";
  const titleSlug = slugify(note.title || "untitled");
  return `notes/${wsSlug}/${note.id}-${titleSlug}.md`;
}

export function renderNoteMarkdown(
  note: ExportNote,
  wsById: Map<string, ExportWorkspace>,
): string {
  const ws = wsById.get(note.workspaceId);
  const fm = buildFrontmatter({
    title: note.title || "Untitled",
    id: note.id,
    kind: note.kind,
    lifecycle: note.lifecycleState,
    workspace: ws?.name ?? note.workspaceId,
    tags: note.tags,
    created: note.createdAt,
    updated: note.updatedAt,
  });
  return `${fm}\n\n${note.content}`;
}

export function renderJournalMarkdown(entry: ExportJournalEntry): string {
  const fm = buildFrontmatter({
    date: entry.entryDate,
    mood: entry.mood ?? undefined,
    energy: entry.energy ?? undefined,
    weather: entry.weather ? JSON.stringify(entry.weather) : undefined,
    voiceSourceId: entry.voiceSourceId ?? undefined,
  });
  return `${fm}\n\n${entry.body}`;
}

const README = `# Nexalog export

This archive is your data, in formats meant to outlive Nexalog.

- \`notes/<workspace>/<id>-<slug>.md\` — one markdown file per note. Frontmatter
  is Obsidian-compatible. Note bodies are HTML today (Nexalog's editor stores
  HTML); they render as-is in any markdown reader that passes HTML through, and
  remain fully readable as source.
- \`journal/<YYYY-MM-DD>.md\` — daily journal entries.
- \`captures.csv\` — every bookmark / capture row with all enrichment columns
  (OG metadata, reader text, transcripts, classification). UTF-8, RFC-4180
  quoting.
- \`note_links.json\` — directed links between notes (the graph).
- \`manifest.json\` — schema version, counts, export timestamp.

Excluded by design: vector embeddings (re-derivable from text), Plexo-derived
themes (re-derivable from captures), chat history (UX state, not knowledge),
voice audio blobs (R2 keys are preserved in \`captures.csv\` and
\`journal/*.md\` frontmatter; full blob export is a v2 follow-up).

Schema version: ${EXPORT_SCHEMA_VERSION}. See ADR-0009 in the source repo for
the format contract.
`;
