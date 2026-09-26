#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (C) 2026 Joeybuilt LLC
//
// One-shot Team Delta script. Replaces generic platform og_titles
// ("YouTube", "Instagram", "Facebook", etc.) with something
// distinguishable so the KG / SCL pipeline doesn't collapse all
// social links into a single cluster.
//
// Strategy:
//   - YouTube      → public oEmbed (`https://www.youtube.com/oembed`),
//                    rate-limited at 5 req/s, retries on 429.
//   - Instagram, Facebook, TikTok, Telegram, Twitter, X
//                  → URL-path-based fallback like `Instagram: <slug>`
//                    (no fetch — these platforms bot-block).
//
// Idempotent: skips rows whose og_title is no longer one of the generic
// strings.
//
// Run inside nexalog-web:
//   docker cp scripts/refetch-generic-titles.js nexalog-web:/app/
//   docker exec nexalog-web node /app/refetch-generic-titles.js

'use strict';

const { Client } = require('pg');

const GENERIC = new Set(['YouTube','Facebook','Twitter','X','Instagram','TikTok','Telegram']);
const YT_RATE_PER_SEC = 5;
const YT_INTERVAL_MS = Math.ceil(1000 / YT_RATE_PER_SEC);

function decodeHtml(s) {
    if (typeof s !== 'string') return s;
    return s
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, ' ');
}

function isYouTubeUrl(u) {
    return /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|@|c\/|channel\/|user\/)|youtu\.be\/)/i.test(u);
}

async function fetchYouTubeOembed(url) {
    const api = 'https://www.youtube.com/oembed?url=' + encodeURIComponent(url) + '&format=json';
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const ctl = new AbortController();
            const t = setTimeout(() => ctl.abort(), 8000);
            const res = await fetch(api, {
                signal: ctl.signal,
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NexalogBookmarkBot/1.0)' },
            });
            clearTimeout(t);
            if (res.status === 429) {
                await sleep(2000);
                continue;
            }
            if (!res.ok) return null;
            const data = await res.json();
            const title = typeof data.title === 'string' ? decodeHtml(data.title).trim() : null;
            const author = typeof data.author_name === 'string' ? decodeHtml(data.author_name).trim() : null;
            if (!title) return null;
            // Prefix author when it isn't already in the title.
            if (author && !title.toLowerCase().includes(author.toLowerCase())) {
                return author + ': ' + title;
            }
            return title;
        } catch {
            return null;
        }
    }
    return null;
}

function urlPathTitle(platform, urlStr) {
    let u;
    try { u = new URL(urlStr); } catch { return null; }
    const parts = u.pathname.split('/').filter(Boolean);
    if (!parts.length) return null;
    // Common pattern for posts/reels: /p/<slug>, /reel/<slug>, /v/<slug>, /status/<id>
    const last = parts[parts.length - 1];
    const interesting = parts.find(p => /^[A-Za-z0-9_\-]{4,}$/.test(p) && !['p','reel','reels','video','post','status','watch','v','share','tv','c'].includes(p.toLowerCase())) || last;
    const cleaned = interesting.replace(/[_-]+/g, ' ').trim();
    if (!cleaned) return null;
    return platform + ': ' + cleaned;
}

function fallbackTitle(platform, urlStr) {
    return urlPathTitle(platform, urlStr) || (platform + ': ' + urlStr);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
    const url = process.env.DATABASE_URL;
    if (!url) { console.error('DATABASE_URL missing'); process.exit(1); }
    const client = new Client({ connectionString: url });
    await client.connect();

    const { rows } = await client.query(
        "SELECT id, og_title, url FROM nexalog.capture_sources WHERE og_title = ANY($1::text[])",
        [Array.from(GENERIC)]
    );
    console.log('candidates:', rows.length);

    let ytFetched = 0, ytFailed = 0, fallback = 0, untouched = 0;
    let lastYtAt = 0;
    for (const row of rows) {
        const platform = row.og_title;
        const u = row.url;
        if (!u) { untouched++; continue; }
        let newTitle = null;

        if (platform === 'YouTube' && isYouTubeUrl(u)) {
            const since = Date.now() - lastYtAt;
            if (since < YT_INTERVAL_MS) await sleep(YT_INTERVAL_MS - since);
            lastYtAt = Date.now();
            newTitle = await fetchYouTubeOembed(u);
            if (newTitle) ytFetched++; else ytFailed++;
        }

        if (!newTitle) {
            newTitle = fallbackTitle(platform, u);
            if (newTitle && newTitle !== platform) fallback++;
        }

        if (newTitle && newTitle !== platform) {
            await client.query('UPDATE nexalog.capture_sources SET og_title = $2 WHERE id = $1', [row.id, newTitle]);
        } else {
            untouched++;
        }
    }

    console.log('youtube fetched:', ytFetched, '| youtube failed:', ytFailed, '| fallback rewritten:', fallback, '| untouched:', untouched);
    await client.end();
}

main().catch(err => { console.error('refetch-generic-titles failed:', err); process.exit(1); });
