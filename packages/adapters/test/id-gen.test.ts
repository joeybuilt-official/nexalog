import { describe, it, expect } from "vitest";
import { SystemIdGen, SystemClock } from "../src/system/id-gen";

describe("SystemIdGen", () => {
  it("generates valid 26-char Crockford ULIDs (no I/L/O/U)", () => {
    const gen = new SystemIdGen();
    for (let i = 0; i < 100; i++) {
      const ulid = gen.newUlid();
      expect(ulid.value).toHaveLength(26);
      expect(ulid.value).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    }
  });

  it("produces sortable (time-ordered) ids", () => {
    const gen = new SystemIdGen();
    const a = gen.newUlid().value;
    const b = gen.newUlid().value;
    // later timestamp → lexicographically greater (same ms may tie)
    expect(b >= a).toBe(true);
  });

  it("SystemClock.now returns a Date", () => {
    expect(new SystemClock().now()).toBeInstanceOf(Date);
  });
});
