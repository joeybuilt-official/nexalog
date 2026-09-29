// SPDX-License-Identifier: MIT
/**
 * The plan-impact window's SQL fragments, pinned — the same split (and the same
 * reasoning) as `lib/__tests__/forgotten-related.test.ts` for the queue lenses.
 *
 * The rules that would silently break this feature are all in the pure module:
 *
 *   - the window is on `COALESCE(bookmarked_at, created_at)`. On `created_at`
 *     ALONE a bulk import proposes a plan change for every bookmark it carries (the
 *     stampede the acceptance bar forbids); on `bookmarked_at` ALONE every
 *     manual/extension save — which writes no `bookmarked_at` — is silently
 *     skipped forever. Both directions are asserted.
 *   - the liveness clauses match the queue lenses: archived, soft-deleted and
 *     URL-less rows are out.
 *   - the limit is CLAMPED, so a caller cannot ask for an unbounded pass over the
 *     whole 4,446-row capture table by passing a big number.
 *   - the title never falls back to a URL. A claim reading "Plan change on
 *     projects/fylo — add: https://…" is unreadable, and it is what a naive
 *     `url ?? title` fallback would produce.
 *
 * Fragments are compared by their literal chunks: drizzle's `SQL.toString()` is
 * "[object Object]" outside a dialect, so the chunks are walked directly. The walk
 * is RECURSIVE because a fragment built from another fragment nests — a flat walk
 * silently drops the embedded SQL and then asserts against a fragment missing its
 * own table name, which passes while proving nothing.
 */

import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";

import {
  PLAN_IMPACT_DEFAULT_LIMIT,
  PLAN_IMPACT_MAX_LIMIT,
  PLAN_IMPACT_WINDOW_HOURS,
  clampPlanImpactLimit,
  effectiveCaptureDate,
  liveLinkCaptureFilter,
  planImpactCaptureTitle,
  planImpactSince,
  planImpactWindow,
} from "@/lib/plan-impact/lenses";

function fragText(s: ReturnType<typeof sql>): string {
  const chunks = (s as unknown as { queryChunks?: Array<unknown> }).queryChunks ?? [];
  return chunks
    .map((c) => {
      if (typeof c === "string") return c;
      if (typeof c !== "object" || c === null) return "";
      if ("queryChunks" in (c as Record<string, unknown>)) return fragText(c as ReturnType<typeof sql>);
      if ("value" in (c as Record<string, unknown>)) {
        const v = (c as { value: unknown }).value;
        return Array.isArray(v) ? v.join("") : String(v);
      }
      return "";
    })
    .join("");
}

describe("the plan-impact window fragment", () => {
  it("keys the window on the EFFECTIVE save date, not on created_at or bookmarked_at alone", () => {
    const text = fragText(effectiveCaptureDate());
    expect(text).toContain("nexalog.capture_sources");
    expect(text).toContain("COALESCE");
    expect(text).toContain("bookmarked_at");
    expect(text).toContain("created_at");

    // The predicate must be built from THAT expression, or an import stampedes.
    const predicate = fragText(planImpactWindow(new Date("2026-09-28T00:00:00Z")));
    expect(predicate).toContain("COALESCE");
    expect(predicate).toContain(">=");
  });

  it("binds the window bound as an ISO string cast in SQL, never as a raw Date", () => {
    // Executed against the live databases: a bare `Date` parameter reaches
    // postgres.js as a JS object and is rejected with ERR_INVALID_ARG_TYPE, so the
    // statement fails at runtime while looking identical as text. The CAST is the
    // difference, and it is asserted here because no text-only assertion can see it.
    const text = fragText(planImpactWindow(new Date("2026-09-28T00:00:00Z")));
    expect(text).toContain("::timestamptz");
    expect(text).toContain("2026-09-28T00:00:00.000Z");
  });

  it("excludes archived, soft-deleted and URL-less captures", () => {
    const text = fragText(liveLinkCaptureFilter());
    expect(text).toContain("state <> 'archived'");
    expect(text).toContain("deleted_at IS NULL");
    expect(text).toContain("url IS NOT NULL");
  });
});

describe("clampPlanImpactLimit", () => {
  it("defaults a missing or nonsense limit", () => {
    expect(clampPlanImpactLimit(undefined)).toBe(PLAN_IMPACT_DEFAULT_LIMIT);
    expect(clampPlanImpactLimit("nope")).toBe(PLAN_IMPACT_DEFAULT_LIMIT);
    expect(clampPlanImpactLimit(0)).toBe(PLAN_IMPACT_DEFAULT_LIMIT);
    expect(clampPlanImpactLimit(-5)).toBe(PLAN_IMPACT_DEFAULT_LIMIT);
  });

  it("clamps a huge limit rather than honouring it", () => {
    expect(clampPlanImpactLimit(10_000)).toBe(PLAN_IMPACT_MAX_LIMIT);
  });

  it("passes a sane limit through, floored to an integer", () => {
    expect(clampPlanImpactLimit(25)).toBe(25);
    expect(clampPlanImpactLimit("40")).toBe(40);
    expect(clampPlanImpactLimit(12.7)).toBe(12);
  });
});

describe("planImpactSince", () => {
  it("is the window in hours before now", () => {
    const now = new Date("2026-09-28T12:00:00Z");
    // 24h back: a full day before the pass's instant.
    expect(planImpactSince(now).toISOString()).toBe("2026-09-27T12:00:00.000Z");
    expect(planImpactSince(now, 48).toISOString()).toBe("2026-09-26T12:00:00.000Z");
    expect(planImpactSince(now, 1).toISOString()).toBe("2026-09-28T11:00:00.000Z");
    expect(PLAN_IMPACT_WINDOW_HOURS).toBe(24);
  });
});

describe("planImpactCaptureTitle", () => {
  it("prefers the rescued title, then og:title, then a host-derived fallback", () => {
    expect(
      planImpactCaptureTitle({
        derived_title: "Rescued",
        og_title: "OG",
        url_host: "example.com",
      }),
    ).toBe("Rescued");
    expect(planImpactCaptureTitle({ og_title: "OG", url_host: "example.com" })).toBe("OG");
    expect(planImpactCaptureTitle({ url_host: "example.com" })).toBe("Link on example.com");
    expect(planImpactCaptureTitle({})).toBe("Untitled capture");
  });

  it("never returns a URL as the title", () => {
    // There is no code path that can: the fallbacks are title, og, host, literal.
    const title = planImpactCaptureTitle({ derived_title: null, og_title: null, url_host: "host.tld" });
    expect(title).not.toMatch(/^https?:/);
  });

  it("tolerates the camelCase spelling too, so a caller need not reshape a row", () => {
    expect(planImpactCaptureTitle({ derivedTitle: "Camel" })).toBe("Camel");
    expect(planImpactCaptureTitle({ ogTitle: "OG camel" })).toBe("OG camel");
    expect(planImpactCaptureTitle({ urlHost: "camel.tld" })).toBe("Link on camel.tld");
  });

  it("treats a blank value as absent rather than returning whitespace", () => {
    expect(planImpactCaptureTitle({ derived_title: "   ", og_title: "OG" })).toBe("OG");
  });
});
