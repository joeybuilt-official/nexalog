import { describe, it, expect } from "vitest";

// Pure helpers for U6 typed object templates — template-merge logic.
// No db calls; these mirror the boundary logic used in the API + UI.

/** Merge template defaults with user-supplied input.
 * User values override template values; template fills missing keys. */
function mergeTemplateData(
  templateData: Record<string, unknown>,
  userInput: Record<string, unknown>,
): Record<string, unknown> {
  return { ...templateData, ...userInput };
}

/** Validate a template name (non-empty, ≤64 chars). */
function isValidTemplateName(name: string): boolean {
  const n = name.trim();
  return n.length >= 1 && n.length <= 64;
}

/** Strip null/undefined values from user input before merge. */
function sanitizeInput(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== null && v !== undefined),
  );
}

describe("typed object templates (U6)", () => {
  describe("mergeTemplateData", () => {
    it("uses template values when user input is empty", () => {
      const result = mergeTemplateData(
        { genre: "Fiction", status: "To Read" },
        {},
      );
      expect(result).toEqual({ genre: "Fiction", status: "To Read" });
    });

    it("user values override template values", () => {
      const result = mergeTemplateData(
        { genre: "Fiction", status: "To Read" },
        { genre: "Non-Fiction", title: "Dune" },
      );
      expect(result).toEqual({ genre: "Non-Fiction", status: "To Read", title: "Dune" });
    });

    it("user-supplied keys absent in template are preserved", () => {
      const result = mergeTemplateData({}, { title: "My Book", rating: 5 });
      expect(result).toEqual({ title: "My Book", rating: 5 });
    });

    it("empty template + empty input → empty object", () => {
      expect(mergeTemplateData({}, {})).toEqual({});
    });

    it("template data is not mutated", () => {
      const tmpl = { genre: "Fiction" };
      mergeTemplateData(tmpl, { genre: "Sci-Fi" });
      expect(tmpl.genre).toBe("Fiction");
    });
  });

  describe("isValidTemplateName", () => {
    it("accepts normal names", () => {
      expect(isValidTemplateName("Default")).toBe(true);
      expect(isValidTemplateName("From Amazon")).toBe(true);
    });

    it("rejects empty / whitespace", () => {
      expect(isValidTemplateName("")).toBe(false);
      expect(isValidTemplateName("   ")).toBe(false);
    });

    it("rejects names over 64 chars", () => {
      expect(isValidTemplateName("a".repeat(65))).toBe(false);
      expect(isValidTemplateName("a".repeat(64))).toBe(true);
    });
  });

  describe("sanitizeInput", () => {
    it("strips null and undefined values", () => {
      const result = sanitizeInput({ title: "X", genre: null, author: undefined, year: 2024 });
      expect(result).toEqual({ title: "X", year: 2024 });
    });

    it("preserves false and 0", () => {
      const result = sanitizeInput({ read: false, pages: 0 });
      expect(result).toEqual({ read: false, pages: 0 });
    });
  });
});
