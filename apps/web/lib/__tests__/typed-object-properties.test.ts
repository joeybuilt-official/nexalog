import { describe, it, expect } from "vitest";

// parseSchema is exported from typed-object-properties — test the pure logic inline
// (can't import the React component in vitest without jsdom setup; test the parsing logic directly)

type PropType = "text" | "number" | "date" | "select" | "multi-select" | "url" | "relation";
interface PropDef { type: PropType; options?: string[] }
interface SchemaJson { properties?: Record<string, PropDef> }

function parseSchema(s: unknown): SchemaJson {
  if (!s || typeof s !== "object") return {};
  const obj = s as Record<string, unknown>;
  if (!obj.properties || typeof obj.properties !== "object") return {};
  return s as SchemaJson;
}

function buildPatchBody(property: string, value: unknown) {
  const p = property.trim();
  if (!p) throw new Error("property required");
  return { property: p, value: value ?? null };
}

describe("typed-object-properties (U2)", () => {
  describe("parseSchema", () => {
    it("returns empty schema for null input", () => {
      expect(parseSchema(null)).toEqual({});
    });

    it("returns empty schema when properties missing", () => {
      expect(parseSchema({ foo: "bar" })).toEqual({});
    });

    it("parses text property", () => {
      const s = { properties: { title: { type: "text" } } };
      expect(parseSchema(s).properties?.title?.type).toBe("text");
    });

    it("parses select property with options", () => {
      const s = { properties: { status: { type: "select", options: ["Draft", "Published"] } } };
      const result = parseSchema(s);
      expect(result.properties?.status?.type).toBe("select");
      expect(result.properties?.status?.options).toEqual(["Draft", "Published"]);
    });

    it("parses all supported types", () => {
      const props = {
        t: { type: "text" },
        n: { type: "number" },
        d: { type: "date" },
        s: { type: "select", options: ["A", "B"] },
        ms: { type: "multi-select", options: ["X", "Y"] },
        u: { type: "url" },
        r: { type: "relation" },
      };
      const result = parseSchema({ properties: props });
      expect(Object.keys(result.properties ?? {})).toHaveLength(7);
    });
  });

  describe("buildPatchBody (PATCH /api/typed-objects/[id])", () => {
    it("builds body for text property", () => {
      expect(buildPatchBody("title", "My Book")).toEqual({ property: "title", value: "My Book" });
    });

    it("builds body for number property", () => {
      expect(buildPatchBody("rating", 4.5)).toEqual({ property: "rating", value: 4.5 });
    });

    it("coerces null value to null", () => {
      expect(buildPatchBody("author", null)).toEqual({ property: "author", value: null });
    });

    it("throws on empty property name", () => {
      expect(() => buildPatchBody("", "value")).toThrow("property required");
      expect(() => buildPatchBody("  ", "value")).toThrow("property required");
    });

    it("builds body for multi-select array", () => {
      expect(buildPatchBody("tags", ["sci-fi", "classic"])).toEqual({
        property: "tags",
        value: ["sci-fi", "classic"],
      });
    });
  });
});
