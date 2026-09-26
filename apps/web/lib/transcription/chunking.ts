// SPDX-License-Identifier: MIT
//
// Transcript chunking + sampling helpers. Used by embedding (head/mid/tail
// sample, like lib/importers/process-conversations.ts) and by the long-form
// summary's map-reduce stage.

const DEFAULT_EMBED_BUDGET = 4_000;
const DEFAULT_CHUNK_CHARS = 6_000;
const DEFAULT_OVERLAP = 400;

/**
 * Head/mid/tail sampler for embedding very long transcripts. For texts under
 * the budget, returns the text unchanged; for longer texts, takes three
 * proportional slices (1/3 head + 1/3 mid + 1/3 tail) joined with " … " so
 * the embedding captures opening framing, mid-content topics, and closing
 * conclusions. Mirrors `conversationEmbeddingText` in process-conversations.
 */
export function sampleForEmbedding(
  text: string,
  budget = DEFAULT_EMBED_BUDGET,
): string {
  const trimmed = (text ?? "").trim();
  if (trimmed.length <= budget) return trimmed;
  const slice = Math.max(400, Math.floor((budget - 6) / 3));
  const head = trimmed.slice(0, slice);
  const midStart = Math.max(slice, Math.floor((trimmed.length - slice) / 2));
  const mid = trimmed.slice(midStart, midStart + slice);
  const tail = trimmed.slice(trimmed.length - slice);
  return `${head} … ${mid} … ${tail}`;
}

/**
 * Map-stage chunker for long-form summary. Splits on paragraph/sentence
 * boundaries when possible so a single thought isn't ripped mid-sentence;
 * falls back to hard character cuts for unbroken text. Overlap keeps a tail
 * of one chunk's last `overlap` chars into the next so cross-chunk context
 * (e.g. a speaker introduced at the end of chunk N and quoted at chunk N+1)
 * isn't lost.
 */
export function chunkForSummary(
  text: string,
  chunkChars = DEFAULT_CHUNK_CHARS,
  overlap = DEFAULT_OVERLAP,
): string[] {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return [];
  if (trimmed.length <= chunkChars) return [trimmed];

  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < trimmed.length) {
    const end = Math.min(cursor + chunkChars, trimmed.length);
    let cut = end;
    if (end < trimmed.length) {
      // Prefer a paragraph break in the last 20% of the window; then a
      // sentence end; then a word boundary.
      const window = trimmed.slice(cursor, end);
      const tailStart = Math.floor(window.length * 0.8);
      const para = window.lastIndexOf("\n\n", window.length - 1);
      const sentence = Math.max(
        window.lastIndexOf(". ", window.length - 1),
        window.lastIndexOf("? ", window.length - 1),
        window.lastIndexOf("! ", window.length - 1),
      );
      const word = window.lastIndexOf(" ", window.length - 1);
      const cand = [para, sentence, word].filter((i) => i >= tailStart).sort((a, b) => b - a)[0];
      if (typeof cand === "number" && cand > 0) cut = cursor + cand + 1;
    }
    chunks.push(trimmed.slice(cursor, cut).trim());
    if (cut >= trimmed.length) break;
    cursor = Math.max(cut - overlap, cursor + 1);
  }
  return chunks.filter((c) => c.length > 0);
}
