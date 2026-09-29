// SPDX-License-Identifier: MIT
/**
 * P2b ADR-0011 lens 2/3 — pins the filter-logic SQL fragment shapes the
 * `/api/queue/forgotten` + `/api/queue/related` routes are built from.
 *
 * HISTORY THAT MATTERS: this file used to assert fragments it built INLINE while
 * no route existed that used them — so it could not fail if a route got the shape
 * wrong, because there was no route. It now asserts the REAL fragments in
 * `lib/queue/lenses.ts`, which is what makes it a pin: change the cutoff, the
 * operator, or the NULL-handling and this file goes red.
 *
 * The routes themselves pull workspace + auth context, which is heavy to mock;
 * the lens rules — the part that would silently break a lens — live in the pure
 * module and are asserted here directly.
 */

import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";

import {
  FORGOTTEN_CUTOFF_DAYS,
  RELATED_COSINE_CEILING,
  RELATED_EDIT_EXCLUSION_DAYS,
  RELATED_NOTE_WINDOW_HOURS,
  centroidVector,
  cosineDistance,
  forgottenCutoff,
  forgottenFilter,
  liveCaptureFilter,
  notHomepageFilter,
  notSnoozedFilter,
  parseVectorLiteral,
  relatedEditExclusion,
  relatedEditExclusionCutoff,
  relatedSeedCutoff,
  toVectorLiteral,
} from "@/lib/queue/lenses";

// drizzle's SQL.toString() returns "[object Object]" outside a dialect; pull the
// literal chunks directly to assert fragment shape. Recursive because a fragment
// built from another fragment (the shared table reference) nests: a flat walk
// silently drops the embedded SQL and the assertion then reads a fragment that
// is missing its own table name — passing while proving nothing.
function fragText(s: ReturnType<typeof sql>): string {
  const chunks = (s as unknown as { queryChunks?: Array<unknown> }).queryChunks ?? [];
  return chunks
    .map((c) => {
      if (typeof c === "string") return c;
      if (typeof c !== "object" || c === null) return "";
      if ("queryChunks" in (c as Record<string, unknown>)) {
        return fragText(c as ReturnType<typeof sql>);
      }
      if ("value" in (c as Record<string, unknown>)) {
        const value = (c as { value: unknown }).value;
        return Array.isArray(value) ? value.map((v) => String(v)).join("") : String(value);
      }
      return "";
    })
    .join("");
}

describe("forgotten lens — filter fragments", () => {
  it("openedAt-or-null cutoff is 30 days back", () => {
    const now = new Date("2026-09-29T00:00:00Z");
    const cutoff = forgottenCutoff(now);
    const ageMs = now.getTime() - cutoff.getTime();
    expect(FORGOTTEN_CUTOFF_DAYS).toBe(30);
    expect(ageMs).toBe(FORGOTTEN_CUTOFF_DAYS * 24 * 60 * 60 * 1000);
  });

  it("filter expresses 'never opened OR opened > 30d ago', NULL-safely", () => {
    const cutoff = new Date("2026-05-28T00:00:00Z");
    const compiled = fragText(forgottenFilter(cutoff));
    // The IS NULL arm is the load-bearing half: a bare `opened_at < cutoff` is
    // NULL-unsafe and would drop every never-opened row — which, in this lens,
    // is every row that most deserves to surface.
    expect(compiled).toMatch(/opened_at IS NULL OR .*opened_at < /);
  });

  it("binds the cutoff as an ISO string with a ::timestamptz cast, never a raw Date", () => {
    // REGRESSION PIN. `db.execute` passes a JS `Date` to postgres.js as an untyped
    // parameter and postgres.js rejects it ("Failed query: ... $1"), so the raw-Date
    // form raised on EVERY call to /api/queue/forgotten and /api/queue/related —
    // proven against the live database, where the identical statement with the cast
    // returns. The previous assertions here matched only the surrounding prose and
    // therefore passed on the broken fragment; this one asserts the cast itself.
    const iso = "2026-05-28T00:00:00.000Z";
    for (const frag of [forgottenFilter(new Date(iso)), relatedEditExclusion(new Date(iso))]) {
      const compiled = fragText(frag);
      expect(compiled).toContain(`${iso}::timestamptz`);
    }
    // And the raw-Date form must be gone: a bare `$1`-bound Date would read as the
    // date's own string form with no cast after it.
    expect(fragText(forgottenFilter(new Date(iso)))).not.toMatch(/GMT|\(Coordinated/);
  });

  it("excludes homepages but keeps NULL-kind rows", () => {
    const compiled = fragText(notHomepageFilter());
    expect(compiled).toMatch(/<> 'homepage'/);
    expect(compiled).toMatch(/IS NULL/);
  });

  it("names the schema-qualified table, never a bare column", () => {
    // The app's pool sets no search_path, so an unqualified reference resolves
    // against whatever the driver's default is — or fails outright.
    expect(fragText(forgottenFilter(new Date()))).toContain("nexalog.capture_sources.opened_at");
    expect(fragText(notHomepageFilter())).toContain("nexalog.capture_sources.kind_classified");
  });
});

describe("every lens excludes rows the user filed away", () => {
  it("drops archived, smart-archived, soft-deleted and URL-less rows", () => {
    const compiled = fragText(liveCaptureFilter());
    expect(compiled).toMatch(/state <> 'archived'/);
    expect(compiled).toMatch(/smart_archived_at IS NULL/);
    expect(compiled).toMatch(/deleted_at IS NULL/);
    expect(compiled).toMatch(/url IS NOT NULL/);
  });

  it("honours a snooze until its due time passes", () => {
    const compiled = fragText(notSnoozedFilter());
    expect(compiled).toMatch(/nexalog\.queue_state/);
    expect(compiled).toMatch(/due_at > now\(\)/);
  });
});

describe("related lens — pgvector fragment", () => {
  it("uses public-schema cosine operator on a ::public.vector literal", () => {
    // The `public.` qualification is REQUIRED: an unqualified `<=>` raises
    // SQLSTATE 42883 at runtime, because the extension's operator lives in
    // `public` and is not on the session search_path for operators. Removing
    // either half breaks the lens at runtime and nothing else would catch it.
    const compiled = fragText(cosineDistance("[0.1,0.2,0.3]"));
    expect(compiled).toMatch(/OPERATOR\(public\.<=>\)/);
    expect(compiled).toMatch(/::public\.vector/);
    expect(compiled).toContain("nexalog.capture_sources.embedding");
  });

  it("note window is 24h; capture-edit exclusion is 7d", () => {
    expect(RELATED_NOTE_WINDOW_HOURS).toBe(24);
    expect(RELATED_EDIT_EXCLUSION_DAYS).toBe(7);

    const now = new Date("2026-09-29T12:00:00Z");
    expect(now.getTime() - relatedSeedCutoff(now).getTime()).toBe(24 * 60 * 60 * 1000);
    expect(now.getTime() - relatedEditExclusionCutoff(now).getTime()).toBe(
      7 * 24 * 60 * 60 * 1000,
    );
  });

  it("exclusion fragment compares the row's own updated_at", () => {
    const compiled = fragText(relatedEditExclusion(new Date("2026-09-22T00:00:00Z")));
    expect(compiled).toContain("nexalog.capture_sources.updated_at < ");
    // Same ISO+cast contract as the forgotten lens (see the pin above): this is the
    // second of the two fragments that raised on every live call.
    expect(compiled).toContain("2026-09-22T00:00:00.000Z::timestamptz");
  });

  it("centroid mean+normalize collapses to unit vector", () => {
    const centroid = centroidVector([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
    expect(centroid).not.toBeNull();
    let mag = 0;
    for (const x of centroid!) mag += x * x;
    expect(Math.sqrt(mag)).toBeCloseTo(1, 12);
    // The mean of three unit axes is (1/3,1/3,1/3) before normalization, so
    // every component stays equal — a direction equally close to all three.
    expect(centroid![0]).toBeCloseTo(centroid![1], 12);
    expect(centroid![1]).toBeCloseTo(centroid![2], 12);
  });

  it("refuses a centroid that has no direction rather than normalizing noise", () => {
    // Opposed seeds cancel toward the origin. Normalizing that would amplify
    // float noise into a direction and rank arbitrary rows as "related".
    expect(centroidVector([[1, 0], [-1, 0]])).toBeNull();
    expect(centroidVector([])).toBeNull();
    expect(centroidVector([[0, 0]])).toBeNull();
  });

  it("refuses a mixed-dimension seed set instead of padding it", () => {
    expect(centroidVector([[1, 0], [1, 0, 0]])).toBeNull();
  });

  it("refuses a non-finite component", () => {
    expect(centroidVector([[1, Number.NaN]])).toBeNull();
    expect(centroidVector([[1, Number.POSITIVE_INFINITY]])).toBeNull();
  });

  it("cosine-distance ceiling 0.4 drops a 0.5 result", () => {
    expect(RELATED_COSINE_CEILING).toBe(0.4);
    const rows = [{ dist: 0.1 }, { dist: 0.39 }, { dist: 0.5 }];
    const kept = rows.filter((r) => r.dist < RELATED_COSINE_CEILING);
    expect(kept.map((r) => r.dist)).toEqual([0.1, 0.39]);
  });
});

describe("vector literal round-trip", () => {
  it("parses a pgvector text literal", () => {
    expect(parseVectorLiteral("[0.1, -0.2, 0.3]")).toEqual([0.1, -0.2, 0.3]);
  });

  it("parses an empty vector as an empty list, not null", () => {
    expect(parseVectorLiteral("[]")).toEqual([]);
  });

  it("rejects a literal with a non-numeric component", () => {
    expect(parseVectorLiteral("[0.1, nope]")).toBeNull();
  });

  it("emits the literal pgvector accepts — never a Postgres array", () => {
    // postgres.js serializes a JS array as `{1,2,3}`, which pgvector rejects;
    // the value must go over as TEXT and be cast in SQL.
    const lit = toVectorLiteral([0.1, 0.2, 0.3]);
    expect(lit).toBe("[0.1,0.2,0.3]");
    expect(lit.startsWith("{")).toBe(false);
  });

  it("round-trips through the literal form", () => {
    const v = [0.25, -0.5, 0.75];
    expect(parseVectorLiteral(toVectorLiteral(v))).toEqual(v);
  });
});
