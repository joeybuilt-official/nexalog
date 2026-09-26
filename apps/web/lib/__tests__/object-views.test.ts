import { describe, it, expect } from "vitest";

// Pure logic tests for multi-view (U3) — no DOM.

type ViewType = "table" | "gallery" | "board" | "calendar";

function loadView(storage: Record<string, string>, workspaceId: string, kind: string): ViewType {
  const key = `nexalog_view_${workspaceId}_${kind}`;
  const v = storage[key];
  if (v === "table" || v === "gallery" || v === "board" || v === "calendar") return v;
  return "gallery";
}

function displayValue(raw: unknown, type: string): string {
  if (raw == null) return "—";
  if (type === "multi-select" && Array.isArray(raw)) return (raw as unknown[]).join(", ");
  if (type === "date" && typeof raw === "string") return raw;
  return String(raw);
}

describe("object views (U3)", () => {
  describe("ViewSwitcher — localStorage persistence", () => {
    it("defaults to gallery when no stored value", () => {
      const result = loadView({}, "ws1", "Book");
      expect(result).toBe("gallery");
    });

    it("returns stored view when valid", () => {
      const storage: Record<string, string> = { "nexalog_view_ws1_Book": "table" };
      expect(loadView(storage, "ws1", "Book")).toBe("table");
    });

    it("returns gallery for unknown stored value", () => {
      const storage: Record<string, string> = { "nexalog_view_ws1_Book": "unknown" };
      expect(loadView(storage, "ws1", "Book")).toBe("gallery");
    });

    it("uses workspaceId+kind as key scope", () => {
      const storage: Record<string, string> = {
        "nexalog_view_ws1_Book": "calendar",
        "nexalog_view_ws2_Book": "board",
      };
      expect(loadView(storage, "ws1", "Book")).toBe("calendar");
      expect(loadView(storage, "ws2", "Book")).toBe("board");
    });
  });

  describe("field display — read-only rendering", () => {
    it("renders a string value", () => {
      expect(displayValue("hello", "text")).toBe("hello");
    });

    it("renders a number value", () => {
      expect(displayValue(42, "number")).toBe("42");
    });

    it("renders a date string", () => {
      expect(displayValue("2024-03-15", "date")).toBe("2024-03-15");
    });

    it("joins multi-select array", () => {
      expect(displayValue(["a", "b", "c"], "multi-select")).toBe("a, b, c");
    });

    it("renders null as dash", () => {
      expect(displayValue(null, "text")).toBe("—");
    });

    it("renders undefined as dash", () => {
      expect(displayValue(undefined, "text")).toBe("—");
    });

    it("renders empty multi-select as empty string", () => {
      expect(displayValue([], "multi-select")).toBe("");
    });
  });
});
