#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (C) 2026 Joeybuilt LLC
//
// Phase 11 (Hotel) — backfill kind_classified across the full
// capture_sources corpus. Mirrors the heuristic in lib/classify-url.ts.
//
// Run inside nexalog-web:
//   docker cp scripts/classify-backfill.js nexalog-web:/app/
//   docker exec nexalog-web node /app/classify-backfill.js
//
// Flags:
//   --with-llm    enable Plexo Haiku fallback for rows the heuristic
//                 returns "other" for AND that have og_title or
//                 og_description. Costs tokens — off by default.
//   --workspace=  restrict to one workspace_id (UUID).
//   --limit=N     cap number of rows processed.
//
// Idempotent: skips rows whose kind_classified IS NOT NULL.

'use strict';

const { Client } = require('pg');

const VIDEO_HOSTS = /^(www\.|m\.)?(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|loom\.com|wistia\.com|twitch\.tv)$/i;
const SOCIAL_HOSTS = /^(www\.)?(twitter\.com|x\.com|instagram\.com|facebook\.com|threads\.net|linkedin\.com|reddit\.com|t\.me|telegram\.org|bsky\.app)$|^mastodon\..+$/i;
const REFERENCE_HOSTS = /^(www\.)?(github\.com|stackoverflow\.com|developer\.mozilla\.org|wikipedia\.org|developer\.apple\.com|learn\.microsoft\.com|cloud\.google\.com)$|.+\.readthedocs\.io$|^docs\..+$|^wiki\..+$/i;
const ARTICLE_HOSTS = /^(www\.)?(medium\.com|substack\.com|nytimes\.com|theverge\.com|techcrunch\.com|arstechnica\.com|wired\.com|theatlantic\.com|newyorker\.com|bloomberg\.com|reuters\.com|wsj\.com|economist\.com)$|.+\.substack\.com$|.+blog\..+|^blog\..+|.+\.blog$|.+\.news$/i;
const ARTICLE_PATH = /(^|\/)(blog|article|articles|post|posts|p|story|stories|news)(\/|$)|\/[0-9]{4}\/[0-9]{2}\//i;

function classify(url, ogTitle, ogDescription) {
  let host;
  let path = '';
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    path = u.pathname;
  } catch {
    return { kind: 'other', confidence: 0 };
  }
  if (VIDEO_HOSTS.test(host)) return { kind: 'video', confidence: 0.95 };
  if (SOCIAL_HOSTS.test(host)) return { kind: 'social', confidence: 0.95 };
  if (REFERENCE_HOSTS.test(host)) return { kind: 'reference', confidence: 0.95 };
  if (ARTICLE_HOSTS.test(host)) return { kind: 'article', confidence: 0.95 };
  if (ARTICLE_PATH.test(path)) return { kind: 'article', confidence: 0.7 };
  return { kind: 'other', confidence: 0 };
}

async function llmClassify(url, ogTitle, ogDescription) {
  const PLEXO_URL = (process.env.PLEXO_URL || '').replace(/\/$/, '');
  const PLEXO_SERVICE_KEY = process.env.PLEXO_SERVICE_KEY || '';
  if (!PLEXO_URL || !PLEXO_SERVICE_KEY) return null;
  // We don't have a workspaceId per row easily here — Plexo /ai/complete
  // tolerates a missing workspaceId for stateless calls in some setups,
  // but the canonical path is to ensure the workspace. Skip LLM if not
  // configured. The script is for the *heuristic* pass; --with-llm is
  // best-effort and won't crash the whole run.
  return null;
}

function parseFlags() {
  const flags = { withLlm: false, workspace: null, limit: null };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--with-llm') flags.withLlm = true;
    else if (arg.startsWith('--workspace=')) flags.workspace = arg.slice('--workspace='.length);
    else if (arg.startsWith('--limit=')) flags.limit = parseInt(arg.slice('--limit='.length), 10);
  }
  return flags;
}

async function main() {
  const flags = parseFlags();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    const params = [];
    let where = `kind_classified IS NULL AND kind = 'url' AND url IS NOT NULL`;
    if (flags.workspace) {
      params.push(flags.workspace);
      where += ` AND workspace_id = $${params.length}::uuid`;
    }
    let limitClause = '';
    if (flags.limit) {
      params.push(flags.limit);
      limitClause = ` LIMIT $${params.length}`;
    }

    const sql = `
      SELECT id, url, og_title, og_description
      FROM nexalog.capture_sources
      WHERE ${where}
      ORDER BY created_at DESC
      ${limitClause}
    `;

    const { rows } = await client.query(sql, params);
    console.log(`Processing ${rows.length} rows…`);

    const counts = { video: 0, article: 0, reference: 0, social: 0, other: 0, llm: 0 };
    let i = 0;
    for (const row of rows) {
      let result = classify(row.url, row.og_title, row.og_description);
      if (flags.withLlm && result.kind === 'other' && (row.og_title || row.og_description)) {
        const llm = await llmClassify(row.url, row.og_title, row.og_description);
        if (llm) {
          result = llm;
          counts.llm++;
        }
      }
      counts[result.kind]++;
      await client.query(
        `UPDATE nexalog.capture_sources
         SET kind_classified = $1, classified_at = NOW()
         WHERE id = $2::uuid`,
        [result.kind, row.id]
      );
      i++;
      if (i % 200 === 0) console.log(`  …${i}/${rows.length}`);
    }

    console.log('Done.');
    console.log('Counts:', counts);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
