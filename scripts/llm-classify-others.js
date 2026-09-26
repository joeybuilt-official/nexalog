#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (C) 2026 Joeybuilt LLC
//
// Team Lima — one-shot LLM enrichment for capture_sources rows still
// stamped kind_classified='other'. Calls Plexo /api/v1/ai/complete with
// taskType='classification' (default model: claude-haiku-4-5) and writes
// the new kind back, plus an optional `evergreen` flag for article/reference.
//
// Usage (inside nexalog-web):
//   docker exec nexalog-web node /app/scripts/llm-classify-others.js
//
// Flags:
//   --workspace=<uuid>   override target workspace (default: the configured target workspace)
//   --infer-workspace=<uuid>  override workspace whose AI creds we borrow
//   --limit=N            cap rows processed (debug)
//   --batch=N            DB fetch batch size (default 50)
//   --rps=N              requests/second to Plexo (default 5)
//   --dry                don't UPDATE rows, just log
//
// Idempotent: skips rows whose classified_at > now() - interval '1 hour'.

'use strict'

const { Client } = require('pg')

// ---------- config ----------
const TARGET_WORKSPACE = '<target-workspace-uuid>'
// Workspace whose AI provider creds we use (the operator's BYOK with Anthropic).
// Must have an enabled Anthropic provider so Plexo's classification
// taskType resolves to claude-haiku-4-5.
const INFERENCE_WORKSPACE = '<inference-workspace-uuid>'

const VALID_KINDS = new Set(['video', 'article', 'reference', 'social', 'homepage', 'other'])

// ---------- flags ----------
function parseFlags() {
    const f = {
        workspace: TARGET_WORKSPACE,
        inferWorkspace: INFERENCE_WORKSPACE,
        limit: null,
        batch: 50,
        rps: 5,
        dry: false,
    }
    for (const a of process.argv.slice(2)) {
        if (a === '--dry') f.dry = true
        else if (a.startsWith('--workspace=')) f.workspace = a.slice('--workspace='.length)
        else if (a.startsWith('--infer-workspace=')) f.inferWorkspace = a.slice('--infer-workspace='.length)
        else if (a.startsWith('--limit=')) f.limit = parseInt(a.slice('--limit='.length), 10)
        else if (a.startsWith('--batch=')) f.batch = parseInt(a.slice('--batch='.length), 10)
        else if (a.startsWith('--rps=')) f.rps = parseFloat(a.slice('--rps='.length))
    }
    return f
}

// ---------- LLM ----------
async function llmClassify({ url, ogTitle, ogDescription }, opts) {
    const title = (ogTitle || '').trim().slice(0, 240)
    const desc = (ogDescription || '').trim().slice(0, 600)

    const prompt =
        'Classify this saved link into ONE of these kinds: video, article, reference, social, homepage, other.\n' +
        '\n' +
        'Definitions:\n' +
        '- video: video player page (youtube, vimeo, tiktok, twitch, etc.)\n' +
        '- article: blog post, news story, essay, magazine piece\n' +
        '- reference: docs, API ref, wiki, technical reference, encyclopedia\n' +
        '- social: post/profile/thread on a social network\n' +
        '- homepage: a brand/product/site root, no specific article\n' +
        '- other: tools, apps, dashboards, downloads, search results, anything that fits none of the above\n' +
        '\n' +
        'Also set evergreen=true ONLY for article/reference content that is timeless (no date-bound news, no breaking events). Otherwise evergreen=false.\n' +
        '\n' +
        'Output strict JSON only (no markdown, no prose), exactly this shape:\n' +
        '{"kind":"<kind>","evergreen":<true|false>}\n' +
        '\n' +
        `URL: ${url}\n` +
        `Title: ${title}\n` +
        `Description: ${desc}`

    const res = await fetch(`${opts.plexoUrl}/api/v1/ai/complete`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${opts.serviceKey}`,
            'X-App-Id': 'nexalog',
        },
        body: JSON.stringify({
            workspaceId: opts.inferWorkspaceId,
            taskType: 'classification',
            messages: [{ role: 'user', content: prompt }],
            maxTokens: 64,
        }),
        signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
    }
    const data = await res.json()
    const text = (data && data.text) ? String(data.text).trim() : ''
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) throw new Error(`no JSON in response: ${text.slice(0, 200)}`)
    let parsed
    try { parsed = JSON.parse(m[0]) } catch (e) { throw new Error(`bad JSON: ${m[0].slice(0, 200)}`) }
    let kind = String(parsed.kind || '').toLowerCase()
    if (!VALID_KINDS.has(kind)) kind = 'other'
    const evergreen = parsed.evergreen === true && (kind === 'article' || kind === 'reference')
    // approx token count from the request — used for cost estimate only
    const approxInput = Math.ceil((prompt.length + 32) / 4)
    const approxOutput = Math.ceil(text.length / 4)
    return { kind, evergreen, approxInput, approxOutput }
}

// ---------- rate limiter ----------
function makeLimiter(rps) {
    const minSpacing = 1000 / Math.max(0.1, rps)
    let next = 0
    return async function gate() {
        const now = Date.now()
        const wait = Math.max(0, next - now)
        next = Math.max(now, next) + minSpacing
        if (wait > 0) await new Promise(r => setTimeout(r, wait))
    }
}

// ---------- main ----------
async function main() {
    const flags = parseFlags()
    const PLEXO_URL = (process.env.PLEXO_URL || '').replace(/\/$/, '')
    const PLEXO_SERVICE_KEY = process.env.PLEXO_SERVICE_KEY || ''
    const DATABASE_URL = process.env.DATABASE_URL || ''

    if (!PLEXO_URL || !PLEXO_SERVICE_KEY) {
        console.error('PLEXO_URL or PLEXO_SERVICE_KEY missing in env')
        process.exit(1)
    }
    if (!DATABASE_URL) {
        console.error('DATABASE_URL missing in env')
        process.exit(1)
    }

    console.log('[llm-classify-others] starting', {
        workspace: flags.workspace,
        inferWorkspace: flags.inferWorkspace,
        limit: flags.limit,
        batch: flags.batch,
        rps: flags.rps,
        dry: flags.dry,
    })

    const client = new Client({ connectionString: DATABASE_URL })
    await client.connect()

    const counts = { video: 0, article: 0, reference: 0, social: 0, homepage: 0, other: 0 }
    const errors = []
    const evergreenCount = { article: 0, reference: 0 }
    const samples = []
    let processed = 0
    let skipped = 0
    let approxInputTokens = 0
    let approxOutputTokens = 0
    const gate = makeLimiter(flags.rps)
    const startedAt = Date.now()

    try {
        // Pull all candidate ids up front (cheap, just IDs).
        const limitClause = flags.limit ? `LIMIT ${flags.limit}` : ''
        const idsRes = await client.query(
            `SELECT id, url, og_title, og_description
             FROM nexalog.capture_sources
             WHERE workspace_id = $1::uuid
               AND kind_classified = 'other'
               AND url IS NOT NULL
               AND (classified_at IS NULL OR classified_at < now() - interval '1 hour')
             ORDER BY created_at DESC
             ${limitClause}`,
            [flags.workspace]
        )
        const total = idsRes.rows.length
        console.log(`[llm-classify-others] candidate rows: ${total}`)
        if (total === 0) { await client.end(); return }

        for (let offset = 0; offset < idsRes.rows.length; offset += flags.batch) {
            const batch = idsRes.rows.slice(offset, offset + flags.batch)
            for (const row of batch) {
                await gate()
                let result
                try {
                    result = await llmClassify(
                        { url: row.url, ogTitle: row.og_title, ogDescription: row.og_description },
                        { plexoUrl: PLEXO_URL, serviceKey: PLEXO_SERVICE_KEY, inferWorkspaceId: flags.inferWorkspace }
                    )
                } catch (err) {
                    errors.push({ id: row.id, url: row.url, err: String(err.message || err) })
                    if (errors.length <= 5) console.error(`  ERR ${row.url}: ${err.message || err}`)
                    continue
                }

                approxInputTokens += result.approxInput
                approxOutputTokens += result.approxOutput
                counts[result.kind]++
                if (result.evergreen) evergreenCount[result.kind]++

                if (!flags.dry) {
                    await client.query(
                        `UPDATE nexalog.capture_sources
                           SET kind_classified = $1,
                               classified_at = now(),
                               evergreen = CASE
                                   WHEN $1 IN ('article','reference') THEN $2
                                   ELSE evergreen
                               END
                         WHERE id = $3::uuid`,
                        [result.kind, result.evergreen, row.id]
                    )
                }
                processed++
                if (samples.length < 5 && result.kind !== 'other') {
                    samples.push({ url: row.url, title: row.og_title, kind: result.kind, evergreen: result.evergreen })
                }
                if (processed % 100 === 0) {
                    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
                    console.log(`  ${processed}/${total} (${elapsed}s) | ${JSON.stringify(counts)}`)
                }

                // Cost ceiling guardrail — Haiku 4.5: $1/M in, $5/M out (approx).
                const costIn = (approxInputTokens / 1_000_000) * 1.0
                const costOut = (approxOutputTokens / 1_000_000) * 5.0
                if (costIn + costOut > 1.0) {
                    console.error(`Cost ceiling hit: $${(costIn + costOut).toFixed(4)} — stopping.`)
                    throw new Error('COST_CEILING')
                }
            }
        }
    } catch (e) {
        if (e.message !== 'COST_CEILING') console.error('[llm-classify-others] fatal:', e)
    } finally {
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
        const costIn = (approxInputTokens / 1_000_000) * 1.0
        const costOut = (approxOutputTokens / 1_000_000) * 5.0
        console.log('---')
        console.log('[llm-classify-others] done', {
            processed,
            skipped,
            elapsed_sec: Number(elapsed),
            distribution: counts,
            evergreen: evergreenCount,
            errors: errors.length,
            approx_input_tokens: approxInputTokens,
            approx_output_tokens: approxOutputTokens,
            est_cost_usd: Number((costIn + costOut).toFixed(4)),
        })
        if (samples.length) {
            console.log('samples:', JSON.stringify(samples, null, 2))
        }
        if (errors.length) {
            console.log('first 5 errors:', JSON.stringify(errors.slice(0, 5), null, 2))
        }
        await client.end()
    }
}

main().catch((err) => { console.error(err); process.exit(1) })
