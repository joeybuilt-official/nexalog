import { describe, it, expect } from "vitest";
import { sm2Update } from "@/lib/review/sm2";

describe("sm2Update", () => {
  it("resets interval on grade < 3 (Again)", () => {
    const result = sm2Update({ intervalDays: 10, easeFactor: 2.5, reviewCount: 3 }, 0);
    expect(result.intervalDays).toBe(1);
    expect(result.easeFactor).toBeGreaterThanOrEqual(1.3);
    expect(result.nextReviewAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("first review (count=0) returns interval 1", () => {
    const result = sm2Update({ intervalDays: 1, easeFactor: 2.5, reviewCount: 0 }, 4);
    expect(result.intervalDays).toBe(1);
  });

  it("second review (count=1) returns interval 6", () => {
    const result = sm2Update({ intervalDays: 1, easeFactor: 2.5, reviewCount: 1 }, 4);
    expect(result.intervalDays).toBe(6);
  });

  it("third review multiplies by ease factor", () => {
    const result = sm2Update({ intervalDays: 6, easeFactor: 2.5, reviewCount: 2 }, 4);
    expect(result.intervalDays).toBe(Math.round(6 * 2.5));
  });

  it("easy grade increases ease factor", () => {
    const result = sm2Update({ intervalDays: 1, easeFactor: 2.5, reviewCount: 0 }, 5);
    expect(result.easeFactor).toBeGreaterThan(2.5);
  });

  it("hard grade decreases ease factor but clamps at 1.3", () => {
    const result = sm2Update({ intervalDays: 1, easeFactor: 1.3, reviewCount: 2 }, 1);
    expect(result.easeFactor).toBeGreaterThanOrEqual(1.3);
  });

  it("nextReviewAt is in the future", () => {
    const result = sm2Update({ intervalDays: 1, easeFactor: 2.5, reviewCount: 0 }, 3);
    expect(result.nextReviewAt.getTime()).toBeGreaterThan(Date.now());
  });
});
