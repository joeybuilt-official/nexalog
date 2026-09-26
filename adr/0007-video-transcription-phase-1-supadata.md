# ADR 0007 — Video transcription Phase 1: Supadata sourcing

Date: 2026-06-16
Status: Accepted

## Context

Nexalog ingests bookmarks (Chrome extension + Telegram) and synthesizes them
into themes, semantic links, and a Graphiti knowledge graph. Video bookmarks
(YouTube, Vimeo, TikTok, X, IG, LinkedIn) are first-class in the user's flow
but synthesis only sees `og_title` + `og_description` — typically 30-200 words
of marketing copy. The actual ideas inside the video never reach embeddings,
themes, near-duplicate detection, or graph entity extraction.

Two sub-problems:

1. **Get transcript text** from a video URL.
2. **Fold it into the existing pipeline** without re-architecting capture.

Sub-problem 2 is easy: capture_sources already has `og_*`, `reader_text`,
`summary`. A transcript column plus a long-form summary slots in next to them
and is auto-consumed by `embeddings.ts` / `graph-ingest.ts` / cluster
without content-type branching (those treat all rows as text).

Sub-problem 1 has multiple candidate providers. We evaluated:

| Option | $/15-min vid | Pros | Cons |
|---|---|---|---|
| youtube-transcript-api / scraper | $0 | free | Datacenter IPs blocked; multi-week outages; YT breaks it ~quarterly |
| yt-dlp `--write-auto-sub` | $0 | works ~80% YT | Same IP-block risk; no captions for X/TikTok/IG |
| **Supadata** | ~$0.006 + $17/mo flat | YT + TikTok + IG + X in one API; AI/ASR fallback for uncaptioned; eats the IP-block problem | external SaaS dep; not routable through Plexo today |
| yt-dlp + Groq Whisper-turbo | $0.01/15min | cheapest at scale, covers all platforms | new prod-host container; per-platform cookies; GPU contention |
| Self-host faster-whisper | $0 marginal | privacy; no per-call cost | adds GPU contention (Ollama on GPU 0/1 already); ops burden |

Operator targets ~20 videos/day = ~600 vids/mo. Supadata's $17 plan (3000
credits) fits exactly. YouTube is the dominant case (~80% of operator's video
bookmarks today).

## Decision

**Phase 1 (this ADR): YouTube-only via Supadata.** Direct API integration in
`lib/transcription/`. Ships immediately. Bookmarks of non-YouTube videos pass
through unchanged (title + thumbnail + duration only, as today).

**Phase 2 (future, NOT this ADR): yt-dlp + Groq Whisper for X / TikTok / IG /
Vimeo / LinkedIn.** Add `lib/transcription/ytdlp.ts` peer that mirrors the
Supadata client surface. Same column schema — `transcript_source` enum already
allows `ytdlp-whisper`.

**Phase 3 (future): Migrate to Plexo `transcription` verb (ADR-0006).** When
the verb ships, replace `fetchSupadataTranscript` with `plexoTranscribe(videoId)`
behind the same interface, delete `SUPADATA_API_KEY` from prod env, and route
Groq behind it too. Supadata may remain direct (it's a *content source*, not
inference) if its $/credit beats Plexo's pass-through pricing.

## Why direct Supadata for now (not via Plexo)

- Plexo has no transcription verb today (ADR-0006 lists it `[X]` not built).
- Supadata is functionally a content-source (caption fetcher + ASR fallback),
  not an LLM inference call. The "no hardwired LLM provider" rule
  ([[feedback_no_hardwired_llm_provider]]) targets *AI routing*, not content
  acquisition (which already includes direct YouTube oEmbed, direct HTTP
  scraping, direct R2 audio upload, etc).
- The long-form summary step (which IS LLM inference) already routes through
  `plexoAiComplete` per the existing pattern — no provider pinning there.

## Cost guard

- Skip videos with `videoDurationSeconds > TRANSCRIPT_MAX_DURATION_SECONDS`
  (default 5400 = 90 minutes). Prevents accidental podcast/lecture backfills
  from burning the credit pool.
- Backfill script aborts when `creditsRemaining < TRANSCRIPT_BACKFILL_CREDIT_FLOOR`
  (default 50) so user-driven captures retain headroom.
- Cross-bookmark cache (`supadata_cache` keyed by videoId): re-saving the
  same video costs zero credits.

## Single-episode graph ingest

The `graph_ingestion` table is 1:1 (item → episode). A 60-minute talk =
~10K-word transcript. Plan options:

- A — multi-episode: chunk transcript into N episodes per bookmark. Breaks
  the 1:1 schema; complicates re-ingest semantics (which episodes to purge
  when the bookmark is edited?).
- B — single episode with truncated content (4K char cap as today): entity
  extraction runs on title + long_summary + truncated head of transcript.
  Loses tail content from the *graph*.
- **Chosen: B + full transcript in pgvector**. Graph captures the entity
  surface (people, products, concepts named in the talk); semantic recall
  via pgvector captures the full content. The two complement: graph for
  structured navigation, vectors for "what was that thing about X" search.

If/when the operator wants graph nodes from mid-transcript-only content
(e.g. a side-anecdote that's not in the summary), Phase 4 can split the
transcript into thematic sub-episodes — but that's an unproven need.

## Schema

See `drizzle/0016_video_transcripts.sql`. Notable choices:

- `transcript` is `text` (TOAST'd by PG; not a perf concern at this scale).
  Selectors in card previews + lens queries MUST avoid `SELECT *` where this
  column would be pulled. Audit at PR review.
- `long_summary` is a separate column from `summary` so the 2-sentence card
  preview keeps working unchanged for non-video rows.
- `transcript_state` enum: `pending | fetching | ready | failed | unavailable | skipped`.
  `failed` is retryable (429, 5xx, network); `unavailable` is terminal
  (404 no captions, ASR rejected); `skipped` is policy (not a video, too long).
- `transcript_source` enum (free-form text, validated in code):
  `supadata-captions | supadata-asr | ytdlp-whisper | plexo-transcribe`.

## Pipeline insertion

`metadata.ts` flips `transcript_state = 'pending'` when YouTube oEmbed
succeeds AND `videoDurationSeconds <= MAX`. Cron + capture both call
`fetchTranscript(captureId)` which transitions `pending → fetching → ready`
(or terminal). Once `ready`, `generateLongSummary` runs (map-reduce via Plexo)
and writes `long_summary`. `embeddings.ts` prefers transcript over summary for
video rows. `graph-ingest.ts` composes title + long_summary + first 4K of
transcript per episode.

## Status

- 2026-06-16 — Accepted, implementation underway.
