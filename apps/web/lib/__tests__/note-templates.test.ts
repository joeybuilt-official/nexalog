// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { NOTE_TEMPLATES, getTemplate } from "@/lib/note-templates";

describe("note templates (D4)", () => {
  it("ships the 5 templates the spec named, plus a blank fallback", () => {
    const keys = NOTE_TEMPLATES.map((t) => t.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "blank",
        "daily",
        "meeting",
        "project",
        "book",
        "idea",
      ])
    );
  });

  it("every template has a stable, non-empty key + display name", () => {
    for (const t of NOTE_TEMPLATES) {
      expect(t.key).toMatch(/^[a-z0-9-]+$/);
      expect(t.name.length).toBeGreaterThan(0);
    }
  });

  it("getTemplate(unknown) falls back to blank instead of throwing", () => {
    const t = getTemplate("does-not-exist");
    expect(t.key).toBe("blank");
    expect(t.body).toBe("");
  });

  it("getTemplate('book') keeps the Book — title prefix so the new note is filable", () => {
    expect(getTemplate("book").title).toBe("Book — ");
  });

  it("daily / meeting / project / idea bodies render h2 headings the editor understands", () => {
    for (const key of ["daily", "meeting", "project", "idea"] as const) {
      expect(getTemplate(key).body).toMatch(/<h2>/);
    }
  });
});
