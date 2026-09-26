// SPDX-License-Identifier: MIT
// One-shot backfill: re-validate every stored capture_sources.favicon_url and
// NULL the ones that no longer resolve to a real image. Pairs with the
// enrichment change that stops storing guessed /favicon.ico URLs. Idempotent —
// safe to re-run. Reads DATABASE_URL from the environment (nexalog schema).
//
// Usage (inside the nexalog-web container or with DATABASE_URL set):
//   node scripts/backfill-favicons.mjs
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

const sql = postgres(url, { prepare: false });

async function isReachableImage(target) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(target, {
      method: "GET",
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NexalogBot/1.0; +https://nexalog.com)",
        Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
      },
    });
    const ct = res.headers.get("content-type") ?? "";
    try { await res.body?.cancel(); } catch { /* ignore */ }
    return res.ok && ct.startsWith("image/");
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const rows = await sql`
  select id, favicon_url
  from nexalog.capture_sources
  where favicon_url is not null and favicon_url <> ''
`;

console.log(`checking ${rows.length} stored favicons…`);
let nulled = 0, kept = 0, i = 0;
const CONCURRENCY = 8;

async function worker(slice) {
  for (const row of slice) {
    const ok = await isReachableImage(row.favicon_url);
    if (ok) { kept++; }
    else {
      await sql`update nexalog.capture_sources set favicon_url = null where id = ${row.id}`;
      nulled++;
    }
    if (++i % 100 === 0) console.log(`  …${i}/${rows.length} (nulled ${nulled})`);
  }
}

// simple fixed-size worker pool over the row list
const chunks = Array.from({ length: CONCURRENCY }, () => []);
rows.forEach((r, idx) => chunks[idx % CONCURRENCY].push(r));
await Promise.all(chunks.map(worker));

console.log(`done. kept ${kept}, nulled ${nulled} invalid favicons.`);
await sql.end();
