/* Phase 11 backfill — run AFTER applying drizzle/0001_phase11_capture_sources.sql.
 *
 * Operator refinement applied:
 *   - Only reclassify rows where kind_classified IS NULL OR kind_classified = 'other'
 *     (rows already labeled video/article/reference/social keep their label).
 *   - Homepage detector runs on those rows only; that's where misclassified
 *     homepages are hiding.
 *
 * Usage:
 *   pnpm tsx scripts/phase11-backfill.ts
 *
 * Built-in self-tests run first (no DB) so a wrong classifier never reaches prod data.
 */

import { db, schema } from "../lib/db";
import { isNull, or, eq, and, isNotNull } from "drizzle-orm";
import { classifyUrl, type ClassifiedKind } from "../lib/capture/classifier";

interface ClassifierTest {
  url: string;
  expected: ClassifiedKind;
}

const TESTS: ClassifierTest[] = [
  // homepage cases
  { url: "https://nissan.com", expected: "homepage" },
  { url: "https://www.microsoft.com/", expected: "homepage" },
  { url: "https://github.com/", expected: "homepage" },
  { url: "https://apple.com/about", expected: "homepage" },
  { url: "https://example.com/?utm_source=newsletter", expected: "homepage" },
  // youtube root vs watch
  { url: "https://youtube.com/", expected: "homepage" },
  { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", expected: "video" },
  { url: "https://youtu.be/dQw4w9WgXcQ", expected: "video" },
  // article
  { url: "https://blog.example.com/posts/why-tcp", expected: "article" },
  { url: "https://medium.com/@alice/foo-bar", expected: "article" },
  // reference
  { url: "https://docs.djangoproject.com/en/5.0/topics/db/queries/", expected: "reference" },
  { url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map", expected: "reference" },
  // social
  { url: "https://x.com/some_user/status/123", expected: "social" },
  { url: "https://twitter.com/handle", expected: "social" },
];

function runSelfTests(): void {
  let failed = 0;
  for (const t of TESTS) {
    const got = classifyUrl({ url: t.url, ogType: null });
    if (got.kind !== t.expected) {
      console.error(`FAIL ${t.url} -> ${got.kind} (expected ${t.expected})`);
      failed++;
    }
  }
  if (failed > 0) {
    console.error(`Classifier self-tests: ${failed} failures. Aborting backfill.`);
    process.exit(1);
  }
  console.log(`Classifier self-tests: ${TESTS.length}/${TESTS.length} passed.`);
}

async function backfill(): Promise<void> {
  // Only touch rows that need it: NULL or 'other'.
  const rows = await db
    .select()
    .from(schema.captureSources)
    .where(
      and(
        eq(schema.captureSources.kind, "url"),
        isNotNull(schema.captureSources.url),
        or(
          isNull(schema.captureSources.kindClassified),
          eq(schema.captureSources.kindClassified, "other")
        )
      )
    );

  console.log(`Rows to (re)classify: ${rows.length}`);

  const counts: Record<string, number> = {};
  let updated = 0;

  for (const row of rows) {
    if (!row.url) continue;
    const c = classifyUrl({ url: row.url, ogType: row.ogType });
    counts[c.kind] = (counts[c.kind] ?? 0) + 1;

    // Don't downgrade a classifier output: if classifier still says 'other'
    // and the row was already 'other', skip the write.
    if (row.kindClassified === c.kind && row.urlHost === c.host && row.urlPath === c.path) {
      continue;
    }

    await db
      .update(schema.captureSources)
      .set({
        kindClassified: c.kind,
        urlHost: c.host,
        urlPath: c.path,
      })
      .where(eq(schema.captureSources.id, row.id));
    updated++;
  }

  console.log("Classification counts:", counts);
  console.log(`Updated: ${updated}`);

  // Verification: spot-check homepages and youtube watches.
  const homepages = await db
    .select({ url: schema.captureSources.url, host: schema.captureSources.urlHost })
    .from(schema.captureSources)
    .where(eq(schema.captureSources.kindClassified, "homepage"))
    .limit(10);
  console.log("Sample homepages:", homepages);

  const videos = await db
    .select({ url: schema.captureSources.url, host: schema.captureSources.urlHost })
    .from(schema.captureSources)
    .where(eq(schema.captureSources.kindClassified, "video"))
    .limit(5);
  console.log("Sample videos (should NOT include youtube.com root):", videos);
}

async function main(): Promise<void> {
  runSelfTests();
  await backfill();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
