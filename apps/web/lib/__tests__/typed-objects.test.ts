import { describe, it, expect } from "vitest";

// Pure helpers mirroring the API boundary logic for typed objects (P9).

function isValidKindName(kind: string): boolean {
  const k = kind.trim();
  return k.length >= 1 && k.length <= 64;
}

function extractTitle(data: Record<string, unknown>): string {
  return typeof data.title === "string" ? data.title : "";
}

describe("typed objects (P9)", () => {
  describe("kind name validation", () => {
    it("accepts simple kind names", () => {
      expect(isValidKindName("Book")).toBe(true);
      expect(isValidKindName("Meeting Notes")).toBe(true);
      expect(isValidKindName("person-contact")).toBe(true);
    });

    it("rejects empty or whitespace-only names", () => {
      expect(isValidKindName("")).toBe(false);
      expect(isValidKindName("   ")).toBe(false);
    });

    it("rejects names over 64 characters", () => {
      expect(isValidKindName("a".repeat(65))).toBe(false);
      expect(isValidKindName("a".repeat(64))).toBe(true);
    });
  });

  describe("title extraction (FTS pivot field)", () => {
    it("returns the title string", () => {
      expect(extractTitle({ title: "My Book", year: 2024 })).toBe("My Book");
    });

    it("returns empty string when title is missing", () => {
      expect(extractTitle({ name: "Bob" })).toBe("");
    });

    it("returns empty string when title is not a string", () => {
      expect(extractTitle({ title: 42 })).toBe("");
      expect(extractTitle({ title: null })).toBe("");
    });
  });
});
