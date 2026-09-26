import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// C2 — notes FTS. Asserts the search route uses Postgres FTS against
// notes.fts (the generated tsvector from drizzle/0013_notes_fts.sql),
// not a JS substring branch. The fallback ILIKE path is allowed only as
// a degradation when the column is missing on an older schema.

describe("notes FTS (C2)", () => {
  const route = readFileSync(
    join(process.cwd(), "app/api/search/route.ts"),
    "utf8"
  );

  it("queries notes.fts with websearch_to_tsquery", () => {
    expect(route).toMatch(/notes\}?\s*\.fts\s*@@\s*websearch_to_tsquery/);
  });

  it("ranks notes by ts_rank_cd on notes.fts", () => {
    expect(route).toMatch(/ts_rank_cd\(\$\{schema\.notes\}?\.fts/);
  });

  it("has a GIN-backed migration file (drizzle/0013_notes_fts.sql)", () => {
    const mig = readFileSync(
      join(process.cwd(), "drizzle/0013_notes_fts.sql"),
      "utf8"
    );
    expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS fts tsvector/);
    expect(mig).toMatch(/USING gin\s*\(\s*fts\s*\)/);
  });

  it("keeps ILIKE only as a fall-through inside a catch block", () => {
    // Find the notes branch and ensure ILIKE appears only after a `} catch {`.
    const notesBlockIdx = route.indexOf("// ── Notes branch");
    expect(notesBlockIdx).toBeGreaterThan(-1);
    const segment = route.slice(notesBlockIdx, notesBlockIdx + 4000);
    const ftsIdx = segment.indexOf("websearch_to_tsquery");
    const catchIdx = segment.indexOf("} catch");
    const ilikeIdx = segment.search(/ilike\(\s*schema\.notes\.title/);
    expect(ftsIdx).toBeGreaterThan(-1);
    expect(catchIdx).toBeGreaterThan(ftsIdx);
    expect(ilikeIdx).toBeGreaterThan(catchIdx);
  });
});
