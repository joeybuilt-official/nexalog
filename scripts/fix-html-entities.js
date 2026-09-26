#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (C) 2026 Joeybuilt LLC
//
// One-shot data-hygiene script for Team Delta (KG cleanup).
//
// Decodes HTML entities (numeric `&#xHEX;` / `&#DEC;` and named like `&amp;`)
// in nexalog.capture_sources og_title + og_description, and Unicode-NFC
// normalizes the result so Cyrillic mojibake from Telegram exports renders
// correctly in the graph + downstream Plexo memory.
//
// Idempotent: only writes back when the decoded value differs and is non-empty.
//
// Run inside the nexalog-web container so DATABASE_URL is set:
//   docker cp scripts/fix-html-entities.js nexalog-web:/tmp/
//   docker exec nexalog-web node /tmp/fix-html-entities.js
//
// Mirrored decoder: lib/decode-entities.ts (kept in sync intentionally; this
// script must run without the Next bundler so we duplicate the small map).

'use strict';

const { Client } = require('pg');

const NAMED = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
    nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
    laquo: '«', raquo: '»',
    lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
    copy: '©', reg: '®', trade: '™',
};

function decodeEntities(input) {
    if (input == null) return '';
    if (typeof input !== 'string') return String(input);
    if (input.indexOf('&') === -1) return input;
    return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) => {
        if (body[0] === '#') {
            const isHex = body[1] === 'x' || body[1] === 'X';
            const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
            if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
            try { return String.fromCodePoint(code); } catch { return match; }
        }
        const lower = body.toLowerCase();
        return Object.prototype.hasOwnProperty.call(NAMED, lower) ? NAMED[lower] : match;
    });
}

function clean(s) {
    if (s == null) return null;
    let out = decodeEntities(s);
    // Loop once more — sources can be double-encoded.
    if (out.indexOf('&') !== -1) out = decodeEntities(out);
    out = out.normalize('NFC');
    return out;
}

async function main() {
    const url = process.env.DATABASE_URL;
    if (!url) {
        console.error('DATABASE_URL missing'); process.exit(1);
    }
    const client = new Client({ connectionString: url });
    await client.connect();

    // search_path is set in the URL options (=-c search_path=nexalog) but be
    // defensive: qualify the schema explicitly.
    const { rows } = await client.query(
        "SELECT id, og_title, og_description FROM nexalog.capture_sources " +
        "WHERE og_title LIKE '%&#%' OR og_title LIKE '%&amp;%' OR og_title LIKE '%&quot;%' OR og_title LIKE '%&apos;%' " +
        "   OR og_description LIKE '%&#%' OR og_description LIKE '%&amp;%' OR og_description LIKE '%&quot;%' OR og_description LIKE '%&apos;%'"
    );

    console.log('candidates:', rows.length);

    let updated = 0, untouched = 0;
    for (const row of rows) {
        const newTitle = row.og_title != null ? clean(row.og_title) : null;
        const newDesc = row.og_description != null ? clean(row.og_description) : null;
        const titleChanged = newTitle !== row.og_title && newTitle && newTitle.length > 0;
        const descChanged = newDesc !== row.og_description && newDesc && newDesc.length > 0;
        if (!titleChanged && !descChanged) { untouched++; continue; }
        await client.query(
            'UPDATE nexalog.capture_sources SET og_title = COALESCE($2, og_title), og_description = COALESCE($3, og_description) WHERE id = $1',
            [row.id, titleChanged ? newTitle : null, descChanged ? newDesc : null]
        );
        updated++;
    }

    console.log('updated:', updated, 'untouched:', untouched);
    await client.end();
}

main().catch(err => { console.error('fix-html-entities failed:', err); process.exit(1); });
