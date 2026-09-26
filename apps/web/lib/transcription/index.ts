// SPDX-License-Identifier: MIT
//
// Transcript worker. Fetches a video bookmark's transcript via Supadata and
// persists it onto capture_sources. Idempotent + cache-aware + cost-guarded.
//
// State machine on `transcript_state`:
//   pending  → fetching → ready
//                       → failed       (retryable: 429, 5xx, network, timeout)
//                       → unavailable  (terminal: no captions, ASR rejected)
//   pending  → skipped  (policy: not a YouTube video, too long, ASR disabled)
//
// Failed rows are picked up by the next cron sweep until attempts == MAX_ATTEMPTS.

import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { fetchSupadataTranscript, supadataConfigured } from "./supadata";

const MAX_ATTEMPTS = 4;
const MAX_DURATION_SECONDS = Number(
  process.env.TRANSCRIPT_MAX_DURATION_SECONDS || 5400,
);

export interface FetchTranscriptResult {
  ok: boolean;
  reason: string;
  state: "ready" | "failed" | "unavailable" | "skipped";
}

export async function fetchTranscript(captureId: string): Promise<FetchTranscriptResult> {
  const [row] = await db
    .select({
      id: schema.captureSources.id,
      kind: schema.captureSources.kind,
      kindClassified: schema.captureSources.kindClassified,
      videoId: schema.captureSources.videoId,
      videoDurationSeconds: schema.captureSources.videoDurationSeconds,
      transcriptState: schema.captureSources.transcriptState,
      transcriptAttempts: schema.captureSources.transcriptAttempts,
    })
    .from(schema.captureSources)
    .where(eq(schema.captureSources.id, captureId))
    .limit(1);

  if (!row) return { ok: false, reason: "not-found", state: "failed" };

  if (row.kindClassified !== "video") {
    await markSkipped(captureId, "not-video");
    return { ok: true, reason: "not-video", state: "skipped" };
  }
  if (!row.videoId) {
    // Metadata hasn't extracted a videoId yet (still running or it's a
    // non-YouTube video). Leave the row in 'pending' so the next sweep
    // retries once metadata lands. Marking skipped here would be terminal.
    return { ok: true, reason: "video-id-pending", state: "skipped" };
  }

  if (row.transcriptState === "ready") {
    return { ok: true, reason: "fresh", state: "ready" };
  }
  if (row.transcriptState === "unavailable") {
    return { ok: true, reason: "unavailable", state: "unavailable" };
  }

  if (
    row.videoDurationSeconds !== null &&
    row.videoDurationSeconds > MAX_DURATION_SECONDS
  ) {
    await markSkipped(captureId, `too-long-${row.videoDurationSeconds}s`);
    return { ok: true, reason: "too-long", state: "skipped" };
  }

  // Cross-bookmark cache: same videoId already transcribed elsewhere.
  const [cached] = await db
    .select({
      videoId: schema.supadataCache.videoId,
      transcript: schema.supadataCache.transcript,
      language: schema.supadataCache.language,
      source: schema.supadataCache.source,
      chars: schema.supadataCache.chars,
    })
    .from(schema.supadataCache)
    .where(eq(schema.supadataCache.videoId, row.videoId))
    .limit(1);

  if (cached) {
    await db
      .update(schema.captureSources)
      .set({
        transcript: cached.transcript,
        transcriptState: "ready",
        transcriptSource: cached.source,
        transcriptLanguage: cached.language,
        transcriptChars: cached.chars,
        transcriptFetchedAt: new Date(),
        transcriptLastError: null,
      })
      .where(eq(schema.captureSources.id, captureId));
    return { ok: true, reason: "cache-hit", state: "ready" };
  }

  if (!supadataConfigured()) {
    await db
      .update(schema.captureSources)
      .set({
        transcriptState: "failed",
        transcriptLastError: "supadata-not-configured",
      })
      .where(eq(schema.captureSources.id, captureId));
    return { ok: false, reason: "supadata-not-configured", state: "failed" };
  }

  // Lock: flip pending|failed → fetching, only if under attempt cap.
  const lock = await db
    .update(schema.captureSources)
    .set({
      transcriptState: "fetching",
      transcriptAttempts: sql`${schema.captureSources.transcriptAttempts} + 1`,
    })
    .where(
      and(
        eq(schema.captureSources.id, captureId),
        inArray(schema.captureSources.transcriptState, ["pending", "failed"]),
        lte(schema.captureSources.transcriptAttempts, MAX_ATTEMPTS - 1),
      ),
    )
    .returning({ id: schema.captureSources.id });
  if (lock.length === 0) {
    // Either another worker took it, or we've hit the attempt cap.
    if ((row.transcriptAttempts ?? 0) >= MAX_ATTEMPTS) {
      await db
        .update(schema.captureSources)
        .set({
          transcriptState: "unavailable",
          transcriptLastError: "max-attempts",
        })
        .where(eq(schema.captureSources.id, captureId));
      return { ok: false, reason: "max-attempts", state: "unavailable" };
    }
    return { ok: true, reason: "already-locked", state: "skipped" };
  }

  const result = await fetchSupadataTranscript(row.videoId);

  if (!result.ok) {
    const terminal = !result.retryable;
    await db
      .update(schema.captureSources)
      .set({
        transcriptState: terminal ? "unavailable" : "failed",
        transcriptLastError: result.reason,
      })
      .where(eq(schema.captureSources.id, captureId));
    return {
      ok: false,
      reason: result.reason,
      state: terminal ? "unavailable" : "failed",
    };
  }

  const chars = result.text.length;
  await db
    .insert(schema.supadataCache)
    .values({
      videoId: row.videoId,
      transcript: result.text,
      language: result.language,
      source: result.source,
      chars,
      requestId: result.requestId,
    })
    .onConflictDoNothing({ target: schema.supadataCache.videoId });

  await db
    .update(schema.captureSources)
    .set({
      transcript: result.text,
      transcriptState: "ready",
      transcriptSource: result.source,
      transcriptLanguage: result.language,
      transcriptChars: chars,
      transcriptFetchedAt: new Date(),
      transcriptLastError: null,
    })
    .where(eq(schema.captureSources.id, captureId));

  return { ok: true, reason: "ok", state: "ready" };
}

async function markSkipped(captureId: string, reason: string): Promise<void> {
  await db
    .update(schema.captureSources)
    .set({
      transcriptState: "skipped",
      transcriptLastError: reason,
      longSummaryState: "skipped",
    })
    .where(eq(schema.captureSources.id, captureId));
}

// ---------- batch runner ----------

export interface RunTranscriptBatchOptions {
  limit?: number;
  workspaceId?: string;
}

export interface TranscriptBatchReport {
  scanned: number;
  ready: number;
  failed: number;
  unavailable: number;
  skipped: number;
}

export async function runTranscriptBatch(
  opts: RunTranscriptBatchOptions = {},
): Promise<TranscriptBatchReport> {
  const limit = opts.limit ?? 25;
  const conditions = [
    eq(schema.captureSources.kindClassified, "video"),
    inArray(schema.captureSources.transcriptState, ["pending", "failed"]),
  ];
  if (opts.workspaceId) {
    conditions.push(eq(schema.captureSources.workspaceId, opts.workspaceId));
  }
  const rows = await db
    .select({ id: schema.captureSources.id })
    .from(schema.captureSources)
    .where(and(...conditions))
    .limit(limit);

  const report: TranscriptBatchReport = {
    scanned: rows.length,
    ready: 0,
    failed: 0,
    unavailable: 0,
    skipped: 0,
  };
  for (const r of rows) {
    const result = await fetchTranscript(r.id);
    if (result.state === "ready") report.ready++;
    else if (result.state === "failed") report.failed++;
    else if (result.state === "unavailable") report.unavailable++;
    else report.skipped++;
  }
  return report;
}
