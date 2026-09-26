import type { ExportCapture } from "./types";

// Authoritative export column list for capture_sources. Mirrors
// lib/db/schema.ts captureSources, MINUS:
// - the FTS generated column (not real)
// - `embedding` raw vector (re-derivable, big, and DB-only)
// Column adds here are safe; renames/removes are breaking (bump ADR-0009
// schemaVersion when you do).
export const CAPTURE_EXPORT_COLUMNS = [
  "id",
  "workspaceId",
  "userId",
  "kind",
  "content",
  "url",
  "state",
  "noteId",
  "ogTitle",
  "ogDescription",
  "ogImage",
  "faviconUrl",
  "audioUrl",
  "kindClassified",
  "classifiedAt",
  "lastOpenedAt",
  "openCount",
  "lastCheckedAt",
  "httpStatus",
  "stalenessScore",
  "stalenessReason",
  "smartArchivedAt",
  "urlHost",
  "urlPath",
  "ogType",
  "lastVisitedAt",
  "stalenessReasons",
  "evergreen",
  "currentCheckedAt",
  "extractedText",
  "extractedAt",
  "summary",
  "paywalled",
  "readMinutes",
  "watchMinutes",
  "themeId",
  "themeLabel",
  "themeRegion",
  "openedAt",
  "metadata",
  "ogDescriptionEnriched",
  "ogImageUrl",
  "ogSiteName",
  "canonicalUrl",
  "summaryState",
  "metadataState",
  "metadataFetchedAt",
  "metadataAttempts",
  "metadataLastError",
  "readerHtml",
  "readerText",
  "readerState",
  "readerFetchedAt",
  "videoId",
  "videoThumbnailUrl",
  "videoDurationSeconds",
  "transcript",
  "transcriptState",
  "transcriptSource",
  "transcriptLanguage",
  "transcriptChars",
  "transcriptFetchedAt",
  "transcriptAttempts",
  "transcriptLastError",
  "longSummary",
  "longSummaryState",
  "derivedTitle",
  "embeddingState",
  "embeddedAt",
  "embeddingDimensions",
  "lastClusteredAt",
  "bookmarkedAt",
  "importedAt",
  "importSource",
  "sourcePayload",
  "createdAt",
  "updatedAt",
  "deletedAt",
] as const;

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  let s: string;
  if (typeof v === "object") s = JSON.stringify(v);
  else s = String(v);
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildCapturesCsv(rows: ExportCapture[]): string {
  const header = CAPTURE_EXPORT_COLUMNS.join(",");
  const body = rows
    .map((row) => CAPTURE_EXPORT_COLUMNS.map((col) => csvCell(row[col])).join(","))
    .join("\n");
  return body ? `${header}\n${body}\n` : `${header}\n`;
}
