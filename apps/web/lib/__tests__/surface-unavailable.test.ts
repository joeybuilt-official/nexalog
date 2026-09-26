// SPDX-License-Identifier: MIT
/**
 * Unit tests for the missing-relation matcher itself.
 *
 * The routes assert the *behaviour* (503 + honest body); this file pins the
 * *detection*, because that is the part that silently rots when the driver
 * changes how it wraps errors. A missed wrap means every v1 route quietly
 * returns to 500ing in production with these tests still green.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { logEvent } = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logEvent }));

import {
  findMissingRelation,
  surfaceUnavailableIfMissingRelation,
} from "@/lib/db/surface-unavailable";

/** Driver error, as `postgres` throws it (code + severity, name PostgresError). */
function driverError(code: string, message: string) {
  return Object.assign(new Error(message), { code, name: "PostgresError" });
}

/** Drizzle's wrapper, as drizzle-orm 0.45 throws it. */
function drizzleWrap(cause: unknown) {
  return Object.assign(new Error("Failed query: select ..."), {
    name: "DrizzleQueryError",
    cause,
  });
}

beforeEach(() => logEvent.mockReset());

describe("findMissingRelation", () => {
  it("finds 42P01 through drizzle's wrapper and names the relation", () => {
    const err = drizzleWrap(driverError("42P01", 'relation "nexalog.notes" does not exist'));
    expect(findMissingRelation(err)).toEqual({ relation: "nexalog.notes" });
  });

  it("finds a bare driver error (no wrapper)", () => {
    const err = driverError("42P01", 'relation "nexalog.workspaces" does not exist');
    expect(findMissingRelation(err)).toEqual({ relation: "nexalog.workspaces" });
  });

  it("covers a missing SCHEMA too (postgres reports it as a missing relation)", () => {
    const err = drizzleWrap(
      driverError("42P01", 'relation "nexalog.notes" does not exist'),
    );
    expect(findMissingRelation(err)?.relation).toBe("nexalog.notes");
  });

  it("returns the relation as null when the message does not name one", () => {
    expect(findMissingRelation(driverError("42P01", "undefined table"))).toEqual({
      relation: null,
    });
  });

  it("ignores every other error code", () => {
    for (const code of ["23505", "28P01", "ECONNREFUSED", "57P03"]) {
      expect(findMissingRelation(driverError(code, "nope")), code).toBeNull();
    }
  });

  it("survives non-error inputs without throwing", () => {
    for (const v of [null, undefined, 0, "", "boom", {}, [], { code: 42 }]) {
      expect(findMissingRelation(v)).toBeNull();
    }
  });

  it("does not walk an unbounded cause chain", () => {
    let err: unknown = driverError("42P01", 'relation "x" does not exist');
    // Bury it deeper than the walk allows: a runaway cycle must not hang.
    for (let i = 0; i < 20; i += 1) err = { cause: err };
    expect(findMissingRelation(err)).toBeNull();
  });

  it("handles a self-referential cause chain without looping forever", () => {
    const err: Record<string, unknown> = {};
    err.cause = err;
    expect(findMissingRelation(err)).toBeNull();
  });
});

describe("surfaceUnavailableIfMissingRelation", () => {
  it("returns a 503 with a stable code and the surface name", async () => {
    const response = surfaceUnavailableIfMissingRelation(
      drizzleWrap(driverError("42P01", 'relation "nexalog.notes" does not exist')),
      "GET /api/sync",
    );

    expect(response).not.toBeNull();
    expect(response!.status).toBe(503);
    const body = (await response!.json()) as Record<string, unknown>;
    expect(body.error).toBe("surface_unavailable");
    expect(body.code).toBe("missing_relation");
    expect(body.surface).toBe("GET /api/sync");
    // Never cacheable: this is a transient deployment condition.
    expect(response!.headers.get("Cache-Control")).toBe("no-store");
  });

  it("does not leak the relation name or the SQL to the caller", async () => {
    const response = surfaceUnavailableIfMissingRelation(
      drizzleWrap(driverError("42P01", 'relation "nexalog.notes" does not exist')),
      "GET /api/sync",
    );
    const raw = await response!.text();

    expect(raw).not.toContain("nexalog.notes");
    expect(raw).not.toContain("42P01");
    expect(raw).not.toContain("select ");
    // …while still being logged internally for the operator.
    expect(logEvent).toHaveBeenCalledWith(
      "api.surface_unavailable",
      expect.objectContaining({ surface: "GET /api/sync", relation: "nexalog.notes" }),
    );
  });

  it("returns null for anything that is not a missing relation", () => {
    expect(surfaceUnavailableIfMissingRelation(new Error("disk on fire"), "GET /api/sync")).toBeNull();
    expect(
      surfaceUnavailableIfMissingRelation(driverError("23505", "duplicate key"), "GET /api/sync"),
    ).toBeNull();
    expect(surfaceUnavailableIfMissingRelation(null, "GET /api/sync")).toBeNull();
    expect(logEvent).not.toHaveBeenCalled();
  });
});
