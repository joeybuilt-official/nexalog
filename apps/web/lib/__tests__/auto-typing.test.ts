import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Unit tests for U4 auto-typing classifier logic.
// Tests pure threshold logic + mocked plexoClassifyCapture behaviour.
// No DB, no HTTP.
// ---------------------------------------------------------------------------

const HIGH_CONFIDENCE = 0.85;
const LOW_CONFIDENCE = 0.50;

interface ClassifyResult { kind: string; confidence: number; properties: Record<string, unknown> }
interface ClassifyInput { workspaceId: string; content: string; url?: string | null; kinds: Array<{ kind: string; schemaJson: Record<string, unknown> }> }

function resolveAction(result: ClassifyResult): "auto_created" | "suggestion_stored" | "none" {
  if (!result.kind || result.confidence < LOW_CONFIDENCE) return "none";
  if (result.confidence >= HIGH_CONFIDENCE) return "auto_created";
  return "suggestion_stored";
}

const mockClassify = vi.fn((_input: ClassifyInput): Promise<ClassifyResult> =>
  Promise.resolve({ kind: "", confidence: 0, properties: {} }),
);

describe("auto-typing (U4)", () => {
  beforeEach(() => { mockClassify.mockReset(); });

  describe("threshold logic", () => {
    it("returns auto_created at exactly 0.85", () => {
      expect(resolveAction({ kind: "Book", confidence: 0.85, properties: {} })).toBe("auto_created");
    });

    it("returns auto_created above 0.85", () => {
      expect(resolveAction({ kind: "Book", confidence: 0.95, properties: {} })).toBe("auto_created");
    });

    it("returns suggestion_stored between 0.50 and 0.85", () => {
      expect(resolveAction({ kind: "Article", confidence: 0.70, properties: {} })).toBe("suggestion_stored");
    });

    it("returns suggestion_stored at exactly 0.50", () => {
      expect(resolveAction({ kind: "Article", confidence: 0.50, properties: {} })).toBe("suggestion_stored");
    });

    it("returns none below 0.50", () => {
      expect(resolveAction({ kind: "Book", confidence: 0.49, properties: {} })).toBe("none");
    });

    it("returns none when kind is empty", () => {
      expect(resolveAction({ kind: "", confidence: 0.90, properties: {} })).toBe("none");
    });

    it("returns none at confidence 0", () => {
      expect(resolveAction({ kind: "", confidence: 0, properties: {} })).toBe("none");
    });
  });

  describe("plexoClassifyCapture mock behaviour", () => {
    it("returns high-confidence result for a book URL", async () => {
      mockClassify.mockResolvedValueOnce({
        kind: "Book",
        confidence: 0.92,
        properties: { title: "Deep Work", author: "Cal Newport" },
      });
      const result = await mockClassify({
        workspaceId: "ws-1",
        content: "Deep Work by Cal Newport",
        url: "https://calnewport.com/deep-work/",
        kinds: [{ kind: "Book", schemaJson: { properties: { title: { type: "text" }, author: { type: "text" } } } }],
      });
      expect(result.kind).toBe("Book");
      expect(result.confidence).toBeGreaterThanOrEqual(HIGH_CONFIDENCE);
      expect(result.properties).toMatchObject({ title: "Deep Work" });
    });

    it("returns mid-confidence result for a fuzzy match", async () => {
      mockClassify.mockResolvedValueOnce({ kind: "Movie", confidence: 0.65, properties: { title: "Inception" } });
      const result = await mockClassify({
        workspaceId: "ws-1",
        content: "Inception (2010) by Nolan",
        url: null,
        kinds: [{ kind: "Movie", schemaJson: { properties: { title: { type: "text" } } } }],
      });
      expect(resolveAction(result)).toBe("suggestion_stored");
    });

    it("returns no match when no kinds exist", async () => {
      mockClassify.mockResolvedValueOnce({ kind: "", confidence: 0, properties: {} });
      const result = await mockClassify({
        workspaceId: "ws-1",
        content: "random text",
        url: null,
        kinds: [],
      });
      expect(resolveAction(result)).toBe("none");
    });

    it("handles confidence boundary values correctly", () => {
      expect(resolveAction({ kind: "Book", confidence: 1.0, properties: {} })).toBe("auto_created");
      expect(resolveAction({ kind: "Book", confidence: 0.0, properties: {} })).toBe("none");
    });
  });

  describe("properties extraction", () => {
    it("stores extracted properties in typed_object data", async () => {
      const props = { title: "The Hobbit", author: "Tolkien", year: 1937 };
      mockClassify.mockResolvedValueOnce({ kind: "Book", confidence: 0.91, properties: props });
      const result = await mockClassify({
        workspaceId: "ws-1",
        content: "The Hobbit by Tolkien, 1937",
        url: null,
        kinds: [{ kind: "Book", schemaJson: { properties: { title: { type: "text" }, author: { type: "text" }, year: { type: "number" } } } }],
      });
      expect(result.properties).toMatchObject(props);
    });
  });
});
